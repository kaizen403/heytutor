"""Read-only original control namespace. Never dispatch or mutate original evidence."""
import importlib.util
from pathlib import Path

ORIGINAL_DIR = Path(__file__).resolve().parent.parent / "measurement"
_spec = importlib.util.spec_from_file_location("h3r8_original_invariants", ORIGINAL_DIR / "measurement_core.py")
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
globals().update({name: value for name, value in vars(_module).items() if not name.startswith("_")})

