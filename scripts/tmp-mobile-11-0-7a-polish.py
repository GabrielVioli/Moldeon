from pathlib import Path

css_path = Path('apps/web/src/mobile-touch-workspace-11-0-7a.css')
css = css_path.read_text()
patch = r'''

/* Visual-smoke follow-up: compact navigation and true >760px phone landscape. */
:root {
  --mobile-11a-surface: rgba(250, 249, 246, 0.97);
  --mobile-11a-border: rgba(71, 67, 60, 0.22);
  --mobile-11a-shadow: 0 8px 24px rgba(31, 28, 23, 0.14);
}

@media (max-width: 760px) {
  /* Empty projects should not reserve a full-width empty piece rail. */
  .pieces-panel:has(.pieces-list:empty) {
    right: auto !important;
    width: 52px !important;
    max-width: 52px !important;
  }

  .pieces-panel:has(.pieces-list:empty) .pieces-list {
    display: none !important;
  }

  /* Disabled point actions are dead chrome on touch. */
  .point-actions button:disabled {
    display: none !important;
  }

  /* Navigation stays finger-sized but labels stop occupying the canvas width. */
  .canvas-navigation button:nth-of-type(4),
  .canvas-navigation button:nth-of-type(5),
  .canvas-navigation button:nth-of-type(6) {
    width: 42px !important;
    min-width: 42px !important;
    padding: 0 !important;
    font-size: 0 !important;
  }

  .canvas-navigation button:nth-of-type(4)::after {
    content: "⛶";
    font-size: 17px;
  }

  .canvas-navigation button:nth-of-type(5)::after {
    content: "◎";
    font-size: 17px;
  }

  .canvas-navigation button:nth-of-type(6)::after {
    content: "✋";
    font-size: 16px;
  }
}

@media (max-width: 900px) and (max-height: 520px) and (orientation: landscape) {
  html,
  body,
  #root,
  .app-shell {
    width: 100%;
    height: 100dvh;
    overscroll-behavior: none;
  }

  body {
    overflow: hidden;
  }

  .app-shell {
    grid-template-rows: 44px minmax(0, 1fr) 0 !important;
  }

  .status-bar,
  .toolbar-preview-button,
  .panel-titlebar {
    display: none !important;
  }

  .editor-panel {
    grid-template-rows: minmax(0, 1fr) !important;
    overflow: hidden !important;
  }

  .editor-body {
    position: relative !important;
    display: block !important;
    min-width: 0 !important;
    min-height: 0 !important;
    overflow: hidden !important;
  }

  .canvas-stack {
    position: absolute !important;
    inset: 0 !important;
    width: auto !important;
    height: auto !important;
    min-width: 0 !important;
    min-height: 0 !important;
    overflow: hidden !important;
  }

  .pattern-canvas,
  .editor-core-canvas-shell {
    width: 100% !important;
    height: 100% !important;
  }

  /* Piece chrome floats over the canvas, exactly as it does in portrait. */
  .pieces-panel {
    position: absolute !important;
    z-index: 31 !important;
    top: 6px !important;
    left: max(6px, env(safe-area-inset-left)) !important;
    right: auto !important;
    display: flex !important;
    align-items: center !important;
    width: min(56vw, 480px) !important;
    min-height: 46px !important;
    height: 46px !important;
    max-height: 46px !important;
    border: 1px solid var(--mobile-11a-border) !important;
    border-radius: 13px !important;
    background: var(--mobile-11a-surface) !important;
    box-shadow: var(--mobile-11a-shadow) !important;
    overflow: hidden !important;
  }

  .pieces-panel:has(.pieces-list:empty) {
    width: 50px !important;
    max-width: 50px !important;
  }

  .pieces-panel:has(.pieces-list:empty) .pieces-list {
    display: none !important;
  }

  .pieces-panel header {
    position: static !important;
    display: flex !important;
    flex: 0 0 46px !important;
    align-items: center !important;
    width: 46px !important;
    min-width: 46px !important;
    height: 46px !important;
    min-height: 46px !important;
    padding: 2px !important;
    border: 0 !important;
  }

  .pieces-panel header strong {
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    margin: -1px !important;
    overflow: hidden !important;
    clip: rect(0 0 0 0) !important;
    white-space: nowrap !important;
  }

  .pieces-panel header button {
    width: 42px !important;
    min-width: 42px !important;
    height: 42px !important;
    min-height: 42px !important;
    padding: 0 !important;
    border-radius: 10px !important;
  }

  .pieces-list {
    display: flex !important;
    flex: 1 1 auto !important;
    align-items: center !important;
    gap: 4px !important;
    width: auto !important;
    min-width: 0 !important;
    height: 46px !important;
    min-height: 46px !important;
    padding: 3px 4px 3px 1px !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    scrollbar-width: none;
  }

  .pieces-list::-webkit-scrollbar {
    display: none;
  }

  .pieces-item {
    flex: 0 0 min(150px, 26vw) !important;
    min-width: 118px !important;
    height: 40px !important;
    min-height: 40px !important;
    border-radius: 10px !important;
  }

  .point-actions {
    position: absolute !important;
    z-index: 32 !important;
    top: 58px !important;
    left: max(6px, env(safe-area-inset-left)) !important;
    display: flex !important;
    gap: 4px !important;
    width: auto !important;
    padding: 0 !important;
    border: 0 !important;
    background: transparent !important;
  }

  .point-actions button {
    width: 42px !important;
    min-width: 42px !important;
    height: 42px !important;
    min-height: 42px !important;
    padding: 0 !important;
    border-radius: 10px !important;
    font-size: 0 !important;
    background: var(--mobile-11a-surface) !important;
    box-shadow: var(--mobile-11a-shadow) !important;
  }

  .point-actions button:disabled {
    display: none !important;
  }

  .point-actions button:first-child::after {
    content: "+";
    font-size: 21px;
  }

  .point-actions button:last-child::after {
    content: "−";
    font-size: 21px;
  }

  /* Keep the bottom navigation compact in landscape too. */
  .canvas-navigation {
    z-index: 40 !important;
    right: max(6px, env(safe-area-inset-right)) !important;
    bottom: max(6px, env(safe-area-inset-bottom)) !important;
    left: auto !important;
    width: auto !important;
    min-height: 42px !important;
    height: 42px !important;
    padding: 1px 3px !important;
    gap: 1px !important;
    border-radius: 11px !important;
    transform: none !important;
    box-shadow: var(--mobile-11a-shadow) !important;
  }

  .canvas-navigation button {
    min-width: 38px !important;
    min-height: 38px !important;
    height: 38px !important;
    padding: 0 5px !important;
    font-size: 10px !important;
  }

  .canvas-navigation button:nth-of-type(4),
  .canvas-navigation button:nth-of-type(5),
  .canvas-navigation button:nth-of-type(6) {
    width: 40px !important;
    min-width: 40px !important;
    padding: 0 !important;
    font-size: 0 !important;
  }

  .canvas-navigation button:nth-of-type(4)::after {
    content: "⛶";
    font-size: 16px;
  }

  .canvas-navigation button:nth-of-type(5)::after {
    content: "◎";
    font-size: 16px;
  }

  .canvas-navigation button:nth-of-type(6)::after {
    content: "✋";
    font-size: 15px;
  }

  /* Empty-state text remains centered in the actual canvas, not the chrome. */
  .empty-workspace {
    inset: 50% auto auto 50% !important;
    width: min(430px, calc(100% - 120px)) !important;
    transform: translate(-50%, -50%) !important;
  }

  .workspace.mode-assembly .viewport-label,
  .workspace.mode-modeling .viewport-label {
    display: none !important;
  }
}
'''

if 'Visual-smoke follow-up: compact navigation' not in css:
    css_path.write_text(css + patch)

# Strengthen the static contract so later edits cannot regress landscape into desktop chrome.
test_path = Path('apps/web/src/mobileWorkspaceCss.test.ts')
test = test_path.read_text()
needle = '''    expect(css).toContain("env(safe-area-inset-bottom)");\n  });'''
replacement = '''    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain(".status-bar,");
    expect(css).toContain(".panel-titlebar");
    expect(css).toContain(".pieces-panel:has(.pieces-list:empty)");
    expect(css).toContain("button:nth-of-type(4)::after");
  });'''
if needle not in test:
    raise SystemExit('missing mobile CSS test anchor')
test_path.write_text(test.replace(needle, replacement, 1))
