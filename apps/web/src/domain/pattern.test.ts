import { describe, expect, it } from "vitest";
import { polygonAreaMm2, polygonPerimeterMm } from "./pattern";

describe("pattern geometry", () => {
  const square = [
    { id: "a", xMm: 0, yMm: 0 },
    { id: "b", xMm: 100, yMm: 0 },
    { id: "c", xMm: 100, yMm: 100 },
    { id: "d", xMm: 0, yMm: 100 },
  ];

  it("calculates polygon area", () => {
    expect(polygonAreaMm2(square)).toBe(10000);
  });

  it("calculates polygon perimeter", () => {
    expect(polygonPerimeterMm(square)).toBe(400);
  });
});
