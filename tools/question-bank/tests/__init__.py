"""Put the question-bank tool root and importers/ on sys.path for unittest."""

from __future__ import annotations

import sys
from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parents[1]
IMPORTERS = TOOL_ROOT / "importers"

for path in (str(TOOL_ROOT), str(IMPORTERS)):
    if path not in sys.path:
        sys.path.insert(0, path)
