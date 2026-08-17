from pathlib import Path

path = Path('apps/web/src/garment3d/ConstraintSpatialAssembly.ts')
text = path.read_text()
marker = '''    const beforeMetrics = evaluateCandidateMetrics(
      state,
      legacyStatePositions,
      component,
      relations,
    );
    const candidates: Array<{'''
insertion = '''    const beforeMetrics = evaluateCandidateMetrics(
      state,
      legacyStatePositions,
      component,
      relations,
    );

    // A graph with no cycle and no parallel independent material relation is
    // genuinely underconstrained around at least one hinge. The previous
    // geometric propagation already provides a deterministic rigid/open pose.
    // Do not manufacture a dihedral angle or introduce Float32 drift merely to
    // reduce a local seam residual when the material graph cannot disambiguate
    // that degree of freedom.
    if (!component.supportsSpatialShell) {
      const frozen = evaluateFrozenCandidate(
        state,
        legacyStatePositions,
        component,
        relations,
        "validated-existing-embedding",
        "existing-embedding",
      );
      diagnostics.push({
        componentId: component.id,
        nodeIds: [...component.nodeIds],
        anchorId: component.anchorId,
        constraintCount: relations.length,
        cycleCount: component.cycleCount,
        freeBoundaryCount: component.freeBoundaryCount,
        candidateCount: 1,
        selectedSeed: frozen.name,
        assemblySolveMs: nowMs() - componentStartedAt,
        nonPlanarityRad: frozen.nonPlanarityRad,
        coarseOverlapScore: frozen.coarseOverlapScore,
        intrinsicDistortion: frozen.intrinsicDistortion,
        normalizedResidual: frozen.normalizedResidual,
        meanResidualMm: frozen.meanResidualMm,
        maxResidualMm: frozen.maxResidualMm,
        beforeMeanResidualMm: beforeMetrics.meanResidualMm,
        beforeMaxResidualMm: beforeMetrics.maxResidualMm,
        strategy: "underconstrained-open",
        reason: "insufficient-independent-relations-preserve-deterministic-open-pose",
        relationResiduals: frozen.relationResiduals,
      });
      continue;
    }

    const candidates: Array<{'''
assert marker in text, 'candidate marker not found'
path.write_text(text.replace(marker, insertion, 1))
print('Prompt 10.6 underconstrained open-component preservation applied')
