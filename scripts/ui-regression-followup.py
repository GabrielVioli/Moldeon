from pathlib import Path

canvas_path = Path("apps/web/src/editor/PatternCanvas.tsx")
canvas_source = canvas_path.read_text(encoding="utf-8")


def replace_canvas_once(old: str, new: str) -> None:
    global canvas_source
    count = canvas_source.count(old)
    if count != 1:
        raise SystemExit(
            f"PatternCanvas follow-up expected one occurrence, found {count}: {old[:120]!r}"
        )
    canvas_source = canvas_source.replace(old, new)


replace_canvas_once("  type WheelEvent,\n", "")
replace_canvas_once(
    "    contextRef.current = context;\n",
    "    contextRef.current = context;\n"
    "    const nativeWheel = (event: globalThis.WheelEvent) => handleWheel(event);\n"
    "    canvas.addEventListener(\"wheel\", nativeWheel, { passive: false });\n",
)
replace_canvas_once(
    "      observer.disconnect();\n",
    "      observer.disconnect();\n"
    "      canvas.removeEventListener(\"wheel\", nativeWheel);\n",
)
replace_canvas_once(
    "  function handleWheel(event: WheelEvent<HTMLCanvasElement>) {\n",
    "  function handleWheel(event: globalThis.WheelEvent) {\n",
)
replace_canvas_once(
    "    const rect = event.currentTarget.getBoundingClientRect();\n"
    "    const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };\n",
    "    const canvas = canvasRef.current;\n"
    "    if (!canvas) return;\n"
    "    const rect = canvas.getBoundingClientRect();\n"
    "    const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };\n",
)
replace_canvas_once("      onWheel={handleWheel}\n", "")
canvas_path.write_text(canvas_source, encoding="utf-8")


audit_path = Path("scripts/ui-regression-audit.mjs")
audit_source = audit_path.read_text(encoding="utf-8")


def replace_audit_once(old: str, new: str) -> None:
    global audit_source
    count = audit_source.count(old)
    if count != 1:
        raise SystemExit(
            f"UI audit follow-up expected one occurrence, found {count}: {old[:120]!r}"
        )
    audit_source = audit_source.replace(old, new)


replace_audit_once(
    "    await page.mouse.down();\n"
    "    await page.mouse.move(center.x + 52, center.y + 24, { steps: 5 });\n",
    "    await page.mouse.down();\n"
    "    await page.waitForTimeout(20);\n"
    "    assert(await page.evaluate(() => {\n"
    "      const element = document.querySelector(\"canvas[aria-label='Editor de molde 2D']\");\n"
    "      return Boolean(element && window.__uiPointerId !== null && element.hasPointerCapture(window.__uiPointerId));\n"
    "    }), \"setPointerCapture não ficou ativo durante o pointerdown.\");\n"
    "    await page.mouse.move(center.x + 52, center.y + 24, { steps: 5 });\n",
)
replace_audit_once(
    "    assert(await page.evaluate(() => window.__uiCaptureObserved === true), \"setPointerCapture não foi observado no pointerdown.\");\n",
    "",
)
replace_audit_once(
    "    await page.locator(\".pieces-name\").first().click();\n"
    "    await page.keyboard.press(\"Control+d\");\n"
    "    await page.keyboard.press(\"Control+a\");\n"
    "    await page.getByRole(\"button\", { name: \"Enquadrar seleção\", exact: true }).click();\n"
    "    await page.waitForTimeout(100);\n",
    "    await page.locator(\".pieces-name\").first().click();\n"
    "    await page.keyboard.press(\"Control+d\");\n"
    "    await page.getByRole(\"button\", { name: \"Enquadrar seleção\", exact: true }).click();\n"
    "    await page.waitForTimeout(100);\n"
    "    const firstCheckbox = page.locator(\".pieces-item input[type='checkbox']\").first();\n"
    "    if (!(await firstCheckbox.isChecked())) await firstCheckbox.click();\n"
    "    await page.waitForTimeout(60);\n",
)
replace_audit_once(
    "    assert(changed.length === before.selectedPieceIds.length, \"Nem todas e somente as peças selecionadas se moveram.\");\n",
    "    assert(changed.length === before.selectedPieceIds.length, `Nem todas e somente as peças selecionadas se moveram. selected=${before.selectedPieceIds.join(\",\")} changed=${changed.join(\",\")}`);\n",
)
replace_audit_once(
    "    await client.send(\"Input.dispatchTouchEvent\", { type: \"touchStart\", touchPoints: [{ x: x - 35, y }, { x: x + 35, y }] });\n"
    "    await client.send(\"Input.dispatchTouchEvent\", { type: \"touchMove\", touchPoints: [{ x: x - 58, y }, { x: x + 58, y }] });\n"
    "    await client.send(\"Input.dispatchTouchEvent\", { type: \"touchEnd\", touchPoints: [] });\n"
    "    await page.waitForTimeout(120);\n",
    "    await client.send(\"Input.dispatchTouchEvent\", {\n"
    "      type: \"touchStart\",\n"
    "      touchPoints: [\n"
    "        { id: 1, x: x - 35, y, radiusX: 3, radiusY: 3, force: 1 },\n"
    "        { id: 2, x: x + 35, y, radiusX: 3, radiusY: 3, force: 1 },\n"
    "      ],\n"
    "    });\n"
    "    await page.waitForTimeout(60);\n"
    "    await client.send(\"Input.dispatchTouchEvent\", {\n"
    "      type: \"touchMove\",\n"
    "      touchPoints: [\n"
    "        { id: 1, x: x - 65, y, radiusX: 3, radiusY: 3, force: 1 },\n"
    "        { id: 2, x: x + 65, y, radiusX: 3, radiusY: 3, force: 1 },\n"
    "      ],\n"
    "    });\n"
    "    await page.waitForTimeout(100);\n"
    "    await client.send(\"Input.dispatchTouchEvent\", { type: \"touchEnd\", touchPoints: [] });\n"
    "    await page.waitForTimeout(140);\n",
)
replace_audit_once(
    "    window.__uiCaptureObserved = false;\n"
    "    const canvas = document.querySelector(\"canvas[aria-label='Editor de molde 2D']\");\n"
    "    canvas.addEventListener(\"pointerdown\", (event) => {\n"
    "      queueMicrotask(() => { window.__uiCaptureObserved = canvas.hasPointerCapture(event.pointerId); });\n"
    "    }, { once: true });\n",
    "    window.__uiPointerId = null;\n"
    "    const canvas = document.querySelector(\"canvas[aria-label='Editor de molde 2D']\");\n"
    "    canvas.addEventListener(\"pointerdown\", (event) => {\n"
    "      window.__uiPointerId = event.pointerId;\n"
    "    }, { once: true });\n",
)
audit_path.write_text(audit_source, encoding="utf-8")

print("Non-passive wheel listener and deterministic audit patch applied")
