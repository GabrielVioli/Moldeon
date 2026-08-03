import { describe, expect, it } from "vitest";
import { normalizeRotation, parsePositiveLength, resizeStraightSegment, rotationFromPointer } from "./workspaceInteractions";

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
});
