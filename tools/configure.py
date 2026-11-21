"""Local configuration for CONEXA 200. Requires only the Python standard library."""

from __future__ import annotations

import argparse
import getpass
import html
import json
import os
from pathlib import Path
import re
import secrets
import sys
import tempfile
import warnings


ROOT = Path(__file__).resolve().parents[1]
STUDENT_COUNT = 44
STUDENT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
STUDENT_TOKEN_LENGTH = 10
MAX_CONFIG_BYTES = 64 * 1024


class ConfigError(ValueError):
    """A safe, user-facing error that never includes secret values."""


def _utf8(value: object, label: str) -> bytes:
    if not isinstance(value, str):
        raise ConfigError(f"{label} precisa ser texto.")
    try:
        data = value.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ConfigError(f"{label} contém um caractere Unicode inválido.") from exc
    if any(byte < 32 or byte == 127 for byte in data):
        raise ConfigError(f"{label} não pode conter NUL, quebras de linha ou controles.")
    return data


def validate_network(ssid: object, password: object) -> None:
    """ESP-IDF fields are byte arrays: limits apply to encoded UTF-8 bytes."""
    ssid_bytes = _utf8(ssid, "SSID")
    password_bytes = _utf8(password, "Senha")
    if not 1 <= len(ssid_bytes) <= 32:
        raise ConfigError("O SSID precisa ter de 1 a 32 bytes em UTF-8.")
    valid_passphrase = 8 <= len(password_bytes) <= 63
    valid_hex_psk = len(password_bytes) == 64 and bool(
        re.fullmatch(r"[0-9A-Fa-f]{64}", password)
    )
    if not (valid_passphrase or valid_hex_psk):
        raise ConfigError("A senha precisa ter de 8 a 63 bytes em UTF-8, ou 64 dígitos hexadecimais.")


def new_tokens() -> tuple[str, list[str]]:
    """Independent teacher key and unique, human-readable student codes."""
    teacher = "PROF-" + secrets.token_hex(24).upper()
    students: list[str] = []
    seen: set[str] = set()
    while len(students) < STUDENT_COUNT:
        token = "".join(secrets.choice(STUDENT_ALPHABET) for _ in range(STUDENT_TOKEN_LENGTH))
        if token not in seen:
            students.append(token)
            seen.add(token)
    return teacher, students


def validate_config(config: object) -> dict:
    if not isinstance(config, dict) or set(config) != {
        "ssid", "password", "admin_token", "student_tokens"
    }:
        raise ConfigError("config.json deve conter somente ssid, password, admin_token e student_tokens.")
    validate_network(config["ssid"], config["password"])
    admin = config["admin_token"]
    if not isinstance(admin, str) or not re.fullmatch(r"PROF-[0-9A-F]{48}", admin):
        raise ConfigError("A chave de professor não tem o formato gerado por este assistente.")
    students = config["student_tokens"]
    if not isinstance(students, list) or len(students) != STUDENT_COUNT:
        raise ConfigError("A configuração deve conter exatamente 44 códigos de alunos.")
    allowed = set(STUDENT_ALPHABET)
    if any(
        not isinstance(token, str)
        or len(token) != STUDENT_TOKEN_LENGTH
        or not set(token) <= allowed
        for token in students
    ):
        raise ConfigError("Há código de aluno fora do formato de dez caracteres maiúsculos.")
    if len(set(students)) != STUDENT_COUNT or admin in students:
        raise ConfigError("Os 44 códigos precisam ser distintos e separados da chave de professor.")
    return config


def load_config(private_dir: Path) -> dict:
    path = Path(private_dir) / "config.json"
    if not path.is_file():
        raise ConfigError("A rede ainda não foi configurada. Use a opção 1 do INICIAR.cmd.")
    try:
        if path.stat().st_size > MAX_CONFIG_BYTES:
            raise ConfigError("config.json excede o tamanho permitido; o arquivo foi preservado.")
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ConfigError("Não foi possível ler config.json; o arquivo foi preservado. Verifique sua cópia local.") from exc
    return validate_config(config)


def c_string_literal(value: str) -> str:
    """Three-digit octal avoids C hex escape greediness, quotes and trigraphs."""
    return '"' + "".join(f"\\{byte:03o}" for byte in value.encode("utf-8")) + '"'


def render_header(config: dict) -> str:
    validate_config(config)
    lines = [
        "/* Generated locally. Contains credentials: do not publish or distribute. */",
        "#ifndef CONEXA_BOARD_CONFIG_H",
        "#define CONEXA_BOARD_CONFIG_H",
        f'#define CONEXA_WIFI_SSID {c_string_literal(config["ssid"])}',
        f'#define CONEXA_WIFI_PASSWORD {c_string_literal(config["password"])}',
        f'#define CONEXA_ADMIN_TOKEN {c_string_literal(config["admin_token"])}',
        "static const char *const CONEXA_STUDENT_TOKENS[44] = {",
    ]
    lines.extend("    " + c_string_literal(token) + "," for token in config["student_tokens"])
    lines.extend(["};", "#endif", ""])
    return "\n".join(lines)


def render_student_cards(config: dict) -> str:
    validate_config(config)
    cards = "\n".join(
        f'<article><span>CONEXA 200 · Participante {index:02d}</span>'
        f'<strong>{html.escape(token)}</strong><small>Seu código pessoal de entrada</small></article>'
        for index, token in enumerate(config["student_tokens"], start=1)
    )
    return """<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CONEXA 200 — cartões dos participantes</title>
<style>
@page {size:A4; margin:10mm} * {box-sizing:border-box}
body {margin:0; color:#17233a; font-family:Arial,sans-serif}
h1 {font-size:20px; margin:0 0 5px} p {font-size:12px; margin:0 0 12px}
main {display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:2mm}
article {border:1px dashed #798599; border-radius:4px; min-height:18mm; padding:2mm; break-inside:avoid; text-align:center}
span,small {display:block; font-size:9px} strong {display:block; font:700 15px monospace; margin:4px 0; letter-spacing:.4px}
@media screen {body {max-width:800px; margin:24px auto; padding:12px}}
</style></head><body>
<h1>CONEXA 200 — 44 códigos de entrada</h1>
<p>Imprima e recorte. Entregue um código por participante. O código recupera a mesma posição ao reconectar.</p>
<main>""" + cards + "\n</main></body></html>\n"


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="\n", dir=path.parent,
            prefix=".conexa-", suffix=".tmp", delete=False
        ) as handle:
            temp_path = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_path, 0o600)
        os.replace(temp_path, path)
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()


def prepare_files(private_dir: Path) -> dict:
    """Regenerate derived files without replacing any existing access code."""
    private_dir = Path(private_dir)
    config = load_config(private_dir)
    _atomic_write(private_dir / "board_config.h", render_header(config))
    _atomic_write(private_dir / "acessos-alunos.html", render_student_cards(config))
    _atomic_write(
        private_dir / "professor.txt",
        "CONEXA 200 — acesso reservado ao professor\n\n"
        "Abra /professor no endereço local da ESP32 e informe esta chave:\n\n"
        + config["admin_token"]
        + "\n\nGuarde este arquivo separado dos cartões dos alunos.\n",
    )
    return config


def configure_network(private_dir: Path, ssid: str, password: str) -> dict:
    """Existing malformed configuration is rejected, never silently replaced."""
    private_dir = Path(private_dir)
    validate_network(ssid, password)
    if (private_dir / "config.json").exists():
        existing = load_config(private_dir)
        admin, students = existing["admin_token"], list(existing["student_tokens"])
    else:
        admin, students = new_tokens()
    config = validate_config({
        "ssid": ssid, "password": password,
        "admin_token": admin, "student_tokens": students,
    })
    _atomic_write(private_dir / "config.json", json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    return prepare_files(private_dir)


def _secret_input(prompt: str) -> str:
    # getpass would otherwise fall back to echoing a password into redirected input.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        try:
            return getpass.getpass(prompt)
        except getpass.GetPassWarning as exc:
            raise ConfigError("Abra INICIAR.cmd em uma janela CMD interativa para digitar a senha sem exibição.") from exc


def interactive(private_dir: Path) -> None:
    existing = load_config(private_dir) if (private_dir / "config.json").exists() else None
    print("Configure a rede de 2,4 GHz do roteador que será levado à aula.")
    print("A senha e os códigos não serão exibidos no console.")
    suffix = " (Enter mantém o atual)" if existing else ""
    ssid = input(f"Nome da rede (SSID){suffix}: ")
    password = _secret_input(f"Senha da rede{suffix}: ")
    if existing:
        ssid = ssid if ssid else existing["ssid"]
        password = password if password else existing["password"]
    configure_network(private_dir, ssid, password)
    print("Configuração gravada. Códigos anteriores preservados." if existing else "Configuração gravada; 44 códigos e chave de professor gerados neste computador.")
    print("Cartões: private/acessos-alunos.html | Professor: private/professor.txt")
    print("Após alterar a rede, compile e grave novamente o firmware na segunda ESP32.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Preparação local da rede e dos acessos do CONEXA 200.")
    parser.add_argument("--prepare", action="store_true", help="Valida a configuração existente e prepara os arquivos da compilação.")
    args = parser.parse_args(argv)
    try:
        if args.prepare:
            prepare_files(ROOT / "private")
            print("Configuração validada e arquivos locais preparados; códigos preservados.")
        else:
            interactive(ROOT / "private")
        return 0
    except (ConfigError, OSError) as exc:
        print(f"Configuração interrompida: {exc}", file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("\nConfiguração cancelada; nenhuma chave nova foi exibida.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
