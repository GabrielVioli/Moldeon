import { describe, expect, it } from "vitest";
import { connectedSewingInstanceIds } from "./SewingInteraction";

function constraint(
  instanceA: string,
  instanceB: string,
  seamGroupId = "seam:1",
) {
  return { instanceA, instanceB, seamGroupId };
}

describe("sewn component arrangement selection", () => {
  it("keeps an unsewn panel as a one-item component", () => {
    expect(connectedSewingInstanceIds([], "panel-a")).toEqual(["panel-a"]);
  });

  it("selects an entire active sewing component transitively", () => {
    const result = connectedSewingInstanceIds([
      constraint("panel-a", "panel-b"),
      constraint("panel-b", "panel-c", "seam:2"),
      constraint("panel-x", "panel-y", "seam:3"),
    ], "panel-a");

    expect(new Set(result)).toEqual(new Set(["panel-a", "panel-b", "panel-c"]));
  });

  it("does not connect a garment through dart constraints", () => {
    const result = connectedSewingInstanceIds([
      constraint("panel-a", "panel-b"),
      constraint("panel-b", "panel-c", "dart:waist"),
    ], "panel-a");

    expect(new Set(result)).toEqual(new Set(["panel-a", "panel-b"]));
  });

  it("ignores self constraints and missing physical endpoints", () => {
    const result = connectedSewingInstanceIds([
      constraint("panel-a", "panel-a"),
      { instanceA: "panel-a", instanceB: undefined, seamGroupId: "seam:2" },
    ], "panel-a");

    expect(result).toEqual(["panel-a"]);
  });
});
