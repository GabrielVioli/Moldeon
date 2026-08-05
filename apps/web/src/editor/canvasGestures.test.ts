import { describe, expect, it } from "vitest";
import {
  claimGesture,
  createGestureOrigin,
  finishGesture,
  isInteractiveGestureOwner,
  ownsGesture,
  shouldInsertPointFromTap,
  shouldStartBoxSelection,
  shouldStartDrag,
} from "./canvasGestures";

describe("canvas gesture ownership", () => {
  it("classifies mouse click separately from drag", () => {
    const origin = createGestureOrigin(1, "mouse", 100, 100, 0);
    expect(finishGesture(origin, 103, 102, 50).isClick).toBe(true);
    expect(finishGesture(origin, 112, 100, 50).isClick).toBe(false);
    expect(shouldStartBoxSelection(6)).toBe(true);
  });

  it("uses distinct thresholds for piece, point, pan and selection box", () => {
    const mouse = createGestureOrigin(1, "mouse", 0, 0, 0);
    const touch = createGestureOrigin(2, "touch", 0, 0, 0);

    expect(shouldStartDrag(mouse, 2, 0, "piece")).toBe(false);
    expect(shouldStartDrag(mouse, 3, 0, "piece")).toBe(true);
    expect(shouldStartDrag(mouse, 2, 0, "point")).toBe(true);
    expect(shouldStartDrag(mouse, 2, 0, "pan")).toBe(false);
    expect(shouldStartDrag(mouse, 6, 0, "box")).toBe(true);

    expect(shouldStartDrag(touch, 8, 0, "piece")).toBe(false);
    expect(shouldStartDrag(touch, 9, 0, "piece")).toBe(true);
    expect(shouldStartDrag(touch, 6, 0, "point")).toBe(true);
    expect(shouldStartDrag(touch, 7, 0, "pan")).toBe(true);
    expect(shouldStartDrag(touch, 11, 0, "box")).toBe(false);
  });

  it("keeps the first pointer owner until the gesture ends", () => {
    const pieceOwnership = claimGesture(null, 7, "piece");
    expect(ownsGesture(pieceOwnership, 7, "piece")).toBe(true);
    expect(isInteractiveGestureOwner(pieceOwnership?.owner ?? "empty")).toBe(true);
    expect(claimGesture(pieceOwnership, 8, "pan")).toEqual(pieceOwnership);
    expect(ownsGesture(pieceOwnership, 7, "pan")).toBe(false);
    expect(isInteractiveGestureOwner("pan")).toBe(false);
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
