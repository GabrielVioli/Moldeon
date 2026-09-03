from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GLOBAL = ROOT / "apps/web/src/viewport/GlobalThreeViewport.ts"
ASSEMBLY_PANEL = ROOT / "apps/web/src/components/AssemblyPanel.tsx"
ASSEMBLY_HISTORY_TEST = ROOT / "apps/web/src/state/assemblyHistory.test.ts"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


text = GLOBAL.read_text(encoding="utf-8")
text = replace_once(
    text,
    'import { SewingViewportOverlay, type SewingOverlaySelection } from "./SewingViewportOverlay";\n',
    'import { SewingViewportOverlay, type SewingOverlaySelection } from "./SewingViewportOverlay";\n'
    'import { connectedSewingInstanceIds } from "./SewingInteraction";\n',
    "SewingInteraction import",
)

text = replace_once(
    text,
    '''      if (extendSelection) {
        if (this.selectedInstanceIds.has(item.key)) this.selectedInstanceIds.delete(item.key);
        else this.selectedInstanceIds.add(item.key);
      } else if (!this.selectedInstanceIds.has(item.key)) {
        this.selectedInstanceIds.clear();
        this.selectedInstanceIds.add(item.key);
      }
''',
    '''      // A confirmed seam makes its active physical connected component a
      // rigid arrangement selection. We reuse the already-stable multi-select
      // drag path instead of inventing a sewing movement solver: one authored
      // translation/rotation is applied to every connected PanelInstanceV3.
      const sewnComponentIds = new Set(connectedSewingInstanceIds(
        this.assemblyState?.stitchConstraints ?? [],
        item.key,
      ));
      if (extendSelection) {
        const removeComponent = [...sewnComponentIds].every((instanceId) =>
          this.selectedInstanceIds.has(instanceId),
        );
        for (const instanceId of sewnComponentIds) {
          if (removeComponent) this.selectedInstanceIds.delete(instanceId);
          else this.selectedInstanceIds.add(instanceId);
        }
      } else {
        const selectionAlreadyMatchesComponent = this.selectedInstanceIds.size === sewnComponentIds.size
          && [...sewnComponentIds].every((instanceId) => this.selectedInstanceIds.has(instanceId));
        if (!selectionAlreadyMatchesComponent) {
          this.selectedInstanceIds.clear();
          for (const instanceId of sewnComponentIds) this.selectedInstanceIds.add(instanceId);
        }
      }
''',
    "arrangement sewn-component selection",
)

text = replace_once(
    text,
    '''    this.host.dataset.sewingThreadCount = String(
      (this.assemblyState?.stitchConstraints.filter((constraint) => !constraint.seamGroupId.startsWith("dart:")).length ?? 0)
      + proposalConstraints.length,
    );
    this.host.dataset.sewingProposalWarnings = JSON.stringify(proposalWarnings);
''',
    '''    this.host.dataset.sewingPhysicalThreadCount = String(
      (this.assemblyState?.stitchConstraints.filter((constraint) => !constraint.seamGroupId.startsWith("dart:")).length ?? 0)
      + proposalConstraints.length,
    );
    this.host.dataset.sewingThreadCount = String(this.sewingOverlay.visualThreadCount);
    this.host.dataset.sewingDirectionNotchCount = String(this.sewingOverlay.directionNotchCount);
    this.host.dataset.sewingProposalWarnings = JSON.stringify(proposalWarnings);
''',
    "sewing overlay diagnostics",
)
GLOBAL.write_text(text, encoding="utf-8")

panel = ASSEMBLY_PANEL.read_text(encoding="utf-8")
panel = replace_once(
    panel,
    '''              <button type="button" onClick={(event) => { event.stopPropagation(); for (const seam of group) toggleSeamDirection(seam.id); }}>
                Inverter
              </button>
''',
    '''              <button type="button" onClick={(event) => { event.stopPropagation(); for (const seam of group) toggleSeamDirection(seam.id); }}>
                Inverter direção
              </button>
''',
    "reverse sewing label",
)
ASSEMBLY_PANEL.write_text(panel, encoding="utf-8")

test = ASSEMBLY_HISTORY_TEST.read_text(encoding="utf-8")
test = replace_once(
    test,
    '''    expect(overlay.threadLines.geometry.getAttribute("position").count)
      .toBe(arrangement.state.stitchConstraints.length * 2);
''',
    '''    expect(overlay.threadLines.geometry.getAttribute("position").count)
      .toBe(overlay.visualThreadCount * 2);
    expect(overlay.visualThreadCount).toBeGreaterThanOrEqual(arrangement.state.stitchConstraints.length);
    expect(overlay.directionNotchCount).toBeGreaterThan(0);
''',
    "CLO-style visual thread density expectation",
)
ASSEMBLY_HISTORY_TEST.write_text(test, encoding="utf-8")

print("Applied 11.0.8 sewn-component movement + Phase E UI patch")
