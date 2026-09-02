from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing patch anchor: {label}")
    return text.replace(old, new, 1)

# 1) Load the two reviewed mobile layers from PR #14 and our 11.0.7a layer last.
main = Path("apps/web/src/main.tsx")
text = main.read_text()
text = replace_once(
    text,
    'import "./responsive-workspace-polish.css";\n',
    'import "./responsive-workspace-polish.css";\nimport "./mobile-touch-workspace.css";\nimport "./mobile-touch-workspace-v2.css";\nimport "./mobile-touch-workspace-11-0-7a.css";\n',
    "main mobile imports",
)
main.write_text(text)

# 2) PWA / standalone shell metadata. No service worker or caching policy is introduced.
index = Path("apps/web/index.html")
text = index.read_text()
text = replace_once(
    text,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />',
    "viewport-fit",
)
text = replace_once(
    text,
    '<meta name="theme-color" content="#111214" />',
    '<meta name="theme-color" content="#111214" />\n    <meta name="mobile-web-app-capable" content="yes" />\n    <meta name="apple-mobile-web-app-capable" content="yes" />\n    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />\n    <meta name="apple-mobile-web-app-title" content="Moldeon" />\n    <link rel="manifest" href="/manifest.webmanifest" />',
    "mobile app metadata",
)
index.write_text(text)

manifest = Path("apps/web/public/manifest.webmanifest")
manifest.write_text('''{
  "name": "Moldeon",
  "short_name": "Moldeon",
  "description": "Modelagem 2D e montagem de roupas em 3D.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#f4f1eb",
  "theme_color": "#111214",
  "lang": "pt-BR"
}
''')

# 3) Explicit touch multi-select mode in the 3D viewport UI.
garment = Path("apps/web/src/viewport/GarmentViewport.tsx")
text = garment.read_text()
text = replace_once(
    text,
    '  const [arrangementNotice, setArrangementNotice] = useState<string | null>(null);\n  const arrangementToolRef = useRef<ArrangementTool>(arrangementTool);\n  const arrangementAxisRef = useRef<ArrangementAxis>(arrangementAxis);',
    '  const [arrangementNotice, setArrangementNotice] = useState<string | null>(null);\n  const [touchMultiSelect, setTouchMultiSelect] = useState(false);\n  const arrangementToolRef = useRef<ArrangementTool>(arrangementTool);\n  const arrangementAxisRef = useRef<ArrangementAxis>(arrangementAxis);\n  const touchMultiSelectRef = useRef(touchMultiSelect);',
    "touch multiselect state",
)
text = replace_once(
    text,
    '  arrangementToolRef.current = arrangementTool;\n  arrangementAxisRef.current = arrangementAxis;',
    '  arrangementToolRef.current = arrangementTool;\n  arrangementAxisRef.current = arrangementAxis;\n  touchMultiSelectRef.current = touchMultiSelect;',
    "touch multiselect ref",
)
text = replace_once(
    text,
    '        viewport.setArrangementTool(arrangementToolRef.current);\n        viewport.setArrangementAxis(arrangementAxisRef.current);',
    '        viewport.setArrangementTool(arrangementToolRef.current);\n        viewport.setArrangementAxis(arrangementAxisRef.current);\n        viewport.setArrangementTouchMultiSelect(touchMultiSelectRef.current);',
    "initialize touch multiselect",
)
text = replace_once(
    text,
    '  useEffect(() => {\n    arrangementAxisRef.current = arrangementAxis;\n    viewportRef.current?.setArrangementAxis(arrangementAxis);\n  }, [arrangementAxis]);\n',
    '  useEffect(() => {\n    arrangementAxisRef.current = arrangementAxis;\n    viewportRef.current?.setArrangementAxis(arrangementAxis);\n  }, [arrangementAxis]);\n\n  useEffect(() => {\n    touchMultiSelectRef.current = touchMultiSelect;\n    viewportRef.current?.setArrangementTouchMultiSelect(touchMultiSelect);\n  }, [touchMultiSelect]);\n',
    "touch multiselect effect",
)
# Human-readable singular/plural and touch hint.
text = replace_once(
    text,
    '              ? `${selectedArrangementIds.length} selecionada(s) · ${selectedArrangementState}`\n              : "Selecione uma peça"}</strong>\n            <small role={arrangementNotice ? "status" : undefined}>{arrangementNotice ?? (arrangementTool === "move"\n              ? arrangementAxis === "free" ? "Arraste a peça livremente" : `Arraste o handle ${arrangementAxis.toUpperCase()}`\n              : `Arraste o arco ${(arrangementAxis === "free" ? "z" : arrangementAxis).toUpperCase()}`)}</small>',
    '              ? `${selectedArrangementIds.length === 1 ? "1 selecionada" : `${selectedArrangementIds.length} selecionadas`} · ${selectedArrangementState}`\n              : "Selecione uma peça"}</strong>\n            <small role={arrangementNotice ? "status" : undefined}>{arrangementNotice ?? (touchMultiSelect\n              ? "Toque nas peças para adicionar ou remover da seleção"\n              : arrangementTool === "move"\n                ? arrangementAxis === "free" ? "Arraste a peça livremente" : `Arraste o handle ${arrangementAxis.toUpperCase()}`\n                : `Arraste o arco ${(arrangementAxis === "free" ? "z" : arrangementAxis).toUpperCase()}`)}</small>',
    "arrangement mobile hint",
)
text = text.replace('className="arrangement-tool-button"', 'className="arrangement-tool-button arrangement-primary-action"')
# Add class only to the Adjust button using its unique callback text.
text = replace_once(
    text,
    '<button type="button" disabled={selectedArrangementIds.length === 0} onClick={() => {\n              const outcome = viewportRef.current?.adjustArrangementSelectionToBody();',
    '<button type="button" className="arrangement-primary-action" disabled={selectedArrangementIds.length === 0} onClick={() => {\n              const outcome = viewportRef.current?.adjustArrangementSelectionToBody();',
    "adjust primary class",
)
text = replace_once(
    text,
    '<button type="button" disabled={selectedArrangementIds.length === 0} onClick={() => viewportRef.current?.flipArrangementSelection()}>Virar face</button>',
    '<button type="button" className="arrangement-secondary-action" disabled={selectedArrangementIds.length === 0} onClick={() => viewportRef.current?.flipArrangementSelection()}>Virar face</button>',
    "flip secondary class",
)
text = replace_once(
    text,
    '              type="button"\n              disabled={selectedArrangementIds.length === 0}\n              aria-pressed={selectionPinned}',
    '              type="button"\n              className="arrangement-secondary-action"\n              disabled={selectedArrangementIds.length === 0}\n              aria-pressed={selectionPinned}',
    "pin secondary class",
)
text = replace_once(
    text,
    '<button type="button" disabled={selectedArrangementIds.length === 0} onClick={() => viewportRef.current?.focusArrangementSelection()}>Focar</button>',
    '<button type="button" className="arrangement-secondary-action" disabled={selectedArrangementIds.length === 0} onClick={() => viewportRef.current?.focusArrangementSelection()}>Focar</button>',
    "focus secondary class",
)
text = replace_once(
    text,
    '<details className="viewport-arrangement-more">\n              <summary aria-label="Ajustes de rotação">Rotação fina</summary>',
    '<details className="viewport-arrangement-more arrangement-desktop-more">\n              <summary aria-label="Ajustes de rotação">Rotação fina</summary>',
    "desktop more class",
)
mobile_controls = '''            <button
              type="button"
              className="arrangement-mobile-multiselect"
              aria-pressed={touchMultiSelect}
              onClick={() => setTouchMultiSelect((current) => !current)}
            >{touchMultiSelect ? "Concluir" : "Várias"}</button>
            <details className="viewport-arrangement-more arrangement-mobile-more">
              <summary aria-label="Mais ações da montagem">Mais</summary>
              <div>
                <button type="button" disabled={selectedArrangementIds.length === 0} onClick={() => viewportRef.current?.flipArrangementSelection()}>Virar face</button>
                <button
                  type="button"
                  disabled={selectedArrangementIds.length === 0}
                  aria-pressed={selectionPinned}
                  onClick={() => setSelectionPinned(viewportRef.current?.toggleArrangementPin() ?? false)}
                >{selectionPinned ? "Soltar" : "Fixar"}</button>
                <button type="button" disabled={selectedArrangementIds.length === 0} onClick={() => viewportRef.current?.focusArrangementSelection()}>Focar</button>
                <div className="arrangement-rotation-grid">
                  {(["x", "y", "z"] as const).flatMap((axis) => ([
                    <button key={`mobile-${axis}-minus`} type="button" disabled={selectedArrangementIds.length === 0} onClick={() => viewportRef.current?.rotateArrangementSelection(axis, -15)}>{axis.toUpperCase()} −15°</button>,
                    <button key={`mobile-${axis}-plus`} type="button" disabled={selectedArrangementIds.length === 0} onClick={() => viewportRef.current?.rotateArrangementSelection(axis, 15)}>{axis.toUpperCase()} +15°</button>,
                  ]))}
                </div>
              </div>
            </details>
'''
text = replace_once(
    text,
    '            </details>\n          </div>\n        </div>\n      ) : null}',
    '            </details>\n' + mobile_controls + '          </div>\n        </div>\n      ) : null}',
    "mobile arrangement actions",
)
garment.write_text(text)

# 4) Touch semantics inside the Three viewport. One finger on a piece/gizmo manipulates it;
# one finger on background orbits; two fingers dolly/pan; touch multi-select is explicit.
viewport = Path("apps/web/src/viewport/GlobalThreeViewport.ts")
text = viewport.read_text()
text = replace_once(
    text,
    'export type ArrangementAxis = "free" | "x" | "y" | "z";\n',
    'export type ArrangementAxis = "free" | "x" | "y" | "z";\n\nexport function shouldExtendArrangementSelection(input: {\n  ctrlKey: boolean;\n  metaKey: boolean;\n  shiftKey: boolean;\n  pointerType: string;\n  touchMultiSelect: boolean;\n}): boolean {\n  return input.ctrlKey || input.metaKey || input.shiftKey\n    || (input.pointerType === "touch" && input.touchMultiSelect);\n}\n\nexport function arrangementGizmoTargetPixels(width: number, height: number, coarsePointer: boolean): number {\n  if (!coarsePointer || Math.min(width, height) > 900) return 86;\n  return width > height ? 64 : 70;\n}\n',
    "mobile arrangement helpers",
)
text = replace_once(
    text,
    '  private arrangementAxis: ArrangementAxis = "free";\n  private dragState: ArrangementDragState | null = null;',
    '  private arrangementAxis: ArrangementAxis = "free";\n  private arrangementTouchMultiSelect = false;\n  private dragState: ArrangementDragState | null = null;',
    "touch multiselect property",
)
text = replace_once(
    text,
    '    this.controls.screenSpacePanning = true;\n    this.controls.addEventListener("change", this.requestRender);',
    '    this.controls.screenSpacePanning = true;\n    this.controls.touches.ONE = THREE.TOUCH.ROTATE;\n    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;\n    this.controls.addEventListener("change", this.requestRender);',
    "orbit touch bindings",
)
text = replace_once(
    text,
    '  setArrangementAxis(axis: ArrangementAxis): void {\n    this.arrangementAxis = this.arrangementTool === "rotate" && axis === "free" ? "z" : axis;\n    this.host.dataset.arrangementAxis = this.arrangementAxis;\n    this.updateArrangementGizmo();\n    this.requestRender();\n  }\n',
    '  setArrangementAxis(axis: ArrangementAxis): void {\n    this.arrangementAxis = this.arrangementTool === "rotate" && axis === "free" ? "z" : axis;\n    this.host.dataset.arrangementAxis = this.arrangementAxis;\n    this.updateArrangementGizmo();\n    this.requestRender();\n  }\n\n  setArrangementTouchMultiSelect(enabled: boolean): void {\n    this.arrangementTouchMultiSelect = enabled;\n    this.host.dataset.arrangementTouchMultiSelect = String(enabled);\n    if (enabled) this.setArrangementPointerFeedback("panel");\n    this.requestRender();\n  }\n',
    "touch multiselect API",
)
text = replace_once(
    text,
    '      const extendSelection = event.ctrlKey || event.metaKey || event.shiftKey;',
    '      const extendSelection = shouldExtendArrangementSelection({\n        ctrlKey: event.ctrlKey,\n        metaKey: event.metaKey,\n        shiftKey: event.shiftKey,\n        pointerType: event.pointerType,\n        touchMultiSelect: this.arrangementTouchMultiSelect,\n      });',
    "touch extend selection",
)
text = replace_once(
    text,
    '    const scale = worldPerPixel * 86 / 0.285;\n    this.arrangementGizmo.scale.setScalar(Math.max(0.01, scale));',
    '    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;\n    const targetPixels = arrangementGizmoTargetPixels(\n      this.renderer.domElement.clientWidth,\n      this.renderer.domElement.clientHeight,\n      coarsePointer,\n    );\n    const scale = worldPerPixel * targetPixels / 0.285;\n    this.host.dataset.arrangementGizmoTargetPx = String(targetPixels);\n    this.arrangementGizmo.scale.setScalar(Math.max(0.01, scale));',
    "mobile gizmo scale",
)
viewport.write_text(text)

# 5) Adaptive rulers. Mobile labels keep a real pixel spacing instead of collapsing at low zoom.
legacy = Path("apps/web/src/editor/PatternCanvasLegacy.tsx")
text = legacy.read_text()
start = text.index("function drawRulers(")
match = re.search(r"\nfunction [A-Za-z0-9_]+\(", text[start + 1:])
if not match:
    raise SystemExit("could not find function after drawRulers")
end = start + 1 + match.start()
new_rulers = r'''function chooseRulerMajorStepMm(minimumMm: number): number {
  const minimum = Math.max(1, minimumMm);
  const power = 10 ** Math.floor(Math.log10(minimum));
  for (const multiple of [1, 2, 5, 10]) {
    const step = power * multiple;
    if (step >= minimum) return step;
  }
  return power * 10;
}

function drawRulers(context: CanvasRenderingContext2D, width: number, height: number, camera: Camera2D) {
  const coarsePointer = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const rulerSize = coarsePointer ? 24 : 28;
  context.save();
  context.fillStyle = "#e9e7e2";
  context.fillRect(0, 0, width, rulerSize);
  context.fillRect(0, 0, rulerSize, height);
  context.strokeStyle = "#d0cdc9";
  context.beginPath();
  context.moveTo(0, rulerSize - 0.5);
  context.lineTo(width, rulerSize - 0.5);
  context.moveTo(rulerSize - 0.5, 0);
  context.lineTo(rulerSize - 0.5, height);
  context.stroke();

  context.fillStyle = "#505258";
  context.font = `${coarsePointer ? 10 : 11}px system-ui, sans-serif`;
  context.textBaseline = "top";
  context.strokeStyle = "#9c9994";

  const targetMajorPx = coarsePointer ? 88 : 64;
  const majorMm = chooseRulerMajorStepMm(targetMajorPx / Math.max(camera.zoom, 0.0001));
  const minorMm = majorMm / 5;
  const majorPx = majorMm * camera.zoom;
  const minorPx = Math.max(4, minorMm * camera.zoom);
  const majorToleranceMm = Math.max(0.001, minorMm * 0.08);

  for (let x = ((camera.panX % minorPx) + minorPx) % minorPx; x < width; x += minorPx) {
    const worldX = (x - camera.panX) / camera.zoom;
    const nearestMajor = Math.round(worldX / majorMm) * majorMm;
    const isMajor = Math.abs(worldX - nearestMajor) <= majorToleranceMm;
    const tickHeight = isMajor ? 10 : 5;
    context.beginPath();
    context.moveTo(x + 0.5, rulerSize - 1);
    context.lineTo(x + 0.5, rulerSize - 1 - tickHeight);
    context.stroke();
    if (isMajor && x >= rulerSize + 4 && x <= width - 54) {
      context.fillText(`${Math.round(nearestMajor)} mm`, x + 4, 2);
    }
  }

  context.textAlign = "left";
  for (let y = ((camera.panY % minorPx) + minorPx) % minorPx; y < height; y += minorPx) {
    const worldY = (y - camera.panY) / camera.zoom;
    const nearestMajor = Math.round(worldY / majorMm) * majorMm;
    const isMajor = Math.abs(worldY - nearestMajor) <= majorToleranceMm;
    const tickWidth = isMajor ? 10 : 5;
    context.beginPath();
    context.moveTo(rulerSize - 1, y + 0.5);
    context.lineTo(rulerSize - 1 - tickWidth, y + 0.5);
    context.stroke();
    if (isMajor && y >= rulerSize + 2 && y <= height - 16) {
      context.fillText(`${Math.round(nearestMajor)} mm`, 3, y + 2);
    }
  }
  context.restore();
}
'''
text = text[:start] + new_rulers + text[end:]
legacy.write_text(text)

# 6) Mobile-only layout layer for 11.0.7a: portrait and landscape are deliberately different.
mobile_css = Path("apps/web/src/mobile-touch-workspace-11-0-7a.css")
mobile_css.write_text(r'''/*
 * 11.0.7a mobile interaction layer.
 * Loaded after the reviewed PR #14 mobile CSS. This file only changes
 * presentation/touch affordances and the arrangement toolbar layout.
 */

.arrangement-mobile-multiselect,
.arrangement-mobile-more {
  display: none;
}

@media (pointer: coarse) {
  .three-canvas,
  .viewport-host,
  .editor-core-canvas-shell,
  .pattern-canvas {
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

  .viewport-arrangement-controls button,
  .viewport-arrangement-controls summary,
  .body-reference-2d-controls button,
  .body-reference-2d-controls select,
  .body-reference-controls button,
  .body-reference-controls select {
    min-width: 44px;
    min-height: 44px;
    -webkit-tap-highlight-color: transparent;
  }
}

@media (max-width: 760px) {
  :root {
    --mobile-11a-surface: rgba(250, 249, 246, 0.97);
    --mobile-11a-border: rgba(71, 67, 60, 0.22);
    --mobile-11a-shadow: 0 8px 24px rgba(31, 28, 23, 0.14);
  }

  /* The lower 3D tab already owns preview navigation on phones. */
  .toolbar-preview-button {
    display: none !important;
  }

  .toolbar-actions {
    gap: 3px;
  }

  /* Preserve 44px hit targets while visually shrinking the chrome. */
  .workspace-mode-switch,
  .workspace-mode-switch button {
    min-height: 40px;
  }

  .workspace-mode-switch button {
    font-size: 10px;
  }

  /* 3D: canvas first, controls second. */
  .viewport-arrangement-controls {
    top: auto !important;
    right: max(7px, env(safe-area-inset-right)) !important;
    bottom: max(7px, env(safe-area-inset-bottom)) !important;
    left: max(7px, env(safe-area-inset-left)) !important;
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) !important;
    gap: 4px !important;
    width: auto !important;
    max-width: none !important;
    min-height: 0;
    padding: 5px !important;
    border-radius: 14px !important;
    background: var(--mobile-11a-surface) !important;
    box-shadow: var(--mobile-11a-shadow) !important;
    transform: none !important;
    backdrop-filter: blur(12px);
  }

  .viewport-arrangement-status {
    display: flex !important;
    min-width: 0 !important;
    min-height: 22px;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 6px !important;
    padding: 0 5px !important;
  }

  .viewport-arrangement-status strong {
    max-width: 100%;
    font-size: 11px !important;
    line-height: 1.15;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  .viewport-arrangement-status small {
    display: none !important;
  }

  .viewport-arrangement-actions {
    display: grid !important;
    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
    gap: 4px !important;
  }

  .viewport-arrangement-actions > .arrangement-axis-controls,
  .viewport-arrangement-actions > .arrangement-secondary-action,
  .viewport-arrangement-actions > .arrangement-desktop-more {
    display: none !important;
  }

  .arrangement-mobile-multiselect,
  .arrangement-mobile-more {
    display: block !important;
  }

  .viewport-arrangement-controls button,
  .viewport-arrangement-controls summary {
    width: 100% !important;
    min-width: 0 !important;
    min-height: 46px !important;
    height: 46px;
    padding: 0 5px !important;
    border-radius: 11px !important;
    font-size: 10px !important;
  }

  .viewport-arrangement-controls button[aria-pressed="true"] {
    border-color: #8f6d15 !important;
    background: #f2dda1 !important;
  }

  .arrangement-mobile-more {
    position: relative;
  }

  .arrangement-mobile-more > summary {
    display: grid !important;
    place-items: center;
    list-style: none;
  }

  .arrangement-mobile-more > summary::-webkit-details-marker {
    display: none;
  }

  .arrangement-mobile-more > div {
    position: absolute !important;
    right: 0 !important;
    bottom: calc(100% + 6px) !important;
    top: auto !important;
    display: grid !important;
    grid-template-columns: repeat(2, minmax(86px, 1fr));
    gap: 5px !important;
    width: min(280px, calc(100vw - 20px));
    max-height: min(46dvh, 360px);
    padding: 6px !important;
    border: 1px solid var(--mobile-11a-border);
    border-radius: 13px !important;
    background: var(--mobile-11a-surface) !important;
    box-shadow: var(--mobile-11a-shadow) !important;
    overflow: auto;
    overscroll-behavior: contain;
  }

  .arrangement-mobile-more .arrangement-rotation-grid {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
  }

  /* The label is diagnostic chrome, not part of the creation surface. */
  .workspace.mode-assembly .viewport-label,
  .workspace.mode-modeling .viewport-label {
    display: none !important;
  }

  /* Body reference control lives in a corner and never over the waist/hips. */
  .body-reference-2d-controls,
  .body-reference-controls {
    position: absolute !important;
    z-index: 34 !important;
    top: 60px !important;
    right: max(7px, env(safe-area-inset-right)) !important;
    bottom: auto !important;
    left: auto !important;
    width: auto !important;
    max-width: min(218px, calc(100% - 112px)) !important;
    min-height: 42px !important;
    padding: 3px 5px !important;
    gap: 4px !important;
    border-radius: 12px !important;
    background: var(--mobile-11a-surface) !important;
    box-shadow: var(--mobile-11a-shadow) !important;
    transform: none !important;
  }

  .body-reference-2d-controls label,
  .body-reference-controls label {
    gap: 3px !important;
    font-size: 10px !important;
    white-space: nowrap;
  }

  .body-reference-2d-controls select,
  .body-reference-controls select {
    min-width: 72px !important;
    min-height: 38px !important;
    height: 38px !important;
    font-size: 16px !important;
  }

  /* Sheets stay low and out of the selected geometry. */
  .editor-core-numeric-panel {
    max-height: min(24dvh, 190px) !important;
  }

  .context-bar {
    max-height: min(24dvh, 190px) !important;
  }

  .editor-core-numeric-panel input {
    font-size: 16px !important;
  }

  .canvas-navigation {
    max-width: calc(100% - 14px) !important;
  }

  .canvas-navigation button {
    min-width: 40px !important;
  }

  /* Prevent accidental browser page gestures while the user is working. */
  .canvas-stack,
  .preview-panel,
  .viewport-host {
    overscroll-behavior: none;
  }

  /* Standalone/PWA respects iPhone safe areas. */
  @media (display-mode: standalone) {
    .toolbar {
      padding-top: max(2px, env(safe-area-inset-top));
    }
  }
}

/* Portrait phones: bottom controls are easy to reach with a thumb. */
@media (max-width: 760px) and (orientation: portrait) {
  .workspace.mode-modeling,
  .workspace.mode-assembly,
  .workspace.mode-fitting,
  .workspace.mode-preparation,
  .workspace.is-right-panel-closed.mode-modeling,
  .workspace.is-right-panel-closed.mode-assembly,
  .workspace.is-right-panel-closed.mode-fitting,
  .workspace.is-right-panel-closed.mode-preparation {
    grid-template-rows: 42px minmax(0, 1fr) !important;
  }

  .viewport-arrangement-controls {
    max-height: min(112px, 18dvh);
  }

  .workspace.mode-assembly .assembly-panel {
    max-height: min(24dvh, 200px) !important;
  }
}

/* Landscape phone: top chrome collapses to one row and 3D actions become a side rail. */
@media (max-width: 900px) and (max-height: 520px) and (orientation: landscape) {
  .toolbar {
    grid-template-columns: auto minmax(0, 1fr) auto !important;
    grid-template-rows: 44px !important;
    min-height: 44px !important;
    height: 44px;
    gap: 3px !important;
    padding: 0 max(5px, env(safe-area-inset-right)) 0 max(5px, env(safe-area-inset-left)) !important;
  }

  .workspace-mode-switch {
    grid-column: 1 !important;
    grid-row: 1 !important;
  }

  .workspace-mode-switch,
  .workspace-mode-switch button,
  .history-button,
  .toolbar-overflow > summary,
  .tool-button {
    min-height: 40px !important;
    height: 40px !important;
  }

  .workspace-mode-switch button {
    padding-inline: 7px !important;
    font-size: 9px !important;
  }

  .tool-buttons {
    grid-column: 2 !important;
    grid-row: 1 !important;
    justify-content: flex-start !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    scrollbar-width: none;
  }

  .tool-button {
    width: 40px !important;
    min-width: 40px !important;
    max-width: 40px !important;
    flex: 0 0 40px !important;
  }

  .toolbar-actions {
    grid-column: 3 !important;
    grid-row: 1 !important;
  }

  .workspace.mode-modeling,
  .workspace.mode-assembly,
  .workspace.mode-fitting,
  .workspace.mode-preparation,
  .workspace.is-right-panel-closed.mode-modeling,
  .workspace.is-right-panel-closed.mode-assembly,
  .workspace.is-right-panel-closed.mode-fitting,
  .workspace.is-right-panel-closed.mode-preparation {
    grid-template-rows: 36px minmax(0, 1fr) !important;
  }

  .mobile-workspace-tabs {
    min-height: 36px !important;
    height: 36px;
    padding-block: 1px !important;
  }

  .workspace-tab {
    min-height: 34px !important;
    height: 34px;
  }

  .viewport-arrangement-controls {
    top: max(6px, env(safe-area-inset-top)) !important;
    right: max(6px, env(safe-area-inset-right)) !important;
    bottom: max(6px, env(safe-area-inset-bottom)) !important;
    left: auto !important;
    width: 188px !important;
    max-width: 188px !important;
    max-height: none !important;
    align-content: start;
  }

  .viewport-arrangement-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }

  .viewport-arrangement-controls button,
  .viewport-arrangement-controls summary {
    min-height: 42px !important;
    height: 42px;
  }

  .arrangement-mobile-more > div {
    right: calc(100% + 6px) !important;
    bottom: 0 !important;
    width: min(300px, 46vw) !important;
    max-height: calc(100dvh - 92px) !important;
  }

  .body-reference-2d-controls,
  .body-reference-controls {
    top: 6px !important;
    right: max(6px, env(safe-area-inset-right)) !important;
  }

  .editor-core-numeric-panel,
  .context-bar {
    top: max(6px, env(safe-area-inset-top)) !important;
    right: max(6px, env(safe-area-inset-right)) !important;
    bottom: max(6px, env(safe-area-inset-bottom)) !important;
    left: auto !important;
    width: min(46vw, 390px) !important;
    max-height: none !important;
  }

  .canvas-navigation {
    right: max(6px, env(safe-area-inset-right)) !important;
    bottom: max(6px, env(safe-area-inset-bottom)) !important;
    left: auto !important;
  }

  .pieces-panel {
    width: min(56vw, 480px) !important;
    right: auto !important;
  }
}
''')

# 7) Focused mobile contract tests.
mobile_test = Path("apps/web/src/viewport/GlobalThreeViewport.mobile.test.ts")
mobile_test.write_text(r'''import { describe, expect, it } from "vitest";
import { arrangementGizmoTargetPixels, shouldExtendArrangementSelection } from "./GlobalThreeViewport";

describe("mobile arrangement interaction contract", () => {
  it("uses an explicit touch multi-select mode instead of keyboard modifiers", () => {
    expect(shouldExtendArrangementSelection({
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      pointerType: "touch",
      touchMultiSelect: true,
    })).toBe(true);
    expect(shouldExtendArrangementSelection({
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      pointerType: "touch",
      touchMultiSelect: false,
    })).toBe(false);
    expect(shouldExtendArrangementSelection({
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      pointerType: "mouse",
      touchMultiSelect: false,
    })).toBe(true);
  });

  it("keeps the touch gizmo smaller in portrait and landscape without changing desktop sizing", () => {
    expect(arrangementGizmoTargetPixels(390, 844, true)).toBe(70);
    expect(arrangementGizmoTargetPixels(844, 390, true)).toBe(64);
    expect(arrangementGizmoTargetPixels(1440, 900, false)).toBe(86);
  });
});
''')

css_test = Path("apps/web/src/mobileWorkspaceCss.test.ts")
css_test.write_text(r'''import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const css = readFileSync(resolve(root, "src/mobile-touch-workspace-11-0-7a.css"), "utf8");
const main = readFileSync(resolve(root, "src/main.tsx"), "utf8");
const manifest = readFileSync(resolve(root, "public/manifest.webmanifest"), "utf8");

describe("mobile workspace CSS contract", () => {
  it("loads the reviewed mobile layers last", () => {
    expect(main).toContain('import "./mobile-touch-workspace.css"');
    expect(main).toContain('import "./mobile-touch-workspace-v2.css"');
    expect(main).toContain('import "./mobile-touch-workspace-11-0-7a.css"');
  });

  it("has explicit portrait and landscape layouts plus coarse-pointer touch behavior", () => {
    expect(css).toContain("(pointer: coarse)");
    expect(css).toContain("(orientation: portrait)");
    expect(css).toContain("(orientation: landscape)");
    expect(css).toContain("arrangement-mobile-multiselect");
    expect(css).toContain("env(safe-area-inset-bottom)");
  });

  it("supports standalone installation without forcing one orientation", () => {
    const parsed = JSON.parse(manifest) as { display?: string; orientation?: string };
    expect(parsed.display).toBe("standalone");
    expect(parsed.orientation).toBe("any");
  });
});
''')
