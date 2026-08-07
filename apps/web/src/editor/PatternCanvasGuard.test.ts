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
