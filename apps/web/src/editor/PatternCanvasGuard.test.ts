import { describe, expect, it } from "vitest";
import { canvasDocumentGenerationKey } from "./PatternCanvas";

describe("canvas document generation key", () => {
  it("changes when the last document piece is removed", () => {
    expect(canvasDocumentGenerationKey(["front"], "front")).not.toBe(
      canvasDocumentGenerationKey([], ""),
    );
  });

  it("changes when the active document piece changes", () => {
    expect(canvasDocumentGenerationKey(["front", "back"], "front")).not.toBe(
      canvasDocumentGenerationKey(["front", "back"], "back"),
    );
  });

  it("stays stable while only point geometry changes", () => {
    expect(canvasDocumentGenerationKey(["front", "back"], "front")).toBe(
      canvasDocumentGenerationKey(["front", "back"], "front"),
    );
  });
});

describe("canvas live-state redraw regression", () => {
  it("delegates RAF redraw and native wheel through the latest callbacks", async () => {
    const source = await import("./PatternCanvasLegacy?raw").then(
      (module) => module.default,
    );

    expect(source).toContain("drawLatestRef.current = drawLatest");
    expect(source).toContain("drawLatestRef.current()");
    expect(source).toContain("handleWheelRef.current = handleWheel");
    expect(source).toContain("handleWheelRef.current(event)");
    expect(source).toContain("const editor = useEditorStore.getState()");
    expect(source).not.toContain("window.requestAnimationFrame(drawLatest)");
  });

  it("renders document geometry from the live garment instead of the snapshot argument", async () => {
    const source = await import("./PatternCanvasLegacy?raw").then(
      (module) => module.default,
    );

    expect(source).toContain("_snapshot: PatternSnapshot");
    expect(source).toContain("for (const piece of garment.pieces)");
    expect(source).not.toContain("_snapshot.piece");
  });

  it("routes real canvas background clearing through the authoritative action", async () => {
    const source = await import("./PatternCanvasLegacy?raw").then(
      (module) => module.default,
    );

    expect(source).toContain('import { clearEditorSelection } from "./editorCoreSelection"');
    expect(source).toContain("clearEditorSelection();");
    expect(source).not.toContain("installCompleteEditorSelectionClear");
  });

  it("offers incoming and outgoing numeric handles from a selected segment", async () => {
    const source = await import("./PatternCanvas?raw").then(
      (module) => module.default,
    );

    expect(source).toContain("const edgeOutTarget");
    expect(source).toContain("const edgeInTarget");
    expect(source).toContain("Handle saída");
    expect(source).toContain("Handle entrada");
    expect(source).toContain('label="Comprimento"');
    expect(source).toContain('label="Ângulo"');
  });
});
