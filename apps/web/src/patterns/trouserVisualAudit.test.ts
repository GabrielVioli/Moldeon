import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTrouserVisualEvidence } from "./trouserVisualEvidence";

describe("trouser visual evidence", () => {
  it("renders valid 2D and assembly diagrams from the authoritative geometry", () => {
    const evidence = createTrouserVisualEvidence();
    const evidenceDir = process.env.PATTERN_EVIDENCE_DIR;
    if (evidenceDir) {
      const output = resolve(evidenceDir);
      mkdirSync(output, { recursive: true });
      writeFileSync(resolve(output, "pants-front-back.svg"), evidence.frontBackSvg, "utf8");
      writeFileSync(resolve(output, "pants-blind.svg"), evidence.blindFrontBackSvg, "utf8");
      writeFileSync(resolve(output, "pants-body-comparison.svg"), evidence.comparisonSvg, "utf8");
      writeFileSync(resolve(output, "pants-seam-graph.svg"), evidence.graphSvg, "utf8");
      writeFileSync(resolve(output, "pants-report.json"), JSON.stringify(evidence.report, null, 2), "utf8");
    }

    for (const svg of [
      evidence.frontBackSvg,
      evidence.blindFrontBackSvg,
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
      templateVersion: "straight-pants@3",
      openConnectorCount: 8,
      diagnostics: [],
    });
  });
});
