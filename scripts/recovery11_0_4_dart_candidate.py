from pathlib import Path

path = Path("apps/web/src/garment3d/IsometricSurfaceAssembly.ts")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
'''  candidateDiagnostics: Array<{
    name: string;
    score: number;
    metrics: IsometricAssemblyMetrics;
  }>;''',
'''  candidateDiagnostics: Array<{
    name: string;
    score: number;
    localShapingResidualMm: number;
    metrics: IsometricAssemblyMetrics;
  }>;''',
"candidate diagnostic shaping residual",
)

replace_once(
'''interface CandidateScore {
  candidate: Candidate;
  metrics: IsometricAssemblyMetrics;
  selectionMetrics: IsometricAssemblyMetrics;
  score: number;
}''',
'''interface CandidateScore {
  candidate: Candidate;
  metrics: IsometricAssemblyMetrics;
  selectionMetrics: IsometricAssemblyMetrics;
  localShapingResidualM: number;
  score: number;
}''',
"candidate score shaping residual",
)

replace_once(
'''    const candidates = buildCandidates(component, coarse);
    const selectionComponent = dominantStructuralSubcomponent(component, coarse);
    candidateCount += candidates.length;''',
'''    const candidates = buildCandidates(component, coarse);
    const selectionComponent = dominantStructuralSubcomponent(component, coarse);
    const hasLocalShaping = component.seams.some(
      (seam) => seam.classification === "local-shaping-closure",
    );
    candidateCount += candidates.length;''',
"detect local shaping",
)

replace_once(
'''      const metrics = measureComponentMetrics(component, coarse);
      const selectionMetrics = measureComponentMetrics(selectionComponent, coarse);
      return {
        candidate: snapshotCandidate(candidate.name, component, coarse),
        metrics,
        selectionMetrics,
        score: objective(selectionMetrics, selectionComponent),
      };''',
'''      const metrics = measureComponentMetrics(component, coarse);
      const selectionMetrics = measureComponentMetrics(selectionComponent, coarse);
      const localShapingResidualM = maximumLocalShapingResidual(component, coarse);
      return {
        candidate: snapshotCandidate(candidate.name, component, coarse),
        metrics,
        selectionMetrics,
        localShapingResidualM,
        score: objective(selectionMetrics, selectionComponent),
      };''',
"measure local shaping candidate residual",
)

replace_once(
'''    solved.sort((left, right) =>
      candidateAdmissibilityRank(left.selectionMetrics) - candidateAdmissibilityRank(right.selectionMetrics)
      || left.score - right.score
      || left.candidate.name.localeCompare(right.candidate.name),
    );''',
'''    solved.sort((left, right) => {
      // A closed shaping operation is a hard assembly relation, not a drape
      // preference. Do not let a metrically cheap flat chart beat an already
      // developable closed dart and hand 40 mm of closure to XPBD.
      if (hasLocalShaping) {
        const closureDelta = left.localShapingResidualM - right.localShapingResidualM;
        if (Math.abs(closureDelta) > 1e-7) return closureDelta;
      }
      return candidateAdmissibilityRank(left.selectionMetrics) - candidateAdmissibilityRank(right.selectionMetrics)
        || left.score - right.score
        || left.candidate.name.localeCompare(right.candidate.name);
    });''',
"sort hard local shaping closure first",
)

replace_once(
'''      candidateDiagnostics: solved.map((candidate) => ({
        name: candidate.candidate.name,
        score: candidate.score,
        metrics: candidate.metrics,
      })),''',
'''      candidateDiagnostics: solved.map((candidate) => ({
        name: candidate.candidate.name,
        score: candidate.score,
        localShapingResidualMm: candidate.localShapingResidualM * 1_000,
        metrics: candidate.metrics,
      })),''',
"expose shaping residual diagnostics",
)

anchor = '''function candidateAdmissibilityRank(metrics: IsometricAssemblyMetrics): number {'''
helper = '''function maximumLocalShapingResidual(
  component: Component,
  coarse: CoarseAssemblySet,
): number {
  let maximum = 0;
  for (const seam of component.seams) {
    if (seam.classification !== "local-shaping-closure") continue;
    const meshA = coarse.byInstanceId.get(seam.instanceA);
    const meshB = coarse.byInstanceId.get(seam.instanceB);
    if (!meshA || !meshB) continue;
    const a = evaluateCoarseBinding(meshA, seam.a);
    const b = evaluateCoarseBinding(meshB, seam.b);
    maximum = Math.max(
      maximum,
      Math.abs(length3(sub(b, a)) - Math.max(0, seam.restDistanceM)),
    );
  }
  return maximum;
}

function candidateAdmissibilityRank(metrics: IsometricAssemblyMetrics): number {'''
replace_once(anchor, helper, "local shaping residual helper")

replace_once(
'''function buildCandidates(component: Component, coarse: CoarseAssemblySet): Candidate[] {
  const authoredDevelopable = snapshotCandidate("authored-developable-seed", component, coarse);''',
'''function buildCandidates(component: Component, coarse: CoarseAssemblySet): Candidate[] {
  const authoredDevelopable = snapshotCandidate("authored-developable-seed", component, coarse);
  const authoredDevelopableRaw: Candidate = {
    name: "authored-developable-raw",
    positions: new Map(
      [...authoredDevelopable.positions].map(([id, values]) => [id, new Float32Array(values)]),
    ),
    project: false,
  };
  const hasLocalShaping = component.seams.some(
    (seam) => seam.classification === "local-shaping-closure",
  );''',
"raw authored developable candidate",
)

replace_once(
'''  const candidates = component.supportsShell
    ? [
        authoredDevelopable,
        flat,
        metricRelaxedRaw,
        metricRelaxed,
        materialPreservingRaw,
        materialPreserving,
        materialPreservingMirror,
        developableRaw,
        developable,
        mirrored,
      ]
    : [authoredDevelopable, flat, developable, hinged, hingedMirror];
  return dedupeCandidates(candidates);''',
'''  const candidates: Candidate[] = component.supportsShell
    ? [
        authoredDevelopable,
        flat,
        metricRelaxedRaw,
        metricRelaxed,
        materialPreservingRaw,
        materialPreserving,
        materialPreservingMirror,
        developableRaw,
        developable,
        mirrored,
      ]
    : [authoredDevelopable, flat, developable, hinged, hingedMirror];
  if (hasLocalShaping) candidates.unshift(authoredDevelopableRaw);
  return dedupeCandidates(candidates);''',
"include raw dart seed",
)

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
