from pathlib import Path

path = Path("apps/web/src/styles.css")
text = path.read_text(encoding="utf-8")
marker = "/* Prompt 09 mobile dressed-avatar viewport */"
block = r'''

/* Prompt 09 mobile dressed-avatar viewport */
@media (max-width: 760px) {
  .workspace-view.is-mobile-active#preview-panel {
    display: block;
    min-height: 0;
    height: 100%;
  }

  .workspace-view.is-mobile-active#preview-panel .viewport-host,
  .workspace-view.is-mobile-active#preview-panel .three-canvas {
    min-height: 320px;
    height: 100%;
  }
}
'''
if marker not in text:
    path.write_text(text.rstrip() + block + "\n", encoding="utf-8")
print("Prompt 9 mobile viewport layout applied")
