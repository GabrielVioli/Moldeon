# Prompt 10.7 — Coarse Isometric Assembly

## Status

Prompt 10.7 refounds STEP-0 garment assembly around canonical physical instance binding and a derived deformable coarse surface. It is not a pants/skirt/waistband patch.

The requested source commit was `7e0e0acf26cbec1c9df1846dc45331a5be53fe36` on `recovery/10.6-constraint-spatial-assembly`. That commit still represented part of 10.6 through recovery scripts/finalizers. The 10.7 branch first materialized that requested state, validated it, and removed obsolete 10.6 recovery scaffolding before auditing the canonical boundary.

## Canonical audit verdict

Two independent pre-solver foundation defects were confirmed.

### Physical SeamGroup binding

At the requested baseline, `SeamGroupV3` persisted material ranges but not the exact physical `PanelInstanceV3` identities participating in a realization when definitions had multiple copies. Runtime code reconstructed pairing through copy/body-side/order rules, and 10.6 `paired-copies` persisted an intention but not concrete ids.

V3 was extended retrocompatibly with `physicalBindings`. Material identity remains `PatternDefinition + EdgeRange`; the binding stores only pattern ids plus concrete `PanelInstanceV3.id` values. No PatternDocumentV4 and no geometry duplication were introduced.

The legacy paired-copy flag is migration-only and normalizes to explicit ids. Parse, validate, serialize and projection round trips are tested.

### Manual/unclassified pieces

At the requested baseline, `ResolvedAssemblyInput` admitted only instances with confirmed placement plus arrangement anchor. A valid user-drawn/unclassified piece could therefore disappear before structural assembly. Missing avatar anchors were also treated as a structural visibility failure later.

Structural admission is now based on physical inclusion/simulation. Body placement, arrangement anchor, connector roles and avatar semantics are optional hints. Manual and template documents use the same coarse engine.

## New STEP-0 pipeline

```text
PatternDocumentV3
-> exact physical seam resolution
-> derived physical panel topology
-> CoarseAssemblyMesh per PanelInstance
-> material/seam connected components
-> developable candidate seeds
-> global local-global geometric solve
-> metric/area/overlap validation
-> coarse-to-fine barycentric transfer
-> dedicated Assembly Worker response
-> XPBD initialization
```

## Coarse surface

The coarse mesh is derived and rebuild-only. It contains material coordinates, local triangles, metric edges, internal hinges, boundary/source mapping and physical panel identity.

A key implementation discovery was that simply reusing contour triangulation is insufficient: a long diagonal across a rectangle becomes a non-local metric bar when a developable strip bends. The coarse representation therefore uses local patches: adaptive structured remeshing for quadrilaterals and bounded subdivision for general boundaries.

This is not adaptive physics mesh work. The normal physics/visual topology remains separate.

## Geometric solver

The solver is a projective/local-global geometric embedding, not XPBD. It has no velocities, gravity, physical time or drape history.

Variables are coarse surface vertices. Internal edges preserve approximate material lengths while hinges permit normal changes. Structural seams are projected jointly across the whole connected component. Darts and intentional mismatch do not receive global closure authority.

Candidate selection includes developable seeds but every well-supported shell is validated by the same global metric/seam/overlap objective. Old rigid placement is not final authority.

## Small closed-loop dominance

The synthetic P0 reproduced the architectural failure class: a four-panel manual skirt is stable, then adding a self-closed strip can create an alternative graph cycle that includes the strip. If that cycle defines the initial circumference, the strip behaves like a spatial nucleus and the skirt becomes a radial structure.

The generic fix is graph-geometric: a node with an independent structural self-loop is treated as its own developable substructure while selecting the primary independent multipanel cycle. If an independent cycle exists among the remaining surfaces, the self-loop cannot enlarge/redefine it. It is then phase/winding aligned from actual material correspondences and participates in the global solve.

No code asks whether that loop is a waistband, cuff, sleeve, band or another garment type.

## Metric-first corrections

The implementation also corrected several false objective signals:

- seam sample count no longer gives one SeamGroup arbitrary extra vote;
- self-loop phase and winding are selected from material correspondences;
- overlap uses actual material-local adjacency rather than triangle array-index proximity;
- same-panel local material neighbours are not treated as self-collisions;
- area distortion is material-area weighted so tiny boundary slivers cannot dominate the garment score;
- overlap broadphase prunes impossible pairs deterministically without changing the predicate.

## Pants/crotch finding

Pants exposed another canonical-runtime mismatch without requiring a pants rule. The stage-by-stage trace now proves outseam, inseam, front rise and back rise survive:

```text
PatternDocumentV3
-> legacy derived projection
-> GarmentAssembly
-> PhysicalGarmentAssembly
-> CoarseSeamResolution
```

Two generic defects caused the earlier loss:

1. a legacy same-material guard still checked the deprecated `physicalPairing` flag rather than explicit physical bindings;
2. `ease` had been conflated with “not structurally connected”, which disconnected real garment topology.

Now topology connectivity and geometric closure strength are separate concerns. Ease can connect surfaces while retaining fit residual for XPBD.

## P0 synthetic validation

Synthetic tests use manually authored/unclassified V3-equivalent geometry and do not claim to be the user's real browser document.

### Manual skirt without band

The four-panel manual skirt forms a 3D shell on the coarse solver with low metric distortion and no semantic/body-placement dependency.

Observed during implementation:

- about 216 coarse vertices versus about 2100 fine vertices before later local-remesh tuning;
- non-planar 3D shell;
- seam max about 2.6 mm in an early stable run;
- mean metric error about 0.4% in that run.

### Same skirt + closed band

The same main shell plus a closed strip passes a differential test that compares main-panel centroid distances, metric error, overlap and non-planarity. Adding the small loop is required to remain a local/continuous change rather than a topological rearrangement.

The gate is intentionally stricter than “looks roughly correct”: main-shell mean metric distortion must remain below 3.5%, robust max below 35%, and normalized main-shell distance drift below 25% in the synthetic test.

## Dedicated Assembly Worker

The geometric solve executes in its own Worker. Starting revision B terminates an in-flight revision A instead of queueing it. Generation/revision guards reject stale responses. Dispose terminates the current Worker. XPBD has a separate lifecycle and receives a new geometry only after the current assembly revision returns.

The Worker protocol intentionally has no XPBD velocity/temporal buffers.

## DEV exact-document regression path

DEV exposes:

```js
window.__MOLDEON_ASSEMBLY_DEV__.exportCurrentV3TestFixture()
```

It returns the exact `serializePatternDocumentV3()` output. Tests parse that JSON back through the canonical document input and compare deterministic assembly signatures/metrics. No separate fixture schema was created.

Exact user browser documents have not been captured in the cloud run. Therefore files named `real-*.v3.json` have intentionally not been invented.

## XPBD boundary

A dedicated zero-gravity boundary test covers STEP 0, 1, 10, 60 and 240 for representative shell/band/pants fixtures. It checks Adapter correspondence continuity, finite positions/velocities, first-step displacement and progressive residual refinement. XPBD is allowed to refine residuals, not reconstruct a garment that was meters apart at STEP 0.

## Legacy classification

See `docs/ASSEMBLY_ARCHITECTURE_V2.md`. In short, canonical V3 and material seam sampling stay; tube/rigid/BFS behavior is seed-only or deprecated as final authority. The active viewport waits for the coarse Assembly Worker rather than treating `SemanticAvatarArrangement`/per-panel SE(3) as the final STEP-0 embedding.

## Scope exclusions

No body collision, floor, dynamic self-collision, cloth-cloth collision, adaptive physics mesh, GPU compute, LLM, Prompt 11 or hidden XPBD pre-simulation was added.

## Validation declaration

The final validation workflow for this branch must set the definitive automated status only after canonical tests, G1-G24, XPBD boundary, 10.3 regressions, 10.4-A performance regression, useful 10.5/10.6 regressions, full suite, typecheck, build, diff check and browser/mobile smoke all pass.

Regardless of automated synthetic success, the user must export/test the exact browser documents for:

- real skirt without waistband;
- the same real skirt with waistband;
- the real multipanel garment that previously showed ~0.5–1.5+ m STEP-0 seam separation.

**REAL DOCUMENT VALIDATION: REQUIRED**


## Final automated validation

- Canonical V3 / physical-instance binding gates: PASSED.
- P0 synthetic manual skirt and same skirt + closed band: PASSED.
- G1-G24 architecture suite, including body + two independent bands: PASSED.
- STEP 0/1/10/60/240 zero-gravity Assembly to Adapter to XPBD boundary: PASSED.
- Prompt 10.3 residual regressions: PASSED.
- Prompt 10.4-A XPBD hot-loop regression: PASSED.
- Useful Prompt 10.5/10.6 assembly regressions: PASSED.
- Full web test suite: PASSED.
- Typecheck and build: PASSED.
- Rust fmt/clippy/tests: PASSED.
- Chromium desktop/mobile smoke and console-error gate: PASSED.
- `git diff --check`: enforced before final commit.

**AUTOMATED VALIDATION: PASSED**

Exact user-authored browser V3 fixtures were not available in the cloud execution. The DEV bridge exports them with the existing canonical serializer.

**REAL DOCUMENT VALIDATION: REQUIRED**
