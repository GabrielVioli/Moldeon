# Moldeon Assembly Architecture V2

## 1. Canonical domain

`PatternDocumentV3` remains the single persisted authority. `PatternDefinitionV3` owns the 2D material geometry. `PanelInstanceV3` is a physical copy and does not duplicate that geometry. `SeamGroupV3` owns the authored material relation through ordered `EdgeRange[]` sides.

The runtime assembly is derived. Coarse surfaces, solver variables, physics particles and Three.js meshes are never a second source of truth.

## 2. Physical instance binding

A material seam and its physical realization are separate concepts.

Material identity:

```text
PatternDefinitionV3 + EdgeRange
```

Physical identity:

```text
PanelInstanceV3.id
```

`SeamGroupV3.physicalBindings` persists the exact physical realization. Each binding contains only pattern ids and concrete panel instance ids. It contains no copied points, curves or triangulation.

Legacy `physicalPairing: "paired-copies"` is accepted only as a migration hint and is normalized to explicit physical bindings. New runtime code resolves exact ids instead of body-side/list-order pairing.

## 3. Manual and unclassified pieces

A valid panel with `includedIn3D=true` and simulation enabled enters structural assembly even if its body placement is unclassified and it has no arrangement anchor. `PatternBodyPlacementV3`, `PanelArrangementAnchorV3`, outward-side data and semantic connectors are optional geometric priors, not admission requirements.

Templates and manually drawn pieces therefore use the same assembly engine.

## 4. Pipeline

```text
PatternDocumentV3
-> canonical physical seam resolution
-> derived fine topology
-> CoarseAssemblyMesh per PanelInstance
-> coarse material/seam constraint graph
-> local developable candidate seeds
-> global geometric isometric solve
-> deterministic material-space coarse->fine binding
-> initial XPBD state
-> dynamic XPBD
-> Three.js
```

The active viewport waits for the dedicated Assembly Worker before creating a new XPBD geometry generation. The old spatial arrangement code can supply a seed only; it is not final authority.

## 5. CoarseAssemblyMesh

Every participating physical panel creates a derived coarse surface containing:

- `panelInstanceId` and `sourcePatternId`;
- material coordinates;
- source/boundary mapping;
- local coarse triangles;
- material metric edges;
- internal hinges;
- authored boundary paths.

Structured quadrilaterals are remeshed into adaptive local cells. General polygons receive a bounded local subdivision. This avoids long contour-fan diagonals becoming non-local metric bars during bending.

The coarse surface exists only for STEP-0 assembly. It is neither the visual mesh nor the future adaptive physics mesh.

## 6. Solver

The selected method is a deterministic local-global/projective geometric solver over coarse surface vertices. It is deliberately not a cloth simulation.

There is no velocity, mass integration, gravity, timestep or physical history. Each iteration jointly projects:

- local material edge lengths;
- structural seam relations;
- internal hinge quality barriers;
- coarse overlap/degeneracy barriers;
- a minimal gauge constraint removing global rigid freedom.

Internal hinges allow neighboring triangles of the same physical panel to change normals while material edge lengths remain approximately preserved. Thus a single `PanelInstanceV3` can become a curved developable surface before XPBD.

## 7. Candidate seeds

Analytical/developable constructions remain allowed only as seeds. Examples include a self-closed material loop and a multipanel material cycle. A self-closed substructure is excluded from defining an independent larger multipanel cycle when such a cycle already exists, preventing a small loop from becoming the garment's spatial nucleus.

Phase and winding of closed developable seeds are chosen from material seam correspondences. No garment name or garment type participates.

For well-supported shells, deprecated rigid 10.6 placement does not compete as final authority. An ambiguous open component may retain a deterministic legacy/open seed because the material graph itself does not determine a unique hinge angle.

## 8. Metric preservation

The objective prioritizes material metric integrity. Local metric edges and material-area-weighted triangle area distortion are measured separately from seam residual.

Seam residual is not minimized at any cost. Darts, intentional mismatch, slack, gather and incompatible relations may retain residual for XPBD. `ease` remains a physical structural connection while its fit mismatch is retained through the authored rest-distance/ratio semantics.

## 9. Seam constraints

The existing accumulated arc-length sampler remains the source for 1↔1, 1↔N, N↔1 and N↔M correspondence. The coarse layer maps those samples into material-space barycentric references rather than inventing vertex pairing.

Multiple SeamGroups between the same PanelInstances remain distinct relations. Free boundaries never become synthetic seams.

## 10. Degeneracy barrier

Low seam residual alone is insufficient. The coarse embedding penalizes gross triangle overlap and collapse. Same-panel triangles that are local neighbors in material space are explicitly excluded from self-overlap candidates, because folded adjacent surface patches are not self-intersections.

A deterministic broadphase prunes impossible overlap pairs without changing the geometric predicate.

This barrier belongs only to initial geometric assembly and is not XPBD self-collision.

## 11. Orientation and ambiguity

Surface normals are kept locally continuous by the coarse mesh/hinge topology. Confirmed outward/arrangement/body information may be used as an optional prior. Without enough information, equivalent global orientations are resolved deterministically rather than by garment semantics.

Each connected component reports:

- `well-constrained`;
- `partially-constrained`;
- `ambiguous`;
- `assemblyConfidence`;
- an ambiguity reason when applicable.

An open chain is allowed to remain ambiguous instead of fabricating a unique 3D garment.

## 12. Coarse to fine transfer

Fine vertices bind in material space to one coarse triangle plus barycentric coordinates. The binding is constructed on rebuild. Applying a solved embedding is then a deterministic weighted evaluation with no per-frame nearest-neighbor search.

Ownership remains traceable:

```text
fine/coarse sample
-> PanelInstanceV3
-> PatternDefinitionV3
-> material/source mapping
```

Reset always rebuilds from canonical V3, not from a persisted physical pose.

## 13. Assembly Worker

Geometric embedding uses a dedicated Worker and a lifecycle independent from XPBD. Each solve has its own generation and canonical revision. Starting a newer solve terminates the obsolete Worker, so there is no unbounded queue. Stale generation/revision responses are ignored, and dispose terminates the active Worker.

Only after the Worker returns the current revision can XPBD create a new geometry generation.

## 14. DEV real-document export

DEV builds expose the exact canonical serializer through:

```js
window.__MOLDEON_ASSEMBLY_DEV__.exportCurrentV3TestFixture()
```

The returned value is `serializePatternDocumentV3(currentDocument)`. Test infrastructure parses this exact V3 JSON back through the canonical document path. There is no alternative fixture schema.

## 15. Responsibility boundary

Assembly is responsible for global spatial structure, approximate isometry, gross degeneracy rejection and a usable STEP-0 shell.

XPBD is responsible for dynamics, physical stretch/shear/bend, gravity, residual seam closure, ease, gather, slack, repuxo and shaping.

XPBD is not a topology discovery mechanism.

## 16. Legacy path classification

- `PatternDocumentV3`: **KEEP**.
- explicit physical instance binding: **KEEP**.
- accumulated material seam sampling: **KEEP**.
- analytical self-seam/developable embeddings: **SEED ONLY**.
- `placeConnectedPanelsRigidly`: **DEPRECATED / SEED ONLY**.
- primary tube/tube-group priority: **DEPRECATED**, no final authority.
- BFS first-visit placement: **DEPRECATED**, seed/bootstrap only.
- flat placement: **SEED ONLY**.
- frozen legacy candidate: **DEPRECATED**, restricted to mathematically ambiguous open components.
- Prompt 10.6 per-panel SE(3) solver: **DEPRECATED AS FINAL ASSEMBLY**, may contribute a seed during migration.
- `SemanticAvatarArrangement` legacy spatial heuristics: **DEPRECATED AS FINAL AUTHORITY**. The active viewport uses the coarse Assembly Worker result.

## 17. Non-goals

This architecture does not add body collision, ground, dynamic self-collision, GPU compute, adaptive physics mesh, LLM behavior or Prompt 11 functionality.
