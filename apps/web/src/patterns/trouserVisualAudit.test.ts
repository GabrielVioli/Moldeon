import { describe, expect, it } from "vitest";
import { createTrouserVisualEvidence } from "./trouserVisualEvidence";

describe("trouser visual evidence", () => {
  it("renders valid 2D and assembly diagrams from the authoritative geometry", () => {
    const evidence = createTrouserVisualEvidence();

    for (const svg of [
      evidence.frontBackSvg,
      evidence.comparisonSvg,
      evidence.graphSvg,
    ]) {
      expect(svg).toContain("<svg");
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(svg.match(/<path/g)?.length ?? 0).toBeGreaterThan(0);
    }

    for (const seamRole of [
      "left-outseam",
      "left-inseam",
      "right-outseam",
      "right-inseam",
      "front-rise",
      "back-rise",
    ]) {
      expect(evidence.graphSvg).toContain(seamRole);
    }

    expect(evidence.report).toMatchObject({
      physicalDevicesValidated: false,
      threeDimensionalPreviewUsedAsEvidence: false,
      templateVersion: "straight-pants@2",
      openConnectorCount: 8,
      diagnostics: [],
    });
  });
});
