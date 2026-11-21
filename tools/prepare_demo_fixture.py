"""Generate an abstract synthetic avatar for the local tests only."""
from pathlib import Path
import sys
import tempfile
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from test_avatars import synthetic_avatar, avatars
with tempfile.TemporaryDirectory(prefix="conexa-demo-avatar-") as directory:
    source = Path(directory)
    synthetic_avatar(source / "007.png")
    target = ROOT / "evidence" / "game-v1" / "avatar-test"
    avatars.generate(source, target / "avatar_assets.h", assets_dir=target)
print("Synthetic avatar fixture generated.")
