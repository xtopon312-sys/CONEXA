"""Offline avatar conversion tests. All artwork here is a synthetic test fixture."""
from __future__ import annotations

import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw, PngImagePlugin

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("prepare_avatars", ROOT / "tools" / "prepare_avatars.py")
avatars = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(avatars)


def synthetic_avatar(path: Path, *, color=(31, 145, 177, 255)) -> None:
    """An abstract test mannequin, never an invented student's cartoon."""
    image = Image.new("RGBA", (124, 236), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((43, 8, 81, 46), fill=(199, 152, 111, 255))
    draw.rounded_rectangle((26, 50, 98, 137), radius=10, fill=color)
    draw.rectangle((35, 132, 53, 210), fill=(32, 48, 64, 255))
    draw.rectangle((71, 132, 89, 210), fill=(32, 48, 64, 255))
    draw.rectangle((29, 202, 54, 214), fill=(239, 241, 245, 255))
    draw.rectangle((70, 202, 96, 214), fill=(239, 241, 245, 255))
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("Description", "SYNTHETIC_METADATA_MUST_NOT_SURVIVE")
    image.save(path, pnginfo=metadata)


class AvatarPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="conexa-avatar-test-")
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.inputs = self.folder / "inputs"
        self.inputs.mkdir()

    def test_empty_fallback_needs_no_image_library(self):
        with patch.object(avatars, "_pillow", side_effect=AssertionError("Pillow should not load")):
            payload, manifest = avatars.prepare(None)
        self.assertEqual(payload, b"")
        self.assertEqual(manifest["entries"], [])
        self.assertIsNone(manifest["atlas"])
        self.assertIn("CONEXA_AVATAR_ATLAS_LEN = 0u", avatars.header(payload, manifest))
        self.assertEqual(manifest["logical"]["pivot"], [31, 106])

    def test_id_7_rgba_size_pivot_and_metadata_removal(self):
        synthetic_avatar(self.inputs / "007.png")
        payload, manifest = avatars.prepare(self.inputs)
        self.assertEqual(manifest["entries"], [{"id": 7, "rect": [0, 0, 62, 118]}])
        with Image.open(io.BytesIO(payload)) as decoded:
            self.assertEqual(decoded.size, (62, 118))
            self.assertNotIn("exif", decoded.info)
            self.assertNotIn("xmp", decoded.info)
            self.assertNotIn("icc_profile", decoded.info)
            bounds = decoded.getchannel("A").getbbox()
            self.assertEqual(bounds[3], 106)
        self.assertNotIn(b"SYNTHETIC_METADATA", payload)
        self.assertLess(len(payload), avatars.MAX_ATLAS_BYTES)

    def test_jpg_orientation_is_applied_and_metadata_removed(self):
        image = Image.new("RGB", (40, 120), (80, 120, 200))
        exif = image.getexif()
        exif[274] = 6
        exif[315] = "SYNTHETIC_PRIVATE_METADATA"
        image.save(self.inputs / "007.jpg", exif=exif)
        payload, _ = avatars.prepare(self.inputs)
        with Image.open(io.BytesIO(payload)) as decoded:
            bounds = decoded.getchannel("A").getbbox()
            self.assertGreater(bounds[2] - bounds[0], bounds[3] - bounds[1])
            self.assertEqual(len(decoded.getexif()), 0)
        self.assertNotIn(b"SYNTHETIC_PRIVATE", payload)

    def test_deterministic_output_and_unchanged_write(self):
        synthetic_avatar(self.inputs / "007.png")
        target = self.folder / "generated.h"
        first = avatars.generate(self.inputs, target)
        timestamp = target.stat().st_mtime_ns
        content = target.read_bytes()
        second = avatars.generate(self.inputs, target)
        self.assertEqual(first, second)
        self.assertEqual(target.read_bytes(), content)
        self.assertEqual(target.stat().st_mtime_ns, timestamp)

    def test_44_ids_and_scale_2_respect_decoded_budget(self):
        for student_id in range(1, 45):
            synthetic_avatar(self.inputs / f"{student_id:03d}.png", color=(student_id * 5 % 255, 100, 180, 255))
        for scale in (1, 2):
            with self.subTest(scale=scale):
                payload, manifest = avatars.prepare(self.inputs, scale=scale)
                self.assertEqual([entry["id"] for entry in manifest["entries"]], list(range(1, 45)))
                self.assertEqual((manifest["atlas"]["width"], manifest["atlas"]["height"]), (496 * scale, 708 * scale))
                self.assertLessEqual(496 * scale * 708 * scale * 4, avatars.MAX_DECODED_BYTES)
                self.assertLessEqual(len(payload), avatars.MAX_ATLAS_BYTES)
                self.assertLessEqual(len(avatars._json(manifest)), avatars.MAX_MANIFEST_BYTES)

    def test_sparse_ids_are_sorted_and_not_renumbered(self):
        for student_id in (44, 7, 3):
            synthetic_avatar(self.inputs / f"{student_id:03d}.png")
        _, manifest = avatars.prepare(self.inputs)
        self.assertEqual([entry["id"] for entry in manifest["entries"]], [3, 7, 44])
        self.assertEqual(manifest["entries"][1]["rect"], [62, 0, 62, 118])

    def test_invalid_id_and_duplicate_formats_are_rejected(self):
        for name in ("000.png", "045.png", "7.png", "nome.png"):
            with self.subTest(name=name):
                source = self.inputs / name
                synthetic_avatar(source)
                with self.assertRaises(ValueError):
                    avatars.prepare(self.inputs)
                source.unlink()
        synthetic_avatar(self.inputs / "007.png")
        Image.new("RGB", (10, 30)).save(self.inputs / "007.jpg")
        with self.assertRaisesRegex(ValueError, "mais de uma"):
            avatars.prepare(self.inputs)

    def test_empty_directory_and_missing_directory_are_explicit_errors(self):
        for folder in (self.inputs, self.folder / "missing"):
            with self.assertRaises(ValueError):
                avatars.prepare(folder)

    def test_invalid_image_transparency_animation_and_size_are_rejected(self):
        source = self.inputs / "007.png"
        source.write_bytes(b"not an image")
        with self.assertRaises(OSError):
            avatars.prepare(self.inputs)
        Image.new("RGBA", (100, 100), (0, 0, 0, 0)).save(source)
        with self.assertRaisesRegex(ValueError, "transparente"):
            avatars.prepare(self.inputs)
        Image.new("RGB", (4097, 1)).save(source)
        with self.assertRaisesRegex(ValueError, "4096"):
            avatars.prepare(self.inputs)
        Image.new("RGBA", (10, 30), "red").save(source, save_all=True, append_images=[Image.new("RGBA", (10, 30), "blue")], duration=100)
        with self.assertRaisesRegex(ValueError, "animação"):
            avatars.prepare(self.inputs)
        source.write_bytes(b"x" * (avatars.MAX_INPUT_BYTES + 1))
        with self.assertRaisesRegex(ValueError, "8 MiB"):
            avatars.prepare(self.inputs)
        source.unlink()
        unsupported = self.inputs / "007.gif"
        Image.new("RGB", (10, 30)).save(unsupported)
        with self.assertRaisesRegex(ValueError, "Formato"):
            avatars.prepare(self.inputs)

    def test_manual_crop_feet_height_and_invalid_options(self):
        synthetic_avatar(self.inputs / "007.png")
        config = self.folder / "layout.json"
        config.write_text(json.dumps({"version": 1, "avatars": {"007": {"crop": [20, 0, 104, 220], "feet": [62, 215], "height": 100}}}))
        payload, _ = avatars.prepare(self.inputs, config=config)
        self.assertTrue(payload)
        for options in ({"crop": [0, 0, 500, 500]}, {"feet": [0, 0]}, {"height": 1000}, {"name": "forbidden"}, {"feet": [float("nan"), 106]}):
            config.write_text(json.dumps({"version": 1, "avatars": {"007": options}}))
            with self.assertRaises(ValueError):
                avatars.prepare(self.inputs, config=config)

    def test_failed_validation_preserves_existing_header(self):
        synthetic_avatar(self.inputs / "007.png")
        target = self.folder / "generated.h"
        target.write_bytes(b"existing baseline")
        with patch.object(avatars, "MAX_ATLAS_BYTES", 1):
            with self.assertRaisesRegex(ValueError, "128 KiB"):
                avatars.generate(self.inputs, target)
        self.assertEqual(target.read_bytes(), b"existing baseline")

    def test_manifest_has_only_public_contract_and_optional_outputs(self):
        synthetic_avatar(self.inputs / "007.png")
        output = self.folder / "assets"
        info = avatars.generate(self.inputs, self.folder / "assets.h", assets_dir=output)
        self.assertEqual(info["count"], 1)
        metadata = json.loads((output / "avatars.json").read_text())
        self.assertEqual(set(metadata), {"version", "anchor", "logical", "scale", "atlas", "entries"})
        self.assertEqual(set(metadata["entries"][0]), {"id", "rect"})
        self.assertEqual(len((output / "avatars.webp").read_bytes()), info["atlas_bytes"])
        avatars.generate(None, self.folder / "assets.h", assets_dir=output)
        self.assertEqual((output / "avatars.webp").read_bytes(), b"")
        self.assertIsNone(json.loads((output / "avatars.json").read_text())["atlas"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
