import { describe, expect, it } from "vitest";
import { FallbackPatternEngine } from "../core/fallbackPatternEngine";
import { parseAutosave } from "./opfs";

describe("autosave serialization", () => {
  it("parses a valid versioned autosave", () => {
    const snapshot = new FallbackPatternEngine().snapshot();
    const serialized = JSON.stringify({
      version: 1,
      snapshot,
      savedAt: "2026-07-30T12:00:00.000Z",
    });

    expect(parseAutosave(serialized)).toEqual(snapshot);
  });

  it("ignores malformed or unsupported autosaves", () => {
    expect(parseAutosave("not-json")).toBeNull();
    expect(parseAutosave(JSON.stringify({ version: 2 }))).toBeNull();
  });
});
