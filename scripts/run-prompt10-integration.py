from pathlib import Path
import base64
import gzip
import hashlib

parts_dir = Path("scripts/.prompt10-payload")
encoded = "".join(path.read_text(encoding="utf-8") for path in sorted(parts_dir.glob("part*")))
source = gzip.decompress(base64.b64decode(encoded))
expected = "dd31b28beae634e125fe836f46e3c9c2e34a6a8ede81801c40c28faf637cd8ec"
actual = hashlib.sha256(source).hexdigest()
if actual != expected:
    raise SystemExit(f"Prompt 10 payload checksum mismatch: {actual}")
code = compile(source, "scripts/apply-prompt10-integration.py", "exec")
exec(code, {"__name__": "__main__"})
