import { describe, expect, it } from "vitest";
import { shouldReverseVisualSewingSide } from "./SewingViewportOverlay";

describe("11.0.8 CLO-like sewing relationship display", () => {
  it("keeps already parallel visual rungs in their current order", () => {
    expect(shouldReverseVisualSewingSide(
      [[0, 0, 0], [0, 1, 0], [0, 2, 0]],
      [[1, 0, 0], [1, 1, 0], [1, 2, 0]],
    )).toBe(false);
  });

  it("reverses only the display side when direct pairing would form a giant X", () => {
    expect(shouldReverseVisualSewingSide(
      [[0, 0, 0], [0, 1, 0], [0, 2, 0]],
      [[1, 2, 0], [1, 1, 0], [1, 0, 0]],
    )).toBe(true);
  });

  it("does not guess when point counts differ", () => {
    expect(shouldReverseVisualSewingSide(
      [[0, 0, 0], [0, 1, 0]],
      [[1, 1, 0]],
    )).toBe(false);
  });
});
