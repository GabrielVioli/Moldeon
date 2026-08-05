import { describe, expect, it } from "vitest";
import {
  createGestureOrigin,
  finishGesture,
  shouldInsertPointFromTap,
  shouldStartBoxSelection,
} from "./canvasGestures";

describe("canvas gesture ownership", () => {
  it("classifies mouse click separately from drag", () => {
    const origin = createGestureOrigin(1, "mouse", 100, 100, 0);
    expect(finishGesture(origin, 103, 102, 50).isClick).toBe(true);
    expect(finishGesture(origin, 112, 100, 50).isClick).toBe(false);
    expect(shouldStartBoxSelection(5)).toBe(true);
  });

  it("only inserts from a completed single-pointer touch tap", () => {
    const origin = createGestureOrigin(2, "touch", 40, 50, 0);
    const tap = finishGesture(origin, 44, 54, 180);
    expect(shouldInsertPointFromTap(origin, tap, 1)).toBe(true);
    expect(shouldInsertPointFromTap(origin, tap, 2)).toBe(false);
    expect(
      shouldInsertPointFromTap(origin, finishGesture(origin, 44, 54, 900), 1),
    ).toBe(false);
  });
});
