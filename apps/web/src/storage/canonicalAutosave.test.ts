import { describe, expect, it } from "vitest";
import { createPatternDocumentV3Fixture } from "../testFixtures/patternDocumentFixtures";
import {
  parseCanonicalAutosave,
  serializeCanonicalAutosave,
} from "./canonicalAutosave";

describe("canonical autosave", () => {
  it("round trips PatternDocumentV3 without a GarmentDraft projection", () => {
    const source = createPatternDocumentV3Fixture();
    const serialized = serializeCanonicalAutosave(source, {
      revision: 7,
      savedAt: "2026-08-11T15:30:00.000Z",
    });

    const restored = parseCanonicalAutosave(serialized);

    expect(restored.version).toBe(3);
    expect(restored.revision).toBe(7);
    expect(restored.savedAt).toBe("2026-08-11T15:30:00.000Z");
    expect(restored.document).toEqual(source);
    expect(restored.checksum).toMatch(/^fnv1a32:/);
  });

  it("detects a modified document when the stored checksum no longer matches", () => {
    const source = createPatternDocumentV3Fixture();
    const serialized = serializeCanonicalAutosave(source, {
      revision: 2,
      savedAt: "2026-08-11T15:31:00.000Z",
    });
    const tampered = JSON.parse(serialized) as {
      document: { metadata: { name: string } };
    };
    tampered.document.metadata.name = "Projeto adulterado";

    expect(() => parseCanonicalAutosave(JSON.stringify(tampered))).toThrow(
      "verificação de integridade",
    );
  });

  it("accepts the existing V3 envelope that predates revision and checksum", () => {
    const source = createPatternDocumentV3Fixture();
    const serialized = JSON.stringify({
      version: 3,
      document: source,
      ...(source.workspace.activePatternId
        ? { activePatternId: source.workspace.activePatternId }
        : {}),
      savedAt: "2026-08-11T15:32:00.000Z",
    });

    const restored = parseCanonicalAutosave(serialized);

    expect(restored.document).toEqual(source);
    expect(restored.revision).toBe(0);
    expect(restored.checksum).toMatch(/^fnv1a32:/);
  });

  it("rejects invalid dates and revisions", () => {
    const source = createPatternDocumentV3Fixture();

    expect(() =>
      serializeCanonicalAutosave(source, {
        revision: -1,
        savedAt: "2026-08-11T15:33:00.000Z",
      }),
    ).toThrow("inteiro não negativo");

    expect(() =>
      serializeCanonicalAutosave(source, {
        revision: 1,
        savedAt: "not-a-date",
      }),
    ).toThrow("data do autosave é inválida");
  });
});
