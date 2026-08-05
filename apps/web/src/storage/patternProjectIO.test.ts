import { describe, expect, it } from "vitest";
import {
  createLegacyProjectFixture,
  createPatternDocumentV3Fixture,
  createPatternProjectV2Fixture,
} from "../testFixtures/patternDocumentFixtures";
import {
  exportPatternProject,
  importPatternProject,
} from "./patternProjectIO";

describe("pattern project import and export", () => {
  it("round trips a native V3 project", () => {
    const source = createPatternDocumentV3Fixture();
    const imported = importPatternProject(exportPatternProject(source));

    expect(imported.migration.sourceVersion).toBe(3);
    expect(imported.migration.warnings).toEqual([]);
    expect(imported.document).toEqual(source);
  });

  it("imports deterministic legacy and V2 project fixtures", () => {
    const legacy = createLegacyProjectFixture();
    const v2 = createPatternProjectV2Fixture();

    const importedLegacy = importPatternProject(
      JSON.stringify(legacy.garment),
    );
    const importedV2 = importPatternProject(JSON.stringify(v2));

    expect(importedLegacy.migration.sourceVersion).toBe("legacy");
    expect(importedLegacy.document.formatVersion).toBe(3);
    expect(importedV2.migration.sourceVersion).toBe(2);
    expect(importedV2.document.workspace.activePatternId).toBe(
      v2.activePieceId,
    );
  });

  it("reports malformed files without coercing data", () => {
    expect(() => importPatternProject("not-json")).toThrow(
      "não contém JSON válido",
    );
  });
});
