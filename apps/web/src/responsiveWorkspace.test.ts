import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("responsive workspace UI contract", () => {
  it("loads the responsive layer after the historical styles", () => {
    const main = readSource("main.tsx");
    const stylesIndex = main.indexOf('import "./styles.css"');
    const recoveryIndex = main.indexOf('import "./recovery.css"');
    const responsiveIndex = main.indexOf('import "./responsive-workspace.css"');

    expect(stylesIndex).toBeGreaterThanOrEqual(0);
    expect(recoveryIndex).toBeGreaterThan(stylesIndex);
    expect(responsiveIndex).toBeGreaterThan(recoveryIndex);
  });

  it("keeps all six essential tools in the primary toolbar without the sleeve action", () => {
    const toolbar = readSource("components/Toolbar.tsx");
    const toolOrder = ["draft", "select", "cut", "dart", "seam", "measure"];
    let cursor = -1;

    for (const tool of toolOrder) {
      const next = toolbar.indexOf(`tool: "${tool}"`);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }

    expect(toolbar).not.toContain("Adicionar manga");
    expect(toolbar).toContain('className="toolbar-overflow"');
    expect(toolbar).toContain("Corpo e posição");
  });

  it("removes experimental fabric selectors from the normal fitting UI", () => {
    const fitting = readSource("components/FittingRoomDialog.tsx");

    expect(fitting).not.toContain("FABRIC_PRESETS");
    expect(fitting).not.toContain("fabric-preset-grid");
    expect(fitting).not.toContain(">Tecidos<");
    expect(fitting).toContain('useState<FittingSection>("body")');
  });

  it("keeps physics diagnostics development-only and collapsed by default", () => {
    const viewport = readSource("viewport/GarmentViewport.tsx");

    expect(viewport).toContain("{import.meta.env.DEV ? (");
    expect(viewport).toContain('<details className="viewport-physics-dev"');
    expect(viewport).toContain('<summary>Física DEV</summary>');
    expect(viewport).not.toContain('<aside className="viewport-physics-dev"');
  });

  it("declares behavioral workspace and short-height breakpoints without horizontal tool scrolling", () => {
    const css = readSource("responsive-workspace.css");

    expect(css).toContain("@media (min-width: 1181px)");
    expect(css).toContain("@media (max-width: 1180px)");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain("@media (max-height: 760px)");
    expect(css).toContain("@media (max-height: 640px) and (min-width: 761px)");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) var(--ui-panel-width)");
    expect(css).toContain("max-height: calc(100dvh - 16px)");
    expect(css).toContain(".tool-buttons");
    expect(css).toContain("overflow: hidden");
  });
});
