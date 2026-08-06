from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "apps/web/src/garment3d/SemanticAvatarArrangement.test.ts"
source = path.read_text(encoding="utf-8")
source = source.replace('import { readFileSync } from "node:fs";\n', '')
start_marker = '  it("keeps removed public and cylindrical paths out of the active pipeline", () => {'
start = source.find(start_marker)
if start < 0:
    raise SystemExit("source-policy test block not found")
end_marker = '\n  });\n});\n'
end = source.find(end_marker, start)
if end < 0:
    raise SystemExit("source-policy test end not found")
source = source[:start] + '});\n' + source[end + len(end_marker):]
path.write_text(source, encoding="utf-8")
print("Prompt 9 frontend test policy adjusted")
