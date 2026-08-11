import { describe, expect, it } from "vitest";
import { findEditablePatternPoint, normalizeRotation, parsePositiveLength, patternSegmentLength, resizeCurvedSegment, resizeStraightSegment, rotationFromPointer } from "./workspaceInteractions";

describe("workspace interactions", () => {
  it.each([[15, 15], [45, 45], [90, 90], [-30, -30], [450, 90], [-450, -90]])("normalizes %s degrees to %s", (input, expected) => expect(normalizeRotation(input)).toBe(expected));

  it("snaps handle rotation to 15 degree steps with Shift", () => {
    expect(rotationFromPointer(0, 0, (22 * Math.PI) / 180, true)).toBe(15);
    expect(rotationFromPointer(0, 0, (22 * Math.PI) / 180, false)).toBeCloseTo(22);
  });

  it("accepts comma decimal and rejects invalid lengths", () => {
    expect(parsePositiveLength("310,5")).toBe(310.5);
    expect(parsePositiveLength("0")).toBeNull();
    expect(parsePositiveLength("-2")).toBeNull();
    expect(parsePositiveLength("")).toBeNull();
  });

  it("resizes only the end point while preserving direction", () => {
    expect(resizeStraightSegment({ xMm: 10, yMm: 20 }, { xMm: 110, yMm: 20 }, 310)).toEqual({ xMm: 320, yMm: 20 });
  });

  it("resizes a curved segment to an exact arc length without changing its shape proportions", () => {
    const start = { id: "a", xMm: 0, yMm: 0, handleOut: { xMm: 30, yMm: -24 } };
    const end = { id: "b", xMm: 100, yMm: 0, handleIn: { xMm: -28, yMm: -20 } };
    const currentLength = patternSegmentLength(start, end);
    const resized = resizeCurvedSegment(start, end, currentLength * 1.5);
    expect(resized).not.toBeNull();
    const resizedStart = { ...start, handleOut: resized!.startHandleOut };
    const resizedEnd = { ...end, ...resized!.end, handleIn: resized!.endHandleIn };
    expect(patternSegmentLength(resizedStart, resizedEnd)).toBeCloseTo(currentLength * 1.5, 5);
    const scale = resized!.end.xMm / end.xMm;
    expect(resized!.startHandleOut?.xMm).toBeCloseTo(start.handleOut.xMm * scale, 5);
    expect(resized!.endHandleIn?.xMm).toBeCloseTo(end.handleIn.xMm * scale, 5);
  });

  it("finds a point on a visible non-active piece using its workspace transform", () => {
    const garment = {
      pieces: [
        { id: "first", name: "First", seamAllowanceMm: 10, points: [{ id: "a", xMm: 0, yMm: 0 }] },
        { id: "second", name: "Second", seamAllowanceMm: 10, points: [{ id: "b", xMm: 20, yMm: 30 }] },
      ],
      workspaceStates: [
        { pieceId: "first", visible: true, locked: false, transform: { pieceId: "first", xMm: 0, yMm: 0, rotationDeg: 0 } },
        { pieceId: "second", visible: true, locked: false, transform: { pieceId: "second", xMm: 200, yMm: 100, rotationDeg: 0 } },
      ],
    } as never;

    expect(findEditablePatternPoint(garment, { xMm: 220, yMm: 130 }, 5)).toMatchObject({ pieceId: "second", point: { id: "b" } });
  });

  it("ignores points on locked pieces", () => {
    const garment = {
      pieces: [{ id: "locked", name: "Locked", seamAllowanceMm: 10, points: [{ id: "a", xMm: 0, yMm: 0 }] }],
      workspaceStates: [{ pieceId: "locked", visible: true, locked: true, transform: { pieceId: "locked", xMm: 0, yMm: 0, rotationDeg: 0 } }],
    } as never;
    expect(findEditablePatternPoint(garment, { xMm: 0, yMm: 0 }, 5)).toBeNull();
  });
});
