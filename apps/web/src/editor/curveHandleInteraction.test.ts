import { describe, expect, it } from "vitest";
import {
  curveHandleGrabOffset,
  curveHandleHitRadiusPx,
  findNearestInternalCurveHandle,
  findNearestPatternCurveHandle,
  internalCurveHandleTargets,
  patternCurveHandleTargets,
} from "./curveHandleInteraction";
import { getPatternEdges, type InternalPath, type PatternPiece } from "../domain/pattern";

function curvedPiece(): PatternPiece {
  const piece: PatternPiece = {
    id: "curve-piece",
    name: "Curve fixture",
    seamAllowanceMm: 0,
    points: [
      { id: "a", xMm: 0, yMm: 0, handleOut: { xMm: 30, yMm: -20 } },
      { id: "b", xMm: 100, yMm: 0, handleIn: { xMm: -28, yMm: -18 }, handleOut: { xMm: 0, yMm: 25 } },
      { id: "c", xMm: 100, yMm: 80, handleIn: { xMm: 0, yMm: -20 } },
      { id: "d", xMm: 0, yMm: 80 },
    ],
  };
  return piece;
}

function cubicInternalPath(): InternalPath {
  return {
    id: "path",
    pieceId: "curve-piece",
    name: "Cubic path",
    purpose: "reference",
    visible: true,
    locked: false,
    metadata: {},
    nodes: [
      { id: "n1", xMm: 15, yMm: 30, handleOut: { xMm: 20, yMm: -12 } },
      { id: "n2", xMm: 75, yMm: 42, handleIn: { xMm: -18, yMm: 16 } },
    ],
    segments: [{ id: "s1", startNodeId: "n1", endNodeId: "n2", kind: "cubic" }],
  };
}

describe("curveHandleInteraction", () => {
  it("exposes both authoritative handles when a curved boundary segment is selected", () => {
    const piece = curvedPiece();
    const edge = getPatternEdges(piece)[0];
    expect(patternCurveHandleTargets(piece, null, edge.id).map(({ pointId, handle }) => [pointId, handle]))
      .toEqual([["a", "out"], ["b", "in"]]);
  });

  it("keeps point-selected handle behavior and chooses the nearest handle when hit areas overlap", () => {
    const piece = curvedPiece();
    expect(patternCurveHandleTargets(piece, "b", null).map(({ pointId, handle }) => [pointId, handle]))
      .toEqual([["b", "in"], ["b", "out"]]);
    const hit = findNearestPatternCurveHandle(piece, "b", null, { xMm: 72, yMm: -18 }, 40);
    expect(hit).toMatchObject({ pointId: "b", handle: "in" });
  });

  it("uses a larger touch hit radius without changing geometry", () => {
    expect(curveHandleHitRadiusPx("touch")).toBeGreaterThan(curveHandleHitRadiusPx("mouse"));
    expect(curveHandleHitRadiusPx("mouse")).toBe(13);
  });

  it("preserves the initial grab offset so a drag does not jump", () => {
    const point = curvedPiece().points[0];
    expect(curveHandleGrabOffset(point, "out", { xMm: 26, yMm: -17 }))
      .toEqual({ xMm: 4, yMm: -3 });
  });

  it("exposes input/output handles for a selected cubic internal segment", () => {
    const path = cubicInternalPath();
    expect(internalCurveHandleTargets(path, null, "s1").map(({ nodeId, handle }) => [nodeId, handle]))
      .toEqual([["n1", "out"], ["n2", "in"]]);
  });

  it("keeps cubic internal handles directly hittable from segment selection", () => {
    const path = cubicInternalPath();
    expect(findNearestInternalCurveHandle(path, null, "s1", { xMm: 35, yMm: 18 }, 1))
      .toMatchObject({ nodeId: "n1", handle: "out" });
    expect(findNearestInternalCurveHandle(path, null, "s1", { xMm: 57, yMm: 58 }, 1))
      .toMatchObject({ nodeId: "n2", handle: "in" });
  });

  it("does not expose handles for a straight internal segment", () => {
    const path = cubicInternalPath();
    path.segments[0] = { ...path.segments[0], kind: "line" };
    expect(internalCurveHandleTargets(path, null, "s1")).toEqual([]);
  });
});
