# 11.0.7a — BodyReference2D view intent

## Base

- Branch base: `recovery/11.0.7a-adjust-body-conform`
- Base HEAD: `ed5f8554b5c961047e8e58141f78239a9a824f24`
- Work branch: `fix/11.0.7a-body-reference-view-intent`

## Root cause

`BodyReference2D` persisted the selected view as `surface`, but the effective 3D
seed still used the nearest discrete `bodyAnchorId`. The 2D nearest-anchor
decision did not explicitly prove that the anchor position belonged to the
front/back hemisphere requested by the view. A later 3D resolve therefore
trusted an anchor that could disagree with the recorded surface.

The same 2D synchronization effect could also run after a direct 3D pose had
been authored, allowing a reference view to compete with the persistent 3D
arrangement.

## Implementation

- Seed candidates are now filtered geometrically using the canonical
  `HumanBodyModel.bodyFrame.front`, body bounds center, anchor position and
  outward normal.
- Front and back views can only select anchors on their corresponding visible
  hemisphere; nearest distance is evaluated only after that restriction.
- Front/back anchor handles in the 2D reference obey the same restriction.
- An existing authored 3D transform or surface attachment always wins. The 2D
  reference remains an initial seed and cannot reseed a manually moved panel.
- Placement remains rigid with `scale: 1`; no conform, deformation, XPBD or
  collision code was changed.

## Files

- `apps/web/src/avatar/BodyProjection2D.ts`
- `apps/web/src/avatar/BodyProjection2D.test.ts`
- `apps/web/src/components/BodyReference2D.tsx`

No schema field or migration was added.

## Validation

- Focused BodyProjection2D and ArrangementWorkspace tests: PASS (36 tests).
- Typecheck: PASS.
- Build: PASS.
- `git diff --check`: PASS (only the repository's CRLF conversion warnings).

## Non-blocking architectural debt

The body reference still uses a limited set of discrete anchors. A future task
should implement continuous projection from the authored 2D coordinate and
view onto `HumanBodyModel.visualMesh` (orthographic first hit), instead of
adding more landmarks or semantic heuristics.
