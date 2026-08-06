from pathlib import Path
import base64
import gzip
import hashlib

parts = Path("scripts/.prompt11-payload")
encoded = "".join(path.read_text(encoding="utf-8") for path in sorted(parts.glob("part*")))
source = gzip.decompress(base64.b64decode(encoded))
expected = "0195ca5fdc389cc217075f5a20ab1abca6cd8bad63d9acb8dc7981475f3d9291"
actual = hashlib.sha256(source).hexdigest()
if actual != expected:
    raise SystemExit(f"Prompt 11 payload checksum mismatch: {actual}")
exec(compile(source, "scripts/apply-prompt11.py", "exec"), {"__name__": "__main__"})
