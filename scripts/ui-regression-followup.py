from pathlib import Path

path = Path("apps/web/src/editor/PatternCanvas.tsx")
source = path.read_text(encoding="utf-8")

def replace_once(old: str, new: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"PatternCanvas follow-up expected one occurrence, found {count}: {old[:120]!r}")
    source = source.replace(old, new)

replace_once("  type WheelEvent,\n", "")
replace_once(
    "    contextRef.current = context;\n",
    "    contextRef.current = context;\n    const nativeWheel = (event: globalThis.WheelEvent) => handleWheel(event);\n    canvas.addEventListener(\"wheel\", nativeWheel, { passive: false });\n",
)
replace_once(
    "      resizeObserver.disconnect();\n",
    "      resizeObserver.disconnect();\n      canvas.removeEventListener(\"wheel\", nativeWheel);\n",
)
replace_once(
    "  function handleWheel(event: WheelEvent<HTMLCanvasElement>) {\n",
    "  function handleWheel(event: globalThis.WheelEvent) {\n",
)
replace_once(
    "    const rect = event.currentTarget.getBoundingClientRect();\n    const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };\n",
    "    const canvas = canvasRef.current;\n    if (!canvas) return;\n    const rect = canvas.getBoundingClientRect();\n    const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };\n",
)
replace_once("      onWheel={handleWheel}\n", "")
path.write_text(source, encoding="utf-8")
print("Non-passive wheel listener patch applied")
