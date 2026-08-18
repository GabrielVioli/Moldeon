import { describe, expect, it } from "vitest";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import { buildResolvedAssemblyInputFromDocument } from "./ResolvedAssemblyInput";
import { buildGarmentAssembly } from "./GarmentAssembly";
import { buildResolvedGarmentAssembly } from "./ResolvedGarmentAssembly";
import { buildCoarseAssemblySet } from "./CoarseAssemblyMesh";
import { buildCoarseSeamResolution } from "./CoarseSeamConstraints";

const EXPECTED = [
  "template-seam:trouser-back-rise",
  "template-seam:trouser-front-rise",
  "template-seam:trouser-inseam-1",
  "template-seam:trouser-inseam-2",
  "template-seam:trouser-outseam-1",
  "template-seam:trouser-outseam-2",
  "template-seam:trouser-outseam-3",
].sort();

describe("Prompt 10.7 trouser binding trace", () => {
  it("keeps canonical structural seam groups through every assembly boundary", () => {
    const garment = createBaselineFixture("straight-pants-standard");
    const document = garmentDraftToPatternDocumentV3(garment);
    const input = buildResolvedAssemblyInputFromDocument(document);
    const baseState = buildGarmentAssembly(input.snapshots, input.garmentProjection, input.geometrySignatures);
    const state = buildResolvedGarmentAssembly(input);
    const coarse = buildCoarseAssemblySet(state);
    const seams = buildCoarseSeamResolution(state, coarse);

    const documentGroups = document.seamGroups.map((group) => group.id).sort();
    const projectedGroups = (input.garmentProjection.seams ?? []).map((seam) => seam.groupId ?? seam.id).sort();
    const baseGroups = [...new Set(baseState.stitchConstraints.map((stitch) => stitch.seamGroupId))].sort();
    const resolvedGroups = [...new Set(state.stitchConstraints.map((stitch) => stitch.seamGroupId))].sort();
    const coarseGroups = [...new Set(seams.constraints.map((seam) => seam.seamGroupId))].sort();
    const trace = {
      canonicalPanels: document.panelInstances.map((panel) => `${panel.id}:${panel.sourcePatternId}:${panel.copyIndex}`),
      basePanels: baseState.instances.map((panel) => `${panel.id}:${panel.sourcePatternId}`),
      resolvedPanels: state.instances.map((panel) => `${panel.id}:${panel.sourcePatternId}`),
      documentGroups,
      projectedGroups,
      baseGroups,
      resolvedGroups,
      coarseGroups,
      documentBindings: Object.fromEntries(document.seamGroups.map((group) => [group.id, group.physicalBindings])),
      projectedBindings: Object.fromEntries((input.garmentProjection.seams ?? []).map((seam) => [seam.groupId ?? seam.id, seam.physicalBindings])),
      baseWarnings: baseState.warnings,
      resolvedWarnings: state.warnings,
      coarseWarnings: seams.warnings,
    };
    console.log("MOLDEON_10_7_PANTS_BINDING", JSON.stringify(trace));

    for (const group of EXPECTED) {
      expect(documentGroups, `V3 lost ${group}: ${JSON.stringify(trace)}`).toContain(group);
      expect(projectedGroups, `projection lost ${group}: ${JSON.stringify(trace)}`).toContain(group);
      expect(baseGroups, `base GarmentAssembly lost ${group}: ${JSON.stringify(trace)}`).toContain(group);
      expect(resolvedGroups, `PhysicalGarmentAssembly lost ${group}: ${JSON.stringify(trace)}`).toContain(group);
      expect(coarseGroups, `coarse mapping lost ${group}: ${JSON.stringify(trace)}`).toContain(group);
    }
    expect(state.instances).toHaveLength(4);
  });
});
