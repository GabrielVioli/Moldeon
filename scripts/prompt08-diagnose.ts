import { edgeRangeLength, getPatternEdges } from "../apps/web/src/domain/pattern";
import { createDefaultSleeveSettings, draftGuidedSleeve } from "../apps/web/src/domain/sleeveSystem";
import { createGarmentFromTemplate } from "../apps/web/src/patterns/templateCatalog";
import { createParametricBodyFixture } from "../apps/web/src/testFixtures/parametricBodyFixtures";

const fixture = createParametricBodyFixture("medium");
const garment = createGarmentFromTemplate("bodice-block", fixture.supplied, fixture.bodyType, fixture.profile);
const front = garment.pieces.find((piece) => getPatternEdges(piece).some((edge) => edge.role === "frontArmhole"))!;
const back = garment.pieces.find((piece) => getPatternEdges(piece).some((edge) => edge.role === "backArmhole"))!;
const settings = createDefaultSleeveSettings(garment, front.id, back.id, "short");
const draft = draftGuidedSleeve(garment, front.id, back.id, settings);

for (const group of [
  { id: "guided-sleeve:front-armhole", body: front, bodyRole: "frontArmhole", capRole: "sleeveCapFront" },
  { id: "guided-sleeve:back-armhole", body: back, bodyRole: "backArmhole", capRole: "sleeveCapBack" },
] as const) {
  const seams = draft.seams.filter((seam) => seam.groupId === group.id);
  console.log(`\n${group.id}`);
  for (const seam of seams) {
    console.log(JSON.stringify({
      id: seam.id,
      first: seam.first,
      firstLength: edgeRangeLength(group.body, seam.first),
      second: seam.second,
      secondLength: edgeRangeLength(draft.sleevePiece, seam.second),
    }));
  }
  console.log(JSON.stringify({
    bodyEdges: getPatternEdges(group.body).filter((edge) => edge.role === group.bodyRole).map((edge) => ({
      id: edge.id,
      length: edgeRangeLength(group.body, { pieceId: group.body.id, edgeId: edge.id, startT: 0, endT: 1 }),
    })),
    capEdges: getPatternEdges(draft.sleevePiece).filter((edge) => edge.role === group.capRole).map((edge) => ({
      id: edge.id,
      length: edgeRangeLength(draft.sleevePiece, { pieceId: draft.sleevePiece.id, edgeId: edge.id, startT: 0, endT: 1 }),
    })),
  }, null, 2));
}
