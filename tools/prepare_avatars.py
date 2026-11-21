"""Prepare an offline, ID-only avatar atlas; never uploads or installs anything.

Inputs are 001.png/.jpg through 044.png/.jpg. All images are decoded and
re-encoded, removing source metadata. Pillow is needed only for nonempty inputs.
The default empty header retains the procedural characters in production.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import re
import sys
import warnings

ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 62, 118
PIVOT = (31, 106)
MAX_ATLAS_BYTES = 128 * 1024
MAX_MANIFEST_BYTES = 8 * 1024
MAX_DECODED_BYTES = 6 * 1024 * 1024
MAX_INPUT_BYTES = 8 * 1024 * 1024
MAX_INPUT_SIDE = 4096
IMAGE_NAME = re.compile(r"^(0[0-3][0-9]|04[0-4])\.(png|jpe?g)$", re.I)


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def _pillow():
    try:
        from PIL import Image, ImageOps, features
    except ImportError as exc:
        raise ValueError("Pillow não disponível neste Python; selecione o runtime local documentado, sem instalar dependências.") from exc
    if not features.check("webp"):
        raise ValueError("O Pillow deste runtime não oferece WebP.")
    return Image, ImageOps


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _read_options(config: Path | None) -> dict:
    if config is None:
        return {}
    if config.stat().st_size > MAX_MANIFEST_BYTES:
        raise ValueError("Configuração de enquadramento excede 8 KiB.")
    value = json.loads(config.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or set(value) != {"version", "avatars"} or type(value["version"]) is not int or value["version"] != 1 or not isinstance(value["avatars"], dict):
        raise ValueError("Configuração requer version:1 e avatars:{ID:opções}.")
    for key, options in value["avatars"].items():
        if not re.fullmatch(r"\d{3}", key) or not 1 <= int(key) <= 44:
            raise ValueError("ID de enquadramento fora do intervalo 001..044.")
        if not isinstance(options, dict) or not set(options).issubset({"crop", "feet", "height"}):
            raise ValueError("Opções permitidas: crop, feet, height; sem nomes ou metadados pessoais.")
        for field, length in (("crop", 4), ("feet", 2)):
            if field in options and (not isinstance(options[field], list) or len(options[field]) != length or not all(_number(n) for n in options[field])):
                raise ValueError(f"{field} requer {length} coordenadas numéricas finitas.")
        if "crop" in options and not all(int(n) == n for n in options["crop"]):
            raise ValueError("crop deve usar coordenadas inteiras.")
        if "height" in options and (not _number(options["height"]) or not 80 <= options["height"] <= 106):
            raise ValueError("height deve estar entre 80 e 106 pixels lógicos.")
    return value["avatars"]


def _sources(folder: Path) -> list[tuple[int, Path]]:
    if not folder.is_dir():
        raise ValueError("Diretório de entrada inexistente; use --empty apenas para restaurar os avatares procedurais.")
    entries: dict[int, Path] = {}
    for source in sorted(folder.iterdir(), key=lambda p: p.name.lower()):
        if not source.is_file():
            continue
        if source.suffix.lower() in (".gif", ".webp", ".avif", ".bmp", ".tif", ".tiff", ".svg"):
            raise ValueError("Formato de entrada não suportado; use PNG/JPG/JPEG estático.")
        if source.suffix.lower() not in (".png", ".jpg", ".jpeg"):
            continue
        if not IMAGE_NAME.fullmatch(source.name) or not 1 <= int(source.stem) <= 44:
            raise ValueError("Nome de imagem inválido; use somente 001..044 e extensão PNG/JPG/JPEG.")
        student_id = int(source.stem)
        if student_id in entries:
            raise ValueError(f"Há mais de uma imagem para o ID {student_id:03d}.")
        if source.is_symlink():
            raise ValueError("Links simbólicos não são aceitos como imagens de entrada.")
        if source.stat().st_size > MAX_INPUT_BYTES:
            raise ValueError(f"Imagem do ID {student_id:03d} excede 8 MiB.")
        entries[student_id] = source
    if not entries:
        raise ValueError("Nenhuma imagem PNG/JPG válida encontrada; para ausência intencional, use --empty.")
    return sorted(entries.items())


def _cell(source: Path, options: dict, scale: int, Image, ImageOps):
    # Always start a new RGBA surface, so EXIF/XMP/ICC/comments cannot survive.
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(source) as original:
            if original.format not in ("PNG", "JPEG"):
                raise ValueError("O conteúdo da imagem não é PNG/JPEG.")
            if getattr(original, "n_frames", 1) != 1:
                raise ValueError("Use uma imagem estática, sem animação.")
            if max(original.size) > MAX_INPUT_SIDE:
                raise ValueError("Imagem excede 4096 pixels em um dos eixos.")
            oriented = ImageOps.exif_transpose(original).convert("RGBA")
    w, h = oriented.size
    crop = options.get("crop")
    if crop is None:
        crop = oriented.getchannel("A").getbbox()
        if crop is None:
            raise ValueError("Imagem completamente transparente.")
    left, top, right, bottom = map(int, crop)
    if not (0 <= left < right <= w and 0 <= top < bottom <= h):
        raise ValueError("crop fora dos limites da imagem já orientada pelo EXIF.")
    cropped = oriented.crop((left, top, right, bottom))
    cw, ch = cropped.size
    feet = options.get("feet", ((left + right) / 2, bottom))
    fx, fy = feet[0] - left, feet[1] - top
    if not (0 < fx < cw and 0 < fy <= ch):
        raise ValueError("feet deve ficar dentro do recorte, podendo coincidir com a borda inferior.")
    ratio = min(options.get("height", 106) / fy, (PIVOT[0] - 1) / fx, (WIDTH - PIVOT[0] - 1) / (cw - fx))
    if ch > fy:
        ratio = min(ratio, (HEIGHT - PIVOT[1] - 1) / (ch - fy))
    size = (max(1, round(cw * ratio * scale)), max(1, round(ch * ratio * scale)))
    resized = cropped.resize(size, Image.Resampling.LANCZOS)
    cell = Image.new("RGBA", (WIDTH * scale, HEIGHT * scale), (0, 0, 0, 0))
    # Use actual rounded resize scales to keep the source feet on the pivot.
    offset = (round(PIVOT[0] * scale - fx * size[0] / cw), round(PIVOT[1] * scale - fy * size[1] / ch))
    cell.alpha_composite(resized, offset)
    return cell


def prepare(folder: Path | None, *, config: Path | None = None, scale: int = 1) -> tuple[bytes, dict]:
    """Return atlas bytes + public metadata; None explicitly means no cartoons."""
    if scale not in (1, 2):
        raise ValueError("Escala permitida: 1 ou 2.")
    options = _read_options(config)
    manifest = {"version": 1, "anchor": "feet-center", "logical": {"width": WIDTH, "height": HEIGHT, "pivot": list(PIVOT), "footprint": [34, 14]}, "scale": scale, "atlas": None, "entries": []}
    if folder is None:
        if options:
            raise ValueError("Enquadramentos sem imagens de entrada não são permitidos.")
        return b"", manifest
    sources = _sources(folder)
    if set(options) - {f"{student_id:03d}" for student_id, _ in sources}:
        raise ValueError("Configuração contém um ID sem imagem correspondente.")
    columns = min(8, len(sources))
    rows = math.ceil(len(sources) / columns)
    width, height = columns * WIDTH * scale, rows * HEIGHT * scale
    if width * height * 4 > MAX_DECODED_BYTES:
        raise ValueError("Atlas excede o orçamento de 6 MiB decodificado no navegador.")
    Image, ImageOps = _pillow()
    atlas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for index, (student_id, source) in enumerate(sources):
        cell = _cell(source, options.get(f"{student_id:03d}", {}), scale, Image, ImageOps)
        x, y = (index % columns) * WIDTH * scale, (index // columns) * HEIGHT * scale
        atlas.alpha_composite(cell, (x, y))
        manifest["entries"].append({"id": student_id, "rect": [x, y, WIDTH * scale, HEIGHT * scale]})
    stream = io.BytesIO()
    atlas.save(stream, format="WEBP", quality=82, method=6, exact=True)
    payload = stream.getvalue()
    if len(payload) > MAX_ATLAS_BYTES:
        raise ValueError("Atlas excede 128 KiB; use escala 1 ou simplifique as imagens antes de tentar novamente.")
    manifest["atlas"] = {"url": "/avatars.webp", "width": width, "height": height, "sha256": hashlib.sha256(payload).hexdigest()}
    if len(_json(manifest).encode("ascii")) > MAX_MANIFEST_BYTES:
        raise ValueError("Manifesto público excede 8 KiB.")
    return payload, manifest


def header(payload: bytes, manifest: dict) -> str:
    metadata = _json(manifest)
    if len(payload) > MAX_ATLAS_BYTES or len(metadata.encode("ascii")) > MAX_MANIFEST_BYTES:
        raise ValueError("Assets excedem o orçamento de incorporação.")
    digest = hashlib.sha256(metadata.encode("ascii") + payload).hexdigest()
    lines = ["#pragma once", "/* Generated by tools/prepare_avatars.py. ID-only public assets; no source metadata. */", 'static const char CONEXA_AVATAR_MIME[] = "image/webp";', "static const unsigned char CONEXA_AVATAR_ATLAS[] = {"]
    for start in range(0, len(payload), 16):
        lines.append("    " + ", ".join(f"0x{n:02x}" for n in payload[start:start + 16]) + ",")
    if not payload:
        lines.append("    0x00 /* C arrays must be nonempty; exported length is zero. */")
    lines.extend(["};", f"static const unsigned int CONEXA_AVATAR_ATLAS_LEN = {len(payload)}u;", f"static const char CONEXA_AVATAR_MANIFEST[] = {json.dumps(metadata)};", f"static const unsigned int CONEXA_AVATAR_MANIFEST_LEN = {len(metadata)}u;", f'static const char CONEXA_AVATAR_ETAG[] = "\\\"{digest[:24]}\\\"";', ""])
    return "\n".join(lines)


def _write_changed(path: Path, content: bytes) -> None:
    if path.exists() and path.read_bytes() == content:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(content)
    temporary.replace(path)


def generate(folder: Path | None, target: Path, *, config: Path | None = None, scale: int = 1, assets_dir: Path | None = None) -> dict:
    payload, manifest = prepare(folder, config=config, scale=scale)
    encoded_header = header(payload, manifest).encode("ascii")
    # Validation completes before any target is replaced.
    _write_changed(target, encoded_header)
    if assets_dir is not None:
        _write_changed(assets_dir / "avatars.json", (_json(manifest) + "\n").encode("ascii"))
        # An empty file replaces an old atlas on explicit --empty; the manifest
        # instructs consumers not to request it (atlas:null).
        _write_changed(assets_dir / "avatars.webp", payload)
    return {"count": len(manifest["entries"]), "scale": scale, "atlas_bytes": len(payload), "decoded_bytes": (manifest["atlas"]["width"] * manifest["atlas"]["height"] * 4 if payload else 0), "manifest_bytes": len(_json(manifest)), "header_sha256": hashlib.sha256(encoded_header).hexdigest(), "atlas_sha256": hashlib.sha256(payload).hexdigest()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--input", type=Path, help="Pasta local com 001.png..044.png (JPG/JPEG também).")
    selection.add_argument("--empty", action="store_true", help="Preparar fallback procedural, sem imagens de alunos.")
    parser.add_argument("--config", type=Path, help="JSON opcional de enquadramento por ID.")
    parser.add_argument("--scale", type=int, choices=(1, 2), default=1)
    parser.add_argument("--header", type=Path, default=ROOT / "include" / "avatar_assets.h")
    parser.add_argument("--assets-dir", type=Path, help="Cópia opcional do atlas e manifesto para inspeção local.")
    args = parser.parse_args()
    try:
        result = generate(args.input, args.header, config=args.config, scale=args.scale, assets_dir=args.assets_dir)
    except (OSError, ValueError, SyntaxError) as exc:
        print(f"Não foi possível preparar avatares: {exc}", file=sys.stderr)
        return 1
    print(_json(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
