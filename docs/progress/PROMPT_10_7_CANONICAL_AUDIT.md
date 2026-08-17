# Prompt 10.7 — Canonical audit before geometric refoundation

## Requested base

The branch was created from exact SHA `7e0e0acf26cbec1c9df1846dc45331a5be53fe36`. That SHA contained the 10.6 finalizer/recovery patches rather than a materialized 10.6 tree. Prompt 10.7 first materialized those patches, verified typecheck and focused 10.6 tests, then removed the obsolete 10.6 recovery scaffolding before this audit.

## A1 — PatternDocumentV3 remains canonical

No V4. `PatternDefinitionV3` remains the sole owner of authoritative 2D geometry. `PanelInstanceV3` remains the physical copy and contains no duplicated pattern geometry. Workspace and physics remain derived/runtime state.

## A2/A3 — material SeamGroup to physical PanelInstances

Baseline 10.6 had `first/second: EdgeRange[]` plus `physicalPairing: paired-copies`. The actual runtime still paired ordinary multi-copy relations using body-side/list ordering and paired copies by sorted runtime instances. The participating physical instance ids were not persisted by the SeamGroup.

Prompt 10.7 extends V3 retrocompatibly with `physicalBindings`. A binding names concrete `PanelInstanceV3.id` values while the material side remains `PatternDefinition + EdgeRange`. Old `physicalPairing: paired-copies` is accepted only as a migration hint and normalized immediately to explicit bindings.

## A4 — no duplicated material semantics

Bindings contain only `patternId` and `panelInstanceId`. They never copy points, curves, EdgeRanges, triangulation or solver data.

## A5/A6 — manual/unclassified

Baseline `ResolvedAssemblyInput` required `includedIn3D && placementStatus=confirmed && arrangementAnchor`, so manual unclassified pieces were removed before structural assembly. `SemanticAvatarArrangement` also treated missing anchors as fatal visibility errors.

Prompt 10.7 changes structural eligibility to `includedIn3D && simulationEnabled`. A neutral runtime placement is derived only to let the legacy topology builder instantiate the canonical physical panel; it is not persisted and it is not a body-placement claim. Missing avatar anchors no longer remove a valid structural panel.

## A7/A8 — existing hints

`PatternBodyPlacementV3`, `PanelArrangementAnchorV3`, outward-side information and semantic connectors remain optional hints. They are not prerequisites for a manual skirt/torso to enter the assembly foundation.

## A9/A10

The canonical fixture path remains `serializePatternDocumentV3()`. Prompt 10.7 adds only a DEV export/import bridge around that serializer later in the stage. No alternate fixture schema is introduced.

## A11 gate answers

1. **How does a material SeamGroup become a physical seam?** By explicit `SeamGroupV3.physicalBindings`, resolved to exact `PanelInstanceV3.id` values before assembly constraints are sampled.
2. **Was cutQuantity > 1 unambiguous at the requested baseline?** No. Runtime body-side/order pairing was authoritative. It is now persisted explicitly; deterministic copyIndex pairing is only the migration default when an old relation admits an unambiguous equal-copy expansion, and explicit bindings override it.
3. **Was paired-copy 10.6 safely persisted?** No. The flag did not name concrete instances. It is now migration-only and serializes as explicit physical bindings.
4. **Did manual/unclassified pieces reach ResolvedAssemblyInput?** No at baseline. They do now when includedIn3D/simulationEnabled.
5. **Were template and manual structurally equivalent?** No at baseline. Both now enter the same structural assembly input; semantic hints differ but engine eligibility does not.
6. **Was a legacy projection losing information?** Yes. Instance-specific seam identity was reconstructed after projection. The derived runtime Seam now carries canonical physicalBindings through to GarmentAssembly.
7. **Does V3 need extension?** Yes, a backward-compatible physical binding extension only. No V4 and no geometry duplication.

These input-contract defects are fixed before introducing coarse/developable surface embedding.
