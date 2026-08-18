# Prompt 11 — Avatar Body Collision in XPBD

## Status

**AUTOMATED VALIDATION: PASSED**

**REAL REGISTERED-BODY BROWSER VALIDATION: REQUIRED**

Prompt 11 is ready for manual DEV validation. It is intentionally not declared production-complete until a garment with confirmed body placement is opened in the real browser and body collision is visually validated A/B.

## Base and branch

- Required base: `c48e323326f917f006cb2e392c3baaa104df5460`
- Branch: `recovery/11-avatar-body-collision-xpbd`
- Scope: static avatar-body collision inside the existing XPBD Worker, with DEV visual proof, diagnostics, measurement provenance and explicit performance accounting.
- Not in scope: floor collision, garment self-collision, cloth-cloth collision, adaptive physics mesh, GPU compute, structural-constraint reductions, silent iteration reductions or garment-specific collider tuning.

## P0 coordinate-registration audit

Collision was not connected immediately. The first gate compared the coordinate frame of the current coarse/fine garment assembly with `AvatarParametricModel` / `AvatarCollisionModel` on the real V3 fixtures.

The audit proved that the two spaces are not automatically identical today. A representative real-pants state had garment Y approximately `-0.646 .. 0.644 m`, while the procedural body/collider model occupied approximately `0.005 .. 1.689 m` with ground at Y=0 and anatomical landmarks above it.

The same audit showed that the current migrated real-pants, real-miniskirt and real-shirt fixtures are structurally valid for assembly but have body placement classified as `unclassified`: they do not provide a trustworthy arrangement anchor/body region/body side from which a body-to-garment transform can be inferred.

Enabling collision against identity-space colliders in that state would be mathematically valid collision against the wrong spatial registration. Prompt 11 explicitly rejects that failure instead of hiding it.

## SimulationBodyRegistration

`BodyCollisionRegistration.ts` introduces one explicit boundary between body space and garment simulation space.

`resolveSimulationBodyRegistration(...)` returns:

- `registered` when existing non-custom placement/anchor metadata provides an authorized correspondence;
- `body-placement-required` when it does not.

The current P0 transform is rigid translation only. No scale is allowed. Rotation remains identity until the document provides enough explicit orientation metadata to define an unambiguous rigid frame.

The registration code does not inspect garment names, template names, pants/skirt/shirt labels or geometric clothing classifiers.

A regression test loads the real-pants V3 fixture and requires `body-placement-required` rather than a guessed transform. Another test proves that explicit placement metadata registers without garment-name logic.

## Measurement provenance and anthropometric uncertainty

Real fixtures do not necessarily contain a complete set of manually supplied body measurements.

`AvatarParametricModel` now retains `measurementOrigins`, derived directly from the canonical measurement profile. DEV exposes the same provenance so a collision/fit observation can be separated into:

- `supplied`
- `estimated`
- `derived`

For the current real fixtures, the principal supplied body values are essentially:

- `heightMm`
- `bustMm`
- `waistMm`
- `hipMm`

Many other values used by the avatar are estimated, including arm and leg circumferences/proportions. Several secondary values are derived. In particular, thigh/calf/ankle and leg-length related data may not be direct ground truth.

Therefore a real garment looking tight or loose around a thigh/calf is not, by itself, proof that collision mathematics is wrong. The measurement origin must be inspected first.

No pelvis/thigh/calf radius was tuned specifically to make real-pants look attractive. Canonical collision scenes with explicitly known geometry are the primary proof of collision mathematics; real V3 fixtures remain end-to-end integration proof.

## Collision representation

The existing `AvatarCollisionModel` remains the source of the P0 analytical body proxies. The required set contains 12 proxies:

- ellipsoids: chest, abdomen, pelvis, head;
- capsules: left/right upper arm, forearm, thigh and calf.

The model is generated from the same `AvatarParametricModel` used by the procedural visual.

`bodyCollision.ts` packs the analytical primitives into typed arrays for the Worker. It supports:

- capsule point contact;
- ellipsoid point contact;
- deterministic deepest-contact choice when proxies overlap;
- finite fallback normals at degenerate axes/centers;
- particle radius from half fabric thickness plus a small contact skin;
- bounded position correction using the existing per-particle XPBD trust/correction limit;
- swept protection for high-speed traversal on the first solver iteration;
- inward-normal velocity removal;
- fabric-friction-based tangential slip reduction;
- per-step contact diagnostics.

Invalid or non-finite collider buffers fail explicitly instead of producing NaN propagation.

## XPBD integration

Body contact is integrated into the existing Worker pipeline. The structural configuration was not weakened.

At initialization, `GarmentXpbdAdapter` derives per-particle contact material from the actual fabric source:

- contact half-thickness from `FabricPhysics.thicknessMm / 2`;
- friction from `FabricPhysics.friction`.

Inside each XPBD step, body positional contact is solved after stretch, shear, bend and seam projection in each iteration. Swept contact is enabled on the first iteration to catch fast crossing. Contact velocity/friction is applied after the normal velocity update.

No hidden pre-simulation was added.

## Worker boundary verification

A late final inspection caught an important integration defect before the gate was closed: direct XPBD tests had a valid body state, but `simulation.worker.ts` was still constructing `XpbdState` without consuming the body buffers from `XpbdInitializationData`. In a real browser that would have left collision effectively disabled even though the solver mathematics passed.

The fix introduces `XpbdWorkerState.ts` as the canonical typed-array boundary from Adapter payload to Worker state. It materializes:

- packed collider kinds/data/regions;
- per-particle half-thickness;
- per-particle friction;
- contact skin;
- effective collision-enabled state;
- all existing structural/seam/pin data.

`simulation.worker.ts` now uses that constructor for initialize/updateGeometry. `updateFabric` also updates body thickness/friction buffers, and the DEV A/B setting updates `state.body.enabled` inside the actual Worker.

`XpbdWorkerState.test.ts` is an explicit regression for this exact failure class. It proves that a collider present in the Adapter payload survives into Worker state, produces a body contact on step, and remains present-but-inactive when collision is disabled.

## Diagnostics

The physics diagnostics expose body contact separately from the existing structural and seam metrics:

- `bodyColliderCount`
- `bodyContactCount`
- `bodyContactsByRegion`
- `maximumBodyPenetrationM`
- `maximumBodyCorrectionM`
- `frictionContactCount`
- `sweptContactCount`
- `bodyCollisionEnabled`
- `bodyCollisionMs`

This allows total `physicsStepMs` to remain total solver cost while `bodyCollisionMs` identifies the new contact phase.

## DEV visual proof

`APPROVED_AVATAR_ASSETS` remains untouched. Prompt 11 manual validation does not depend on a GLB.

In DEV, the viewport creates one `AvatarParametricModel` from the current document and uses that exact model for both:

1. the procedural `AvatarVisual`;
2. `AvatarCollisionModel` / packed physical proxies.

The resolved `SimulationBodyTransform` is applied to both visual and physical representations, so the procedural body and debug proxies share the same coordinate frame.

DEV defaults:

- `Body collision`: ON;
- `Show procedural avatar`: ON;
- `Show body colliders`: OFF, toggle available.

The DEV panel also provides A/B control for body collision and shows registration/contact/performance diagnostics.

When body placement is unavailable, the requested control remains ON in DEV but the effective collision set is empty and registration reports `body-placement-required`. The system deliberately does not guess a transform.

Changes to document body measurements rebuild the same parametric model used by the visual and collision proxies.

## Canonical mathematical scenes

The main collision proof uses explicitly known analytical scenes rather than treating estimated human proportions as truth.

Covered automated cases include:

- patch against an ellipsoid;
- patch against a capsule;
- torso contact across overlapping chest/abdomen/pelvis proxies;
- two independent leg volumes;
- high-speed swept capsule crossing;
- overlap resolution;
- friction 0 versus higher friction;
- zero-length/axis degeneracies;
- reset of body contact state;
- finite deterministic proxy generation;
- pelvis-to-thigh and chest-to-upper-arm junction coverage;
- Adapter-to-Worker body-state preservation.

These tests prove contact mathematics independently of the anthropometric quality of a real fixture.

## Real-fixture integration

Real V3 fixtures are used to prove the end-to-end boundary and measurement provenance.

The current real-pants fixture intentionally returns `body-placement-required` because its migrated pieces are unclassified. This is a correct integration result, not a collision failure.

To validate real-pants body collision visually, the document must first contain confirmed body placement sufficient to register garment and body. Prompt 11 does not infer that placement from the word “calça”, from piece names, or from the garment shape.

## Performance baseline and profiling

### Manual real browser baseline before body collision

Recent manual real-pants baseline supplied for the same product state before Prompt 11:

- particle count: approximately `6408`;
- total `physicsStepMs`: approximately `55 ms`;
- FPS: approximately `16`.

This is a pre-existing XPBD/browser cost. It must not be attributed to body collision.

The cloud validation cannot reproduce the same physical machine/browser, so a same-machine before/after real browser measurement is still required during manual validation.

### Initial collision implementation

A 6408-particle / 12-proxy / 8-iteration synthetic collision microbenchmark initially measured:

- median: `55.91 ms`;
- p95: `56.95 ms`.

That overhead was considered excessive. No structural fidelity was reduced. The contact phase was profiled first.

The main cost was the analytical query path checking every particle against all proxies repeatedly, including expensive narrow-phase/swept calculations even when the particle was spatially irrelevant to a proxy.

### Broadphase refinement

A conservative analytical AABB broadphase was added for point and swept segment queries, plus a zero-motion swept early exit. Narrow-phase equations and solver settings were not changed.

First post-refinement run:

- median isolated contact: `10.64 ms`;
- p95: `12.28 ms`.

A later optimized isolated run measured:

- median isolated contact: `8.16 ms`;
- p95: `9.59 ms`.

The change is culling only. It does not reduce mesh density, seams, XPBD iterations or structural constraints.

### Integrated synthetic comparison after Worker fix

The post-Worker-fix validation fixture uses:

- particles: `6408`;
- triangles: `12496`;
- stretch constraints: `18903`;
- shear constraints: `12496`;
- bend constraints: `12997`;
- seam constraints: `374`;
- XPBD iterations: `8`;
- body proxies: `12`.

On that CI run:

- collision OFF total median: `14.012 ms`;
- collision ON total median: `34.231 ms`;
- `bodyCollisionMs` median: `17.500 ms`;
- total median delta: `20.218 ms`;
- synthetic overhead: `144.3%`;
- median reported contacts in this deliberately intersecting stress layout: `1609` particles.

An earlier optimized CI run on the same synthetic shape measured approximately `10.734 / 26.384 / 13.601 ms` for OFF / ON / bodyCollisionMs. This variation is runner noise; the important result is that the body phase is now isolated and visible rather than silently folded into total cost.

These CI figures are not directly comparable to the manual `~55 ms` browser figure because hardware, runtime and exact scene differ. The objective of Prompt 11 was not to solve the entire pre-existing performance budget. The same-machine real-browser measurement remains the authoritative integration comparison.

## Automated validation

Final post-Worker-boundary validation:

- Worker/collision focused suite: `6` files, `28` tests passed;
- integrated 6408-particle performance sanity: PASSED;
- full web suite: `93` test files passed, `568` tests passed, `3` skipped (`571` total);
- TypeScript typecheck: PASSED;
- fallback production build: PASSED, `104` modules transformed;
- Rust `cargo fmt --all --check`: PASSED;
- Rust `cargo clippy --workspace --all-targets -- -D warnings`: PASSED;
- Rust workspace tests: PASSED;
- `git diff --check`: PASSED.

No structural solver setting, seam count or mesh density was reduced to make this gate pass.

## Manual DEV validation checklist

The next gate is visual/browser validation, not another solver rewrite.

1. Open the Prompt 11 branch in DEV.
2. Open a document with confirmed body placement so `body registration` reports `registered`.
3. Confirm the procedural body is visible even though no approved GLB exists.
4. Confirm the garment is visible in the same viewport.
5. Toggle `Show body colliders` ON and verify proxies overlay the same procedural body rather than a displaced/invisible body.
6. Confirm `Body collision` starts ON for the registered proof.
7. Run an A/B comparison with Body collision OFF then ON while keeping gravity, mesh, iterations and garment unchanged.
8. Watch `Body contacts`, `Max penetration mm`, `Max body correction mm`, `Swept contacts`, `bodyCollisionMs` and total `physicsStepMs`.
9. Re-measure the real-pants workload on the same machine/browser used for the pre-Prompt-11 baseline when body placement is registered: particle count, total `physicsStepMs`, `bodyCollisionMs` and FPS.
10. If real-pants appears too tight/loose at pelvis/thigh/calf, inspect the displayed measurement origins first. Do not tune solver/collider radii to compensate for estimated anthropometry.
11. Also open the current unclassified real-pants document and confirm it reports `body-placement-required` rather than silently colliding against a guessed body transform.

## Completion rule

Prompt 11 automated collision mathematics, Adapter/Worker integration, diagnostics, provenance and performance gates are green.

The prompt remains at **READY FOR MANUAL VALIDATION** until the registered DEV proof visibly shows:

1. procedural body;
2. garment;
3. optional physical proxies in the same frame;
4. body collision A/B behavior in the browser;
5. real-browser performance captured separately as total `physicsStepMs` and `bodyCollisionMs`.
