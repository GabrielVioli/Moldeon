from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / "apps/web/src/state/editorStore.ts"
PANEL = ROOT / "apps/web/src/components/AssemblyPanel.tsx"
OVERLAY = ROOT / "apps/web/src/viewport/SewingViewportOverlay.ts"
HISTORY_TEST = ROOT / "apps/web/src/state/assemblyHistory.test.ts"
DOC = ROOT / "docs/modifications-11.0.8.md"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# Keep legacy projection and canonical SeamGroup treatment synchronized, and
# skip document/history churn when an edit is materially unchanged.
text = read(STORE)
text = once(
    text,
    '''  updateSeams: (updates) => {\n    if (updates.length === 0) return;\n    const byId = new Map(updates.map(({ seamId, update }) => [seamId, update] as const));\n    const selectedSeamId = get().selectedSeamId;\n    changeDocument(set, get, "seam", updates.length === 1 ? "Editar costura" : "Editar grupo de costura", (document) => ({\n      ...document,\n      garment: {\n        ...document.garment,\n        seams: (document.garment.seams ?? []).map((seam) => {\n          const update = byId.get(seam.id);\n          return update\n            ? { ...seam, ...update, ...(update.treatment ? { type: update.treatment } : {}) }\n            : seam;\n        }),\n      },\n    }), { selectedSeamId });\n  },''',
    '''  updateSeams: (updates) => {\n    if (updates.length === 0) return;\n    const existing = new Map((get().garment.seams ?? []).map((seam) => [seam.id, seam] as const));\n    const effective = updates.filter(({ seamId, update }) => {\n      const seam = existing.get(seamId);\n      if (!seam) return false;\n      if (update.treatment !== undefined\n        && seam.canonicalTreatment !== canonicalTreatmentForEditor(update.treatment)) return true;\n      return Object.entries(update).some(([key, value]) =>\n        (seam as unknown as Record<string, unknown>)[key] !== value,\n      );\n    });\n    if (effective.length === 0) return;\n    const byId = new Map(effective.map(({ seamId, update }) => [seamId, update] as const));\n    const selectedSeamId = get().selectedSeamId;\n    changeDocument(set, get, "seam", effective.length === 1 ? "Editar costura" : "Editar grupo de costura", (document) => ({\n      ...document,\n      garment: {\n        ...document.garment,\n        seams: (document.garment.seams ?? []).map((seam) => {\n          const update = byId.get(seam.id);\n          if (!update) return seam;\n          const canonicalTreatment = update.treatment === undefined\n            ? undefined\n            : canonicalTreatmentForEditor(update.treatment);\n          return {\n            ...seam,\n            ...update,\n            ...(update.treatment ? { type: update.treatment, canonicalTreatment } : {}),\n          };\n        }),\n      },\n    }), { selectedSeamId });\n  },''',
    "batch update canonical treatment",
)
text = once(
    text,
    '''function captureDocument(get: StoreGetter): EditorDocumentState {\n  const state = get();''',
    '''function canonicalTreatmentForEditor(treatment: SeamTreatment): NonNullable<Seam["canonicalTreatment"]> {\n  return treatment === "stretch" ? "elastic" : treatment;\n}\n\nfunction captureDocument(get: StoreGetter): EditorDocumentState {\n  const state = get();''',
    "canonical treatment helper",
)
write(STORE, text)


# Keep text/number editing local until commit so typing does not rebuild the
# resolved document on every keypress.
text = read(PANEL)
text = once(
    text,
    '''  const [seamNameDrafts, setSeamNameDrafts] = useState<Record<string, string>>({});''',
    '''  const [seamNameDrafts, setSeamNameDrafts] = useState<Record<string, string>>({});\n  const [seamNumberDrafts, setSeamNumberDrafts] = useState<Record<string, string>>({});''',
    "number draft state",
)
text = once(
    text,
    '''                onBlur={(event) => {\n                  const label = event.currentTarget.value.trim() || relationLabel;\n                  updateSeams(group.map((seam, index) => ({\n                    seamId: seam.id,\n                    update: { name: group.length > 1 ? `${label} · trecho ${index + 1}` : label },\n                  })));\n                  setSeamNameDrafts((current) => {''',
    '''                onBlur={(event) => {\n                  const label = event.currentTarget.value.trim() || relationLabel;\n                  if (label !== relationLabel) {\n                    updateSeams(group.map((seam, index) => ({\n                      seamId: seam.id,\n                      update: { name: group.length > 1 ? `${label} · trecho ${index + 1}` : label },\n                    })));\n                  }\n                  setSeamNameDrafts((current) => {''',
    "name no-op commit",
)
text = once(
    text,
    '''                  value={representative.targetRatio ?? Math.max(0.01, 1 + representative.easeRatio)}\n                  onChange={(event) => {\n                    const targetRatio = Math.max(0.01, event.currentTarget.valueAsNumber || 1);\n                    updateSeams(group.map((seam) => ({ seamId: seam.id, update: { targetRatio } })));\n                  }}\n                />''',
    '''                  value={seamNumberDrafts[`${relationKey}:ratio`]\n                    ?? String(representative.targetRatio ?? Math.max(0.01, 1 + representative.easeRatio))}\n                  onClick={(event) => event.stopPropagation()}\n                  onChange={(event) => setSeamNumberDrafts((current) => ({\n                    ...current,\n                    [`${relationKey}:ratio`]: event.currentTarget.value,\n                  }))}\n                  onBlur={(event) => {\n                    const currentValue = representative.targetRatio ?? Math.max(0.01, 1 + representative.easeRatio);\n                    const parsed = Number(event.currentTarget.value);\n                    const targetRatio = Number.isFinite(parsed) ? Math.max(0.01, parsed) : currentValue;\n                    if (Math.abs(targetRatio - currentValue) > 1e-9) {\n                      updateSeams(group.map((seam) => ({ seamId: seam.id, update: { targetRatio } })));\n                    }\n                    setSeamNumberDrafts((current) => {\n                      const next = { ...current };\n                      delete next[`${relationKey}:ratio`];\n                      return next;\n                    });\n                  }}\n                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}\n                />''',
    "ratio draft commit",
)
text = once(
    text,
    '''                  value={representative.slackMm ?? 0}\n                  onChange={(event) => {\n                    const slackMm = Math.max(0, event.currentTarget.valueAsNumber || 0);\n                    updateSeams(group.map((seam) => ({ seamId: seam.id, update: { slackMm } })));\n                  }}\n                />''',
    '''                  value={seamNumberDrafts[`${relationKey}:slack`] ?? String(representative.slackMm ?? 0)}\n                  onClick={(event) => event.stopPropagation()}\n                  onChange={(event) => setSeamNumberDrafts((current) => ({\n                    ...current,\n                    [`${relationKey}:slack`]: event.currentTarget.value,\n                  }))}\n                  onBlur={(event) => {\n                    const currentValue = representative.slackMm ?? 0;\n                    const parsed = Number(event.currentTarget.value);\n                    const slackMm = Number.isFinite(parsed) ? Math.max(0, parsed) : currentValue;\n                    if (Math.abs(slackMm - currentValue) > 1e-9) {\n                      updateSeams(group.map((seam) => ({ seamId: seam.id, update: { slackMm } })));\n                    }\n                    setSeamNumberDrafts((current) => {\n                      const next = { ...current };\n                      delete next[`${relationKey}:slack`];\n                      return next;\n                    });\n                  }}\n                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}\n                />''',
    "slack draft commit",
)
write(PANEL, text)


# Reuse BufferAttributes up to the high-water mark. This makes repeated
# create/delete/select cycles converge instead of allocating new GPU buffers on
# every overlay rebuild.
text = read(OVERLAY)
text = once(
    text,
    '''function resetGeometry(geometry: THREE.BufferGeometry, segmentCount: number): void {\n  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segmentCount * 6), 3));\n  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(segmentCount * 6), 3));\n  geometry.setDrawRange(0, segmentCount * 2);\n}''',
    '''function resetGeometry(geometry: THREE.BufferGeometry, segmentCount: number): void {\n  const requiredVertices = segmentCount * 2;\n  const currentPosition = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;\n  const currentColor = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;\n  if (!currentPosition || !currentColor || currentPosition.count < requiredVertices || currentColor.count < requiredVertices) {\n    const capacityVertices = Math.max(2, nextPowerOfTwo(requiredVertices));\n    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacityVertices * 3), 3));\n    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(capacityVertices * 3), 3));\n  } else if (currentPosition.count > requiredVertices) {\n    (currentPosition.array as Float32Array).fill(0, requiredVertices * 3);\n    currentPosition.needsUpdate = true;\n  }\n  geometry.setDrawRange(0, requiredVertices);\n}\n\nfunction nextPowerOfTwo(value: number): number {\n  if (value <= 1) return 1;\n  return 2 ** Math.ceil(Math.log2(value));\n}''',
    "overlay high-water buffers",
)
write(OVERLAY, text)


# Regressions: stale canonical treatment must follow an edit, and overlay
# rebuild should reuse attributes at the same/high-water capacity.
text = read(HISTORY_TEST)
text = once(
    text,
    '''    expect(overlay.directionNotchCount).toBeGreaterThan(0);\n    overlay.setVisibility(false, true);''',
    '''    expect(overlay.directionNotchCount).toBeGreaterThan(0);\n    const edgePositionBuffer = overlay.edgeLines.geometry.getAttribute("position");\n    const threadPositionBuffer = overlay.threadLines.geometry.getAttribute("position");\n    overlay.rebuild(meshes, arrangement.state, { first: [], second: [] });\n    expect(overlay.edgeLines.geometry.getAttribute("position")).toBe(edgePositionBuffer);\n    expect(overlay.threadLines.geometry.getAttribute("position")).toBe(threadPositionBuffer);\n    overlay.setVisibility(false, true);''',
    "overlay buffer reuse test",
)
append = r'''

describe("11.0.8 canonical seam edit projection", () => {
  beforeEach(() => useEditorStore.getState().loadGarment(draft()));

  it("updates canonicalTreatment together with the legacy treatment field", () => {
    const seamId = createSeam("Canonical treatment");
    const loaded = structuredClone(useEditorStore.getState().garment);
    loaded.seams![0].canonicalTreatment = "standard";
    useEditorStore.getState().loadGarment(loaded);

    useEditorStore.getState().updateSeams([{ seamId, update: { treatment: "gather" } }]);
    const edited = useEditorStore.getState().garment.seams![0];
    expect(edited.treatment).toBe("gather");
    expect(edited.canonicalTreatment).toBe("gather");
    expect(buildResolvedAssemblyInput(useEditorStore.getState().garment).seamGroups[0].treatment).toBe("gather");

    useEditorStore.getState().updateSeams([{ seamId, update: { treatment: "stretch" } }]);
    expect(useEditorStore.getState().garment.seams![0].canonicalTreatment).toBe("elastic");
    expect(buildResolvedAssemblyInput(useEditorStore.getState().garment).seamGroups[0].treatment).toBe("elastic");
  });
});
'''
if 'describe("11.0.8 canonical seam edit projection"' not in text:
    text += append
write(HISTORY_TEST, text)

text = read(DOC)
section = r'''

### Refinement pass 2: edit integrity and resource high-water mark

A second static audit found two additional polish issues and fixes them before manual testing:

- editing `treatment` now updates the compatibility projection field `canonicalTreatment` in the same transaction (`stretch` maps to canonical `elastic`), preventing a V3 round-trip from restoring a stale treatment;
- no-op group edits are discarded before history/document cloning;
- name, target ratio and slack typing remain local to the UI and commit on blur/Enter, so typing does not produce a worker/document cascade per digit;
- sewing overlay BufferAttributes are retained to a geometric high-water capacity and reused across rebuilds, avoiding fresh buffer allocation on repeated create/remove/select cycles.

Focused regression coverage verifies treatment round-trip and same-capacity overlay BufferAttribute reuse.
'''
if "### Refinement pass 2: edit integrity and resource high-water mark" not in text:
    text += section
write(DOC, text)

print("Applied 11.0.8 sewing refinement pass 2")
