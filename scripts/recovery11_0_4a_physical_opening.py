from pathlib import Path


def patch_file(path_name: str, replacements: list[tuple[str, str, str]]) -> None:
    path = Path(path_name)
    text = path.read_text(encoding="utf-8")
    for old, new, label in replacements:
        count = text.count(old)
        if count != 1:
            raise RuntimeError(f"{path_name}: {label}: expected one match, found {count}")
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")
    print(f"patched {path}")


garment = "apps/web/src/garment3d/GarmentAssembly.ts"
planner_start = "function buildStructuredAttachmentPlans(\n"
planner_end = "function findStructuredSelfSeamPieces(\n"
text = Path(garment).read_text(encoding="utf-8")
start = text.index(planner_start)
end = text.index(planner_end)
new_planner = r'''function buildStructuredAttachmentPlans(
  snapshots: readonly PatternSnapshot[],
  garment: GarmentDraft,
  structuredSelfSeamPieces: ReadonlySet<string>,
): Map<string, AssemblyStructuredAttachmentPlan> {
  const pieces = snapshots.map((snapshot) => snapshot.piece);
  const plans = new Map<string, AssemblyStructuredAttachmentPlan>();
  for (const seam of garment.seams ?? []) {
    if (seam.active === false) continue;
    const firstRanges = orderCompositeEdgeRangesByContinuity(pieces, seamSideRanges(seam, "first"));
    const secondRanges = orderCompositeEdgeRangesByContinuity(pieces, seamSideRanges(seam, "second"));
    const targetRatio = Number.isFinite(seam.targetRatio) && (seam.targetRatio ?? 0) > 0
      ? seam.targetRatio! : Math.max(0.000001, 1 + seam.easeRatio);
    const slackMm = Number.isFinite(seam.slackMm) && (seam.slackMm ?? 0) >= 0 ? seam.slackMm! : 0;
    if (Math.abs(targetRatio - 1) > 1e-6 || slackMm > 1e-6) continue;

    for (const side of ["first", "second"] as const) {
      const localRanges = side === "first" ? firstRanges : secondRanges;
      const oppositeRanges = side === "first" ? secondRanges : firstRanges;
      if (localRanges.length !== 1) continue;
      const localRange = localRanges[0];
      if (!structuredSelfSeamPieces.has(localRange.pieceId)) continue;
      if (oppositeRanges.every((range) => range.pieceId === localRange.pieceId)) continue;
      const localPiece = pieces.find((piece) => piece.id === localRange.pieceId);
      if (!localPiece || !isNarrowStructuredAttachment(localPiece, localRange)) continue;

      const localLength = physicalRangeSequenceLengthMm(pieces, localRanges);
      const oppositeLength = physicalRangeSequenceLengthMm(pieces, oppositeRanges);
      if (localLength <= DISTANCE_EPSILON || oppositeLength <= DISTANCE_EPSILON) continue;
      if (Math.abs(localLength - oppositeLength) > 0.5) continue;
      const oppositeMultiplicity = consistentFoldMultiplicity(pieces, oppositeRanges);
      if (oppositeMultiplicity === null) continue;
      const sampleCount = Math.min(MAX_SEAM_SAMPLES, Math.max(2,
        Math.ceil(Math.max(localLength, oppositeLength) / SEAM_SAMPLE_SPACING_MM) + 1));
      const edgeId = localRange.edgeId;
      const anchors: number[] = [];
      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const progress = sampleCount === 1 ? 0 : sampleIndex / (sampleCount - 1);
        const localProgress = side === "first"
          ? progress
          : seam.direction === "opposite" ? 1 - progress : progress;
        for (let copyIndex = 0; copyIndex < oppositeMultiplicity; copyIndex += 1) {
          const sectorProgress = copyIndex % 2 === 0 ? localProgress : 1 - localProgress;
          const physicalProgress = (copyIndex + sectorProgress) / oppositeMultiplicity;
          anchors.push(
            localRange.startT + (localRange.endT - localRange.startT) * physicalProgress,
          );
        }
      }
      anchors.sort((a, b) => a - b);
      const stops = [...anchors];
      for (let index = 0; index + 1 < anchors.length; index += 1) {
        stops.push((anchors[index] + anchors[index + 1]) * 0.5);
      }
      const normalized = [...new Set(stops.map((value) => Math.round(value * 1e9) / 1e9))]
        .sort((a, b) => a - b);
      const existing = plans.get(localRange.pieceId);
      if (existing && existing.edgeId !== edgeId) {
        plans.delete(localRange.pieceId);
        continue;
      }
      plans.set(localRange.pieceId, {
        seamGroupId: seam.groupId ?? seam.id,
        edgeId,
        stopsT: existing
          ? [...new Set([...existing.stopsT, ...normalized])].sort((a, b) => a - b)
          : normalized,
      });
    }
  }
  return plans;
}

/**
 * A structured attachment is a genuinely narrow material strip, not merely
 * any self-closed panel. The dimensionless area/edge² ratio keeps a parent
 * tube or a sewn flap out of the attachment remesher without using garment
 * names or absolute offsets.
 */
function isNarrowStructuredAttachment(piece: PatternPiece, range: EdgeRange): boolean {
  if (piece.cutOnFold || piece.points.length !== 4) return false;
  const edges = getPatternEdges(piece);
  if (edges.length !== 4 || piece.segments?.some((segment) => segment.kind !== "line")) return false;
  const attachmentLengthMm = edgeRangeSequenceLength([piece], [range]);
  if (attachmentLengthMm <= DISTANCE_EPSILON) return false;
  let twiceAreaMm2 = 0;
  for (let index = 0; index < piece.points.length; index += 1) {
    const current = piece.points[index];
    const next = piece.points[(index + 1) % piece.points.length];
    twiceAreaMm2 += current.xMm * next.yMm - next.xMm * current.yMm;
  }
  const areaMm2 = Math.abs(twiceAreaMm2) * 0.5;
  if (areaMm2 <= DISTANCE_EPSILON) return false;
  return areaMm2 / (attachmentLengthMm * attachmentLengthMm) <= 0.25;
}

function physicalRangeSequenceLengthMm(
  pieces: readonly PatternPiece[],
  ranges: readonly EdgeRange[],
): number {
  return ranges.reduce((total, range) => {
    const piece = pieces.find((candidate) => candidate.id === range.pieceId);
    const materialLength = edgeRangeSequenceLength(pieces, [range]);
    return total + materialLength * (piece?.cutOnFold ? 2 : 1);
  }, 0);
}

function consistentFoldMultiplicity(
  pieces: readonly PatternPiece[],
  ranges: readonly EdgeRange[],
): number | null {
  const values = new Set(ranges.map((range) =>
    pieces.find((piece) => piece.id === range.pieceId)?.cutOnFold ? 2 : 1));
  return values.size === 1 ? [...values][0] : null;
}

'''
text = text[:start] + new_planner + text[end:]
Path(garment).write_text(text, encoding="utf-8")

patch_file(garment, [
    (
        '  edgeRangeSequenceLength,\n  resolveEdgeRangeSequenceProgress,',
        '  edgeRangeSequenceLength,\n  getPatternEdges,\n  resolveEdgeRangeSequenceProgress,',
        'import getPatternEdges',
    ),
    (
        '  const stitchConstraints = buildGlobalStitchConstraints(\n    instances,\n    garment.seams ?? [],\n    warnings,\n  );',
        '  const stitchConstraints = buildGlobalStitchConstraints(\n    instances,\n    garment.seams ?? [],\n    warnings,\n    structuredAttachmentPlans,\n  );',
        'pass attachment plans to stitches',
    ),
    (
        'function buildGlobalStitchConstraints(\n  instances: readonly AssemblyPanelInstance[],\n  seams: readonly Seam[],\n  warnings: string[],\n): AssemblyStitchConstraint[] {',
        'function buildGlobalStitchConstraints(\n  instances: readonly AssemblyPanelInstance[],\n  seams: readonly Seam[],\n  warnings: string[],\n  structuredAttachmentPlans: ReadonlyMap<string, AssemblyStructuredAttachmentPlan>,\n): AssemblyStitchConstraint[] {',
        'stitch signature',
    ),
    (
        '    const firstLength = edgeRangeSequenceLength(pieces, firstRanges);\n    const secondLength = edgeRangeSequenceLength(pieces, secondRanges);',
        '    const seamGroupId = seam.groupId ?? seam.id;\n    const usesStructuredAttachment = [...structuredAttachmentPlans.values()]\n      .some((plan) => plan.seamGroupId === seamGroupId);\n    const firstLength = usesStructuredAttachment\n      ? physicalRangeSequenceLengthMm(pieces, firstRanges)\n      : edgeRangeSequenceLength(pieces, firstRanges);\n    const secondLength = usesStructuredAttachment\n      ? physicalRangeSequenceLengthMm(pieces, secondRanges)\n      : edgeRangeSequenceLength(pieces, secondRanges);',
        'physical seam lengths',
    ),
    (
        '          seamGroupId: seam.groupId ?? seam.id,',
        '          seamGroupId,',
        'reuse seam group id',
    ),
])

physical = "apps/web/src/garment3d/PhysicalGarmentAssembly.ts"
patch_file(physical, [
    (
'''    for (const [planA, planB] of pairPlans(sourceA, sourceB, plansA, plansB)) {
      result.push({
        ...constraint,
        id: `${constraint.id}/${planA.instance.id}/${planB.instance.id}`,
        a: remapReference(constraint.a, sourceA, planA),
        b: remapReference(constraint.b, sourceB, planB),
        instanceA: planA.instance.id,
        instanceB: planB.instance.id,
      });
    }''',
'''    const attachmentOnA = sourceA.structuredAttachmentPlan?.seamGroupId === constraint.seamGroupId;
    const attachmentOnB = sourceB.structuredAttachmentPlan?.seamGroupId === constraint.seamGroupId;
    const foldExpansionOnA = attachmentOnB
      && plansB.length === 1
      && plansA.length === 2
      && plansA.every((plan) => Boolean(plan.foldGroupId));
    const foldExpansionOnB = attachmentOnA
      && plansA.length === 1
      && plansB.length === 2
      && plansB.every((plan) => Boolean(plan.foldGroupId));

    if (foldExpansionOnA || foldExpansionOnB) {
      const attachmentSource = foldExpansionOnA ? sourceB : sourceA;
      const attachmentPlan = (foldExpansionOnA ? plansB : plansA)[0];
      const parentSource = foldExpansionOnA ? sourceA : sourceB;
      const parentPlans = foldExpansionOnA ? plansA : plansB;
      const attachmentIsA = foldExpansionOnB;
      for (const parentPlan of parentPlans) {
        const attachmentReference = remapStructuredAttachmentReference(
          constraint,
          attachmentSource,
          attachmentPlan,
          parentSource,
          parentPlan,
          attachmentIsA,
        );
        if (!attachmentReference) continue;
        const planA = foldExpansionOnA ? parentPlan : attachmentPlan;
        const planB = foldExpansionOnA ? attachmentPlan : parentPlan;
        result.push({
          ...constraint,
          id: `${constraint.id}/${planA.instance.id}/${planB.instance.id}`,
          a: attachmentIsA
            ? attachmentReference
            : remapReference(constraint.a, sourceA, planA),
          b: attachmentIsA
            ? remapReference(constraint.b, sourceB, planB)
            : attachmentReference,
          instanceA: planA.instance.id,
          instanceB: planB.instance.id,
          ...(attachmentIsA && constraint.rangeLengthAMm !== undefined
            ? { rangeLengthAMm: constraint.rangeLengthAMm / parentPlans.length }
            : {}),
          ...(!attachmentIsA && constraint.rangeLengthBMm !== undefined
            ? { rangeLengthBMm: constraint.rangeLengthBMm / parentPlans.length }
            : {}),
        });
      }
      continue;
    }

    for (const [planA, planB] of pairPlans(sourceA, sourceB, plansA, plansB)) {
      result.push({
        ...constraint,
        id: `${constraint.id}/${planA.instance.id}/${planB.instance.id}`,
        a: remapReference(constraint.a, sourceA, planA),
        b: remapReference(constraint.b, sourceB, planB),
        instanceA: planA.instance.id,
        instanceB: planB.instance.id,
      });
    }''',
        'partition band correspondence over cut-on-fold copies',
    ),
    (
        'function buildFoldConstraints(\n',
'''function remapStructuredAttachmentReference(
  constraint: AssemblyStitchConstraint,
  attachmentSource: AssemblyPanelInstance,
  attachmentPlan: InstancePlan,
  parentSource: AssemblyPanelInstance,
  parentPlan: InstancePlan,
  attachmentIsA: boolean,
): GlobalPointReference | null {
  const range = attachmentIsA ? constraint.rangeA : constraint.rangeB;
  const structured = attachmentSource.structuredAttachmentPlan;
  if (!range || !structured || range.edgeId !== structured.edgeId) return null;
  const path = attachmentPlan.instance.topology.edges.get(range.edgeId);
  if (!path) return null;
  const progress = Math.min(1, Math.max(0, constraint.progress ?? 0));
  const localProgress = attachmentIsA
    ? progress
    : constraint.direction === "opposite" ? 1 - progress : progress;
  const mirroredFold = parentPlan.instance.materialParity !== parentSource.materialParity;
  const sectorProgress = mirroredFold ? 1 - localProgress : localProgress;
  const physicalProgress = ((mirroredFold ? 1 : 0) + sectorProgress) * 0.5;
  const t = range.startT + (range.endT - range.startT) * physicalProgress;
  return pointReferenceOnPath(attachmentPlan.instance, path, t);
}

function pointReferenceOnPath(
  instance: AssemblyPanelInstance,
  path: PanelEdgePath,
  t: number,
): GlobalPointReference {
  const clamped = Math.min(1, Math.max(0, t));
  const targetDistance = path.lengthMm * clamped;
  const lastIndex = path.vertexIndices.length - 1;
  if (lastIndex <= 0 || targetDistance <= POSITION_EPSILON) {
    return directReference(instance.particleStart + path.vertexIndices[0]);
  }
  if (path.lengthMm - targetDistance <= POSITION_EPSILON) {
    return directReference(instance.particleStart + path.vertexIndices[lastIndex]);
  }
  let upper = 1;
  while (upper < path.cumulativeLengthsMm.length && path.cumulativeLengthsMm[upper] < targetDistance) {
    upper += 1;
  }
  upper = Math.min(upper, lastIndex);
  const lower = Math.max(0, upper - 1);
  const lowerDistance = path.cumulativeLengthsMm[lower];
  const upperDistance = path.cumulativeLengthsMm[upper];
  const segmentLength = upperDistance - lowerDistance;
  if (segmentLength <= POSITION_EPSILON) {
    return directReference(instance.particleStart + path.vertexIndices[lower]);
  }
  const alpha = Math.min(1, Math.max(0, (targetDistance - lowerDistance) / segmentLength));
  if (alpha <= 1e-6) return directReference(instance.particleStart + path.vertexIndices[lower]);
  if (alpha >= 1 - 1e-6) return directReference(instance.particleStart + path.vertexIndices[upper]);
  return {
    particleIndices: [
      instance.particleStart + path.vertexIndices[lower],
      instance.particleStart + path.vertexIndices[upper],
    ],
    weights: [1 - alpha, alpha],
  };
}

function buildFoldConstraints(
''',
        'attachment reference helpers',
    ),
])

for test_path in [
    "apps/web/src/physics/waistbandZeroEnergyRecovery.test.ts",
    "apps/web/src/physics/phase0BandAttachmentInvariant.test.ts",
]:
    patch_file(test_path, [
        (
            '  const openingLengthMm = edgeRangeSequenceLength(garment.pieces, openingRanges);',
            '  const openingLengthMm = physicalOpeningLengthMm(garment, openingRanges);',
            'physical opening length in fixture',
        ),
        (
            'function pointDistance(positions: Float32Array, firstOffset: number, secondOffset: number): number {',
'''function physicalOpeningLengthMm(
  garment: GarmentDraft,
  ranges: readonly EdgeRange[],
): number {
  return ranges.reduce((total, range) => {
    const piece = garment.pieces.find((candidate) => candidate.id === range.pieceId);
    const materialLength = edgeRangeSequenceLength(garment.pieces, [range]);
    return total + materialLength * (piece?.cutOnFold ? 2 : 1);
  }, 0);
}

function pointDistance(positions: Float32Array, firstOffset: number, secondOffset: number): number {''',
            'physical opening helper',
        ),
    ])
