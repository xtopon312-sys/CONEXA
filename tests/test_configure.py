"""Tests use temporary, invented credentials; never the teacher's private files."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools import configure  # noqa: E402
from tools import windows_setup  # noqa: E402


class NetworkValidationTests(unittest.TestCase):
    def test_ssid_limit_is_utf8_bytes(self):
        configure.validate_network("á" * 16, "senha-teste")
        for ssid in ("", "a" * 33, "á" * 17):
            with self.subTest(length=len(ssid)), self.assertRaises(configure.ConfigError):
                configure.validate_network(ssid, "senha-teste")

    def test_password_boundaries_and_hex_psk(self):
        for password in ("a" * 8, "a" * 63, "á" * 4, "F0" * 32):
            configure.validate_network("Conexa teste", password)
        for password in ("a" * 7, "g" * 64, "á" * 32, "F" * 65):
            with self.subTest(length=len(password)), self.assertRaises(configure.ConfigError):
                configure.validate_network("Conexa teste", password)

    def test_controls_and_bad_types_are_rejected(self):
        for ssid, password in (
            ("rede\x00", "senha-teste"), ("rede\n", "senha-teste"),
            ("rede", "senha\rteste"), (None, "senha-teste"),
            ("rede", 12345678), ("\ud800", "senha-teste"),
        ):
            with self.subTest(), self.assertRaises(configure.ConfigError):
                configure.validate_network(ssid, password)

    def test_spaces_quotes_and_shell_metacharacters_are_preserved(self):
        configure.validate_network(' sala "ATS" \\ & % ', 'senha;$(x)&%"\\fim')


class ConfigFilesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="conexa-config-test-")
        self.private = Path(self.temp.name) / "private"

    def tearDown(self):
        self.temp.cleanup()

    def create(self):
        return configure.configure_network(self.private, "Rede do ensaio", "senha-inventada")

    def test_new_codes_are_unique_and_teacher_is_separate(self):
        config = self.create()
        self.assertEqual(44, len(set(config["student_tokens"])))
        self.assertTrue(all(token == token.upper() for token in config["student_tokens"]))
        self.assertNotIn(config["admin_token"], config["student_tokens"])
        self.assertEqual(config, configure.load_config(self.private))

    def test_reconfiguring_and_preparing_preserve_every_identity(self):
        original = self.create()
        changed = configure.configure_network(self.private, "Outro roteador", "outra-senha-local")
        self.assertEqual(original["admin_token"], changed["admin_token"])
        self.assertEqual(original["student_tokens"], changed["student_tokens"])
        self.assertEqual("Outro roteador", changed["ssid"])
        self.assertEqual("outra-senha-local", changed["password"])
        before = (self.private / "config.json").read_bytes()
        prepared = configure.prepare_files(self.private)
        self.assertEqual(changed, prepared)
        self.assertEqual(before, (self.private / "config.json").read_bytes())

    def test_student_printout_never_contains_teacher_or_wifi_password(self):
        config = self.create()
        cards = (self.private / "acessos-alunos.html").read_text(encoding="utf-8")
        teacher = (self.private / "professor.txt").read_text(encoding="utf-8")
        self.assertEqual(44, cards.count("<article>"))
        self.assertNotIn(config["admin_token"], cards)
        self.assertNotIn(config["password"], cards)
        self.assertNotIn(config["ssid"], cards)
        self.assertIn(config["admin_token"], teacher)
        self.assertNotIn(config["password"], teacher)
        for token in config["student_tokens"]:
            self.assertEqual(1, cards.count(token))
            self.assertNotIn(token, teacher)
        self.assertNotRegex(cards, r"(?:src|href)\s*=")

    def test_invalid_network_does_not_modify_existing_configuration(self):
        self.create()
        before = {path.name: path.read_bytes() for path in self.private.iterdir()}
        with self.assertRaises(configure.ConfigError):
            configure.configure_network(self.private, "x" * 33, "senha-inventada")
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.private.iterdir()})

    def test_malformed_existing_config_is_not_silently_replaced(self):
        self.private.mkdir()
        path = self.private / "config.json"
        path.write_text('{"ssid": "incompleto"}', encoding="utf-8")
        before = path.read_bytes()
        with self.assertRaises(configure.ConfigError):
            configure.configure_network(self.private, "rede", "senha-inventada")
        self.assertEqual(before, path.read_bytes())
        self.assertFalse((self.private / "board_config.h").exists())

    def test_duplicate_or_missing_student_codes_are_rejected(self):
        original = self.create()
        for mutate in (
            lambda items: items.pop(),
            lambda items: items.__setitem__(1, items[0]),
            lambda items: items.__setitem__(1, items[1].lower()),
        ):
            bad = copy.deepcopy(original)
            mutate(bad["student_tokens"])
            with self.subTest(), self.assertRaises(configure.ConfigError):
                configure.validate_config(bad)

    def test_secret_input_refuses_getpass_echo_fallback(self):
        with patch.object(configure.getpass, "getpass", side_effect=configure.getpass.GetPassWarning):
            with self.assertRaises(configure.ConfigError):
                configure._secret_input("Senha: ")

    def test_c_literal_round_trip_covers_utf8_and_metacharacters(self):
        value = 'á " \\ ?$%;A9'
        literal = configure.c_string_literal(value)
        encoded = bytes(int(match, 8) for match in re.findall(r"\\([0-7]{3})", literal))
        self.assertEqual(value.encode("utf-8"), encoded)
        self.assertRegex(literal, r'^"(?:\\[0-7]{3})*"$')

    @unittest.skipUnless(shutil.which("cc") or shutil.which("gcc") or shutil.which("cl"), "A native C compiler is unavailable")
    def test_generated_header_compiles_and_preserves_exact_wifi_bytes(self):
        ssid = 'Ação "A" \\ %&'
        password = 'pwd\\";$(echo)?ABC'
        config = configure.configure_network(self.private, ssid, password)
        source = self.private / "check.c"
        binary = self.private / ("check.exe" if sys.platform == "win32" else "check")
        expected_ssid = ",".join(str(byte) for byte in ssid.encode("utf-8") + b"\0")
        expected_password = ",".join(str(byte) for byte in password.encode("utf-8") + b"\0")
        source.write_text(
            '#include <string.h>\n#include "board_config.h"\n'
            f'static const unsigned char s[] = {{{expected_ssid}}};\n'
            f'static const unsigned char p[] = {{{expected_password}}};\n'
            'int main(void) {\n'
            'if (sizeof(CONEXA_WIFI_SSID) != sizeof(s) || memcmp(CONEXA_WIFI_SSID,s,sizeof(s))) return 1;\n'
            'if (sizeof(CONEXA_WIFI_PASSWORD) != sizeof(p) || memcmp(CONEXA_WIFI_PASSWORD,p,sizeof(p))) return 2;\n'
            'if (sizeof(CONEXA_STUDENT_TOKENS)/sizeof(CONEXA_STUDENT_TOKENS[0]) != 44) return 3;\n'
            'if (strlen(CONEXA_ADMIN_TOKEN) != 53 || strlen(CONEXA_STUDENT_TOKENS[43]) != 10) return 4;\n'
            'return 0; }\n', encoding="utf-8",
        )
        compiler = shutil.which("cc") or shutil.which("gcc") or shutil.which("cl")
        args = [compiler, "/nologo", "/std:c11", "/W4", "/WX", str(source), "/Fe:" + str(binary)] if Path(compiler).name.lower() in ("cl.exe", "cl") else [compiler, "-std=c11", "-Wall", "-Wextra", "-Werror", str(source), "-o", str(binary)]
        compiled = subprocess.run(args, cwd=self.private, capture_output=True, text=True, check=False)
        self.assertEqual(0, compiled.returncode, compiled.stderr)
        executed = subprocess.run([str(binary)], capture_output=True, check=False)
        self.assertEqual(0, executed.returncode)
        self.assertEqual(config, configure.load_config(self.private))


class FlashGateTests(unittest.TestCase):
    def test_only_expected_chip_and_exact_flash_size_pass(self):
        windows_setup.validate_flash_probe("Chip is ESP32-C6 (QFN40) (revision v0.1)\nDetected flash size: 16MB\n")
        for output in (
            "Chip is ESP32-C3\nDetected flash size: 16MB\n",
            "Chip is ESP32-C6\nDetected flash size: 8MB\n",
            "Chip is ESP32-C6\nDetected flash size: 32MB\n",
            "Chip is ESP32-C6\nFlash size unknown\n",
            "Detected flash size: 16MB\n",
            "Chip is ESP32-C6\nDetected flash size: 16MB\nDetected flash size: 8MB\n",
        ):
            with self.subTest(output=output), self.assertRaises(windows_setup.SetupError):
                windows_setup.validate_flash_probe(output)

    def test_port_must_be_explicitly_selected_from_observed_list(self):
        with patch.object(windows_setup, "available_ports", return_value=[{"port": "COM5"}]), patch("builtins.input", return_value="COM6"), patch("builtins.print"):
            with self.assertRaises(windows_setup.SetupError):
                windows_setup.choose_port("python")
        with patch.object(windows_setup, "available_ports", return_value=[{"port": "COM5"}]), patch("builtins.input", return_value="com5"), patch("builtins.print"):
            self.assertEqual("COM5", windows_setup.choose_port("python"))

    def test_probe_failure_prevents_upload(self):
        with patch.object(windows_setup, "compile_firmware"), patch.object(windows_setup, "verify_tools", return_value="python"), patch.object(windows_setup, "choose_port", return_value="COM5"), patch.object(windows_setup, "probe_board", side_effect=windows_setup.SetupError("unconfirmed")), patch.object(windows_setup, "run") as run, patch("builtins.input", return_value="GRAVAR"), patch("builtins.print"):
            with self.assertRaises(windows_setup.SetupError):
                windows_setup.flash_firmware()
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
