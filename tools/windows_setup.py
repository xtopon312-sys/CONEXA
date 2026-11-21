"""Windows CMD preparation menu. No shell execution and no automatic port choice."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
VENV = ROOT / ".venv"
PLATFORMIO_VERSION = "6.2.0"
ESPTOOL_VERSION = "4.11.0"


class SetupError(RuntimeError):
    pass


def environment() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PLATFORMIO_SETTING_ENABLE_TELEMETRY"] = "No"
    return env


def run(args: list[str], *, capture: bool = False, timeout: float | None = None) -> subprocess.CompletedProcess:
    try:
        result = subprocess.run(
            args, cwd=ROOT, env=environment(), shell=False, check=False,
            capture_output=capture, text=True, encoding="utf-8", errors="replace", timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise SetupError("A operação excedeu o tempo de espera e foi interrompida.") from exc
    except OSError as exc:
        raise SetupError("Não foi possível iniciar a ferramenta. Verifique a instalação e o caminho do projeto.") from exc
    if result.returncode != 0:
        # Do not dump captured output: device tools may print hardware identifiers.
        raise SetupError(f"A ferramenta terminou com código {result.returncode}; a próxima etapa não será executada.")
    return result


def venv_python() -> str:
    executable = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not executable.is_file():
        raise SetupError("Use primeiro a opção 2 para instalar as ferramentas neste projeto.")
    return str(executable)


def install_tools() -> None:
    print("Esta preparação baixa ferramentas da internet. Faça isso antes de ir à escola.")
    if not (VENV / "pyvenv.cfg").is_file():
        run([sys.executable, "-m", "venv", str(VENV)])
    interpreter = venv_python()
    run([
        interpreter, "-m", "pip", "install", "--disable-pip-version-check",
        f"platformio=={PLATFORMIO_VERSION}", f"esptool=={ESPTOOL_VERSION}",
    ])
    run([interpreter, "-m", "platformio", "pkg", "install"])
    print("Ferramentas instaladas. A primeira compilação ainda pode baixar dependências do ESP-IDF.")


def verify_tools() -> str:
    interpreter = venv_python()
    result = run([
        interpreter, "-c",
        "import importlib.metadata as m,json; print(json.dumps({n:m.version(n) for n in ['platformio','esptool']}))",
    ], capture=True)
    try:
        versions = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise SetupError("Não foi possível confirmar a versão das ferramentas; reinstale pela opção 2.") from exc
    if versions != {"platformio": PLATFORMIO_VERSION, "esptool": ESPTOOL_VERSION}:
        raise SetupError("As versões das ferramentas diferem das previstas; reinstale pela opção 2.")
    return interpreter


def prepare_build() -> None:
    run([sys.executable, str(ROOT / "tools/configure.py"), "--prepare"])
    assets = ROOT / "tools/build_assets.py"
    if not assets.is_file():
        raise SetupError("tools/build_assets.py está ausente; extraia novamente o pacote completo.")
    run([sys.executable, str(assets)])


def compile_firmware() -> None:
    interpreter = verify_tools()
    prepare_build()
    run([interpreter, "-m", "platformio", "run"])
    print("Compilação concluída nesta máquina. Isso ainda não é um teste da placa nem dos 44 alunos.")


def available_ports(interpreter: str) -> list[dict]:
    result = run([interpreter, "-m", "platformio", "device", "list", "--json-output"], capture=True)
    try:
        ports = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise SetupError("A listagem de portas não retornou JSON válido. Nenhuma porta foi escolhida.") from exc
    if not isinstance(ports, list) or any(
        not isinstance(item, dict) or not isinstance(item.get("port"), str) for item in ports
    ):
        raise SetupError("Formato inesperado na listagem de portas. Nenhuma porta foi escolhida.")
    return ports


def show_ports(ports: list[dict]) -> None:
    if not ports:
        print("Nenhuma porta serial disponível. Verifique o cabo de dados e a conexão USB da ESP32 destinada ao CONEXA.")
    for item in ports:
        print(f'  {item["port"]} — {item.get("description", "Dispositivo serial")}')


def choose_port(interpreter: str) -> str:
    ports = available_ports(interpreter)
    show_ports(ports)
    if not ports:
        raise SetupError("Conecte somente a ESP32 destinada ao CONEXA com um cabo USB de dados e tente novamente.")
    print("Mantenha a outra placa desconectada. Se houver dúvida, compare a lista ao desconectar/reconectar a placa destinada ao CONEXA.")
    requested = input("Digite a porta completa da ESP32 destinada ao CONEXA (ex.: COM5); Enter cancela: ").strip()
    if not requested:
        raise SetupError("Operação cancelada; nenhuma porta foi escolhida.")
    by_name = {item["port"].casefold(): item["port"] for item in ports}
    if requested.casefold() not in by_name:
        raise SetupError("A porta informada não consta na lista. Atualize a lista e tente novamente.")
    return by_name[requested.casefold()]


def validate_flash_probe(output: str) -> None:
    """Fail closed on absent, ambiguous or unexpected esptool 4 output."""
    chip = re.search(r"(?im)^\s*Chip (?:is|type:)\s+ESP32-C6\b", output)
    sizes = re.findall(r"(?im)^\s*Detected flash size:\s*(\d+)\s*MB\s*$", output)
    if not chip:
        raise SetupError("Não foi possível confirmar ESP32-C6 na identificação. Nenhum firmware foi gravado.")
    if len(sizes) != 1 or sizes[0] != "16":
        raise SetupError("A identificação não confirmou exatamente 16 MB de flash. Nenhum firmware foi gravado.")


def probe_board(interpreter: str, port: str) -> None:
    print("Identificando o chip e a flash pela porta escolhida; o comando reinicia a placa para leitura.")
    try:
        result = run([
            interpreter, "-m", "esptool", "--chip", "esp32c6", "--port", port,
            "--baud", "115200", "flash_id",
        ], capture=True, timeout=60)
    except SetupError as exc:
        raise SetupError(
            "Falha na identificação da placa. Nenhum firmware foi gravado. "
            "Confira a porta e feche monitores seriais. Se necessário, siga a orientação de BOOT/RESET do guia."
        ) from exc
    validate_flash_probe(result.stdout + "\n" + result.stderr)
    print("Identificação confirmada nesta conexão: ESP32-C6, flash de 16 MB.")


def flash_firmware() -> None:
    # Compile before connecting to a device; a failed build cannot reach upload.
    compile_firmware()
    interpreter = verify_tools()
    port = choose_port(interpreter)
    print(f"O firmware do CONEXA será gravado na placa destinada ao CONEXA conectada em {port}.")
    confirmation = input("Com a outra placa desconectada, digite GRAVAR para continuar: ").strip()
    if confirmation != "GRAVAR":
        raise SetupError("Gravação cancelada.")
    probe_board(interpreter, port)
    run([interpreter, "-m", "platformio", "run", "--target", "upload", "--upload-port", port])
    print("Ferramenta de gravação concluída. Abra o monitor para obter o endereço IP e executar o ensaio físico.")


def monitor_board() -> None:
    interpreter = verify_tools()
    port = choose_port(interpreter)
    print("Monitor a 115200 baud. Use Ctrl+C para voltar ao menu. Procure o endereço http:// indicado pela placa.")
    run([
        interpreter, "-m", "platformio", "device", "monitor", "--port", port,
        "--baud", "115200", "--dtr", "0", "--rts", "0",
    ])


def main() -> int:
    if sys.version_info < (3, 10):
        print("Este assistente requer Python 3.10 ou mais recente.")
        return 1
    while True:
        print("\nCONEXA — preparação da ESP32 destinada ao CONEXA-C6 (16 MB)")
        print("1. Configurar rede e preparar 44 códigos de alunos")
        print("2. Instalar ferramentas e dependências (usa internet)")
        print("3. Preparar arquivos e compilar firmware")
        print("4. Listar portas USB/serial")
        print("5. Compilar, identificar chip/flash e gravar na porta escolhida")
        print("6. Abrir monitor serial para consultar o IP")
        print("0. Sair")
        try:
            option = input("Opção: ").strip()
            if option == "0":
                return 0
            if option == "1":
                run([sys.executable, str(ROOT / "tools/configure.py")])
            elif option == "2":
                install_tools()
            elif option == "3":
                compile_firmware()
            elif option == "4":
                show_ports(available_ports(verify_tools()))
            elif option == "5":
                flash_firmware()
            elif option == "6":
                monitor_board()
            else:
                print("Escolha uma das opções mostradas.")
        except SetupError as exc:
            print(f"\nEtapa interrompida: {exc}")
        except KeyboardInterrupt:
            print("\nOperação interrompida; retornando ao menu.")
        except EOFError:
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
