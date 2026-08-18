import { describe, expect, it } from "vitest";
import type { PieceWorkspaceTransform } from "../domain/pattern";
import { pieceLocalToWorld } from "./coordinates";
import {
  chooseHighestPriorityHit,
  filterDocumentIds,
  handleVectorFromPolar,
  handleVectorToPolar,
  localBoundsFromPoints,
  rotateWorkspaceTransformAroundPivot,
  rotationHandleHitTest,
  rotationHandleScreenPosition,
  screenToleranceMm,
} from "./editorCoreMath";

describe("editor core interaction math", () => {
  it("keeps hit testing tolerance stable in screen pixels across zoom", () => {
    expect(screenToleranceMm(12, 0.5)).toBe(24);
    expect(screenToleranceMm(12, 1)).toBe(12);
    expect(screenToleranceMm(12, 2)).toBe(6);
  });

  it("uses the required hit testing priority before distance", () => {
    const hit = chooseHighestPriorityHit([
      { kind: "piece" as const, distancePx: 0 },
      { kind: "internal" as const, distancePx: 1 },
      { kind: "segment" as const, distancePx: 2 },
      { kind: "rotation" as const, distancePx: 2 },
      { kind: "marker" as const, distancePx: 3 },
      { kind: "point" as const, distancePx: 4 },
      { kind: "handle" as const, distancePx: 11 },
    ]);
    expect(hit?.kind).toBe("handle");
  });

  it("keeps the rotation control below Bézier handles and points in hit priority", () => {
    expect(
      chooseHighestPriorityHit([
        { kind: "rotation" as const, distancePx: 0 },
        { kind: "point" as const, distancePx: 12 },
      ])?.kind,
    ).toBe("point");
    expect(
      chooseHighestPriorityHit([
        { kind: "rotation" as const, distancePx: 0 },
        { kind: "handle" as const, distancePx: 15 },
      ])?.kind,
    ).toBe("handle");
  });

  it("keeps only ids that still exist in the document", () => {
    expect(filterDocumentIds(["a", "b"], ["ghost", "a", "b", "a"])).toEqual([
      "a",
      "b",
    ]);
  });

  it("round-trips handle coordinates through length and angle", () => {
    const polar = handleVectorToPolar({ xMm: 30, yMm: 40 });
    expect(polar.lengthMm).toBe(50);
    expect(polar.angleDeg).toBeCloseTo(53.130102, 5);
    const vector = handleVectorFromPolar(polar.lengthMm, polar.angleDeg);
    expect(vector.xMm).toBeCloseTo(30, 5);
    expect(vector.yMm).toBeCloseTo(40, 5);
  });

  it("keeps the rotation handle at a constant screen offset across zoom and pan", () => {
    const bounds = { minX: 0, minY: 0, maxX: 120, maxY: 240 };
    const transform: PieceWorkspaceTransform = {
      pieceId: "piece",
      xMm: 38,
      yMm: -22,
      rotationDeg: 31,
    };
    for (const camera of [
      { zoom: 0.35, panX: 220, panY: 90 },
      { zoom: 1, panX: -50, panY: 310 },
      { zoom: 2.4, panX: 640, panY: -170 },
    ]) {
      const handle = rotationHandleScreenPosition(bounds, transform, camera, 24);
      const corner = rotationHandleScreenPosition(bounds, transform, camera, 0);
      expect(Math.hypot(handle.x - corner.x, handle.y - corner.y)).toBeCloseTo(
        Math.hypot(24, 24),
        5,
      );
    }
  });

  it("uses a larger touch target without changing the visual handle", () => {
    const handle = { x: 100, y: 100 };
    expect(rotationHandleHitTest({ x: 115, y: 100 }, handle, "mouse")).toBe(true);
    expect(rotationHandleHitTest({ x: 119, y: 100 }, handle, "mouse")).toBe(false);
    expect(rotationHandleHitTest({ x: 122, y: 100 }, handle, "touch")).toBe(true);
  });

  it("rotates around the local center without moving its world-space pivot", () => {
    const points = [
      { xMm: 20, yMm: 30 },
      { xMm: 180, yMm: 30 },
      { xMm: 180, yMm: 250 },
      { xMm: 20, yMm: 250 },
    ];
    const bounds = localBoundsFromPoints(points);
    const pivot = {
      xMm: (bounds.minX + bounds.maxX) / 2,
      yMm: (bounds.minY + bounds.maxY) / 2,
    };
    const start: PieceWorkspaceTransform = {
      pieceId: "piece",
      xMm: 75,
      yMm: -40,
      rotationDeg: -17,
    };
    const before = pieceLocalToWorld(pivot, start);
    const rotated = rotateWorkspaceTransformAroundPivot(start, pivot, 103);
    const after = pieceLocalToWorld(pivot, rotated);
    expect(after.xMm).toBeCloseTo(before.xMm, 8);
    expect(after.yMm).toBeCloseTo(before.yMm, 8);
    expect(rotated.rotationDeg).toBe(103);
  });

  it("rejects invalid numeric handle and rotation values", () => {
    expect(() => handleVectorFromPolar(-1, 0)).toThrow(
      "comprimento do handle",
    );
    expect(() => screenToleranceMm(12, 0)).toThrow("zoom");
    expect(() =>
      rotateWorkspaceTransformAroundPivot(
        { pieceId: "p", xMm: 0, yMm: 0, rotationDeg: 0 },
        { xMm: 0, yMm: 0 },
        Number.NaN,
      ),
    ).toThrow("rotação");
  });
});
