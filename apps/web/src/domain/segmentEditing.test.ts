import { describe, expect, it } from "vitest";
import { migrateLegacyPieceToSegments, parsePatternPiece, type PatternPiece } from "./pattern";
import { convertPatternSegment, movePatternNode, movePatternSegment, splitPatternSegment } from "./segmentEditing";

const legacy: PatternPiece = {
  id: "piece",
  name: "Base",
  seamAllowanceMm: 10,
  points: [
    { id: "a", xMm: 0, yMm: 0 },
    { id: "b", xMm: 100, yMm: 0 },
    { id: "c", xMm: 100, yMm: 100 },
    { id: "d", xMm: 0, yMm: 100 },
  ],
};

describe("persistent segment editing", () => {
  it("migrates legacy contours with stable node and segment ids", () => {
    const first = migrateLegacyPieceToSegments(legacy);
    const second = parsePatternPiece(first);
    expect(first.formatVersion).toBe(2);
    expect(second.nodes?.map((node) => node.id)).toEqual(["a", "b", "c", "d"]);
    expect(second.segments?.map((segment) => segment.id)).toEqual(first.segments?.map((segment) => segment.id));
    expect(second.contours?.[0].closed).toBe(true);
  });

  it("moves a shared node without disconnecting adjacent segments", () => {
    const model = migrateLegacyPieceToSegments(legacy);
    const moved = movePatternNode(model, "b", { xMm: 120, yMm: 15 });
    const adjacent = moved.segments?.filter((segment) => segment.startNodeId === "b" || segment.endNodeId === "b");
    expect(adjacent).toHaveLength(2);
    expect(moved.nodes?.find((node) => node.id === "b")).toMatchObject({ xMm: 120, yMm: 15 });
    expect(moved.points.find((point) => point.id === "b")).toMatchObject({ xMm: 120, yMm: 15 });
  });

  it("moves, converts and splits the selected segment persistently", () => {
    const model = migrateLegacyPieceToSegments(legacy);
    const id = model.segments![0].id;
    const moved = movePatternSegment(model, id, 0, 20);
    expect(moved.nodes?.find((node) => node.id === "a")?.yMm).toBe(20);
    expect(moved.nodes?.find((node) => node.id === "b")?.yMm).toBe(20);
    const curved = convertPatternSegment(moved, id, "cubic");
    expect(curved.segments?.find((segment) => segment.id === id)).toMatchObject({ kind: "cubic" });
    const split = splitPatternSegment(curved, id);
    expect(split.segments).toHaveLength(5);
    expect(split.nodes).toHaveLength(5);
    expect(split.contours?.[0].segmentIds).toHaveLength(5);
    expect(split.points).toHaveLength(5);
  });
});
