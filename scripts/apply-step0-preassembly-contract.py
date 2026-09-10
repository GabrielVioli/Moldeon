from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one marker, found {count}")
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return updated


# ---------------------------------------------------------------------------
# SewingStep0.ts
# STEP-0 is preassembly, not body fitting. The global sewing solver owns the
# intrinsic sewn shape. We apply ONE rigid transform to the whole connected
# component and center that sewn volume on the body axis at the authored
# vertical level. No circumference matching, no shrink-wrap, no per-panel pose.
# ---------------------------------------------------------------------------
step0_path = ROOT / "apps/web/src/viewport/SewingStep0.ts"
step0 = step0_path.read_text(encoding="utf-8")

step0 = replace_once(
    step0,
    '  registrationMode: "body-aware-self-seam" | "authored-rigid";\n',
    '  registrationMode: "body-aware-self-seam" | "authored-rigid" | "body-centered-rigid";\n',
    "registration mode union",
)

old_registration_block = '''  const registration = buildSewingStep0Registration(
    solvedRootPositions,
    currentRootWorldPositions,
    solvedRoot.topology.triangles,
    meshWorldMaterialAnchor(currentRootMesh.mesh).vertexIndex,
  );
  if (!registration) return null;

  const pending = new Map<string, Float32Array>();
  let maximumDisplacement = 0;
'''
new_registration_block = '''  const registration = buildSewingStep0Registration(
    solvedRootPositions,
    currentRootWorldPositions,
    solvedRoot.topology.triangles,
    meshWorldMaterialAnchor(currentRootMesh.mesh).vertexIndex,
  );
  if (!registration) return null;

  // STEP-0 registration is component-wide. The sewing solver already knows
  // the intrinsic sewn shape; the body only supplies an approximate spatial
  // center for preassembly. We deliberately preserve the authored vertical
  // level and material orientation, but do not fit/inflate/shrink the garment
  // to the body circumference. XPBD will resolve contact and ease later.
  const solvedComponentCenter = new THREE.Vector3();
  const currentComponentCenter = new THREE.Vector3();
  let solvedPointCount = 0;
  let currentPointCount = 0;
  for (const id of target.instanceIds) {
    const solvedInstance = solvedState.instances.find((instance) => instance.id === id);
    const meshData = meshes.find((item) => item.key === id);
    if (!solvedInstance || !meshData) return null;
    const solved = sliceInstancePositions(solvedState, id);
    if (!solved) return null;
    for (let offset = 0; offset < solved.length; offset += 3) {
      solvedComponentCenter.x += solved[offset];
      solvedComponentCenter.y += solved[offset + 1];
      solvedComponentCenter.z += solved[offset + 2];
      solvedPointCount += 1;
    }
    const currentWorld = worldPositions(meshData.mesh);
    for (let offset = 0; offset < currentWorld.length; offset += 3) {
      currentComponentCenter.x += currentWorld[offset];
      currentComponentCenter.y += currentWorld[offset + 1];
      currentComponentCenter.z += currentWorld[offset + 2];
      currentPointCount += 1;
    }
  }
  if (solvedPointCount === 0 || currentPointCount === 0) return null;
  solvedComponentCenter.multiplyScalar(1 / solvedPointCount);
  currentComponentCenter.multiplyScalar(1 / currentPointCount);

  const targetComponentCenter = currentComponentCenter.clone();
  if (options.bodySection) {
    const sectionCenter = options.bodySection.centerM
      ? new THREE.Vector3(...options.bodySection.centerM)
      : new THREE.Vector3(0, options.bodySection.yM, options.bodySection.centerZM);
    // x/z identify the body axis. y remains authored so "Montar" does not
    // silently move a skirt to the chest or a blouse to the hips.
    targetComponentCenter.x = sectionCenter.x;
    targetComponentCenter.z = sectionCenter.z;
  }

  const pending = new Map<string, Float32Array>();
  let maximumDisplacement = 0;
'''
step0 = replace_once(step0, old_registration_block, new_registration_block, "component registration setup")

old_transform = '''      const world = transformSewingStep0Point(point, registration);
      transformedWorld[offset] = world.x;
'''
new_transform = '''      const world = point
        .clone()
        .sub(solvedComponentCenter)
        .applyQuaternion(registration.rotation)
        .add(targetComponentCenter);
      transformedWorld[offset] = world.x;
'''
step0 = replace_once(step0, old_transform, new_transform, "component-centered transform")

old_return = '''    registrationMode: "authored-rigid",
    bodyFit: options.bodyFit ?? null,
'''
new_return = '''    registrationMode: options.bodySection ? "body-centered-rigid" : "authored-rigid",
    bodyFit: null,
'''
step0 = replace_once(step0, old_return, new_return, "component registration return")

step0_path.write_text(step0, encoding="utf-8")


# ---------------------------------------------------------------------------
# GlobalThreeViewport.ts
# Remove body-fit/circumference rejection and the second local body-aware solve.
# A click now means: solve sewing in free space -> one rigid component placement
# around the authored body level -> apply. Body penetration is diagnostic only
# because contact belongs to Provar/XPBD, not to Montar.
# ---------------------------------------------------------------------------
viewport_path = ROOT / "apps/web/src/viewport/GlobalThreeViewport.ts"
viewport = viewport_path.read_text(encoding="utf-8")
viewport = viewport.replace('  analyzeSewingStep0BodyFit,\n', '')

viewport = replace_once(
    viewport,
    '      surface: BodySurfaceFrame;\n      bodyAudit: ReturnType<typeof auditMeshBodyClearance>;\n',
    '      bodyAudit: ReturnType<typeof auditMeshBodyClearance>;\n',
    "snapshot surface field",
)

viewport = sub_once(
    viewport,
    r'''      const materialAnchor = sewingStep0MeshWorldMaterialAnchor\(item\.mesh\);\n      const surface = closestBodySurfacePoint\(\n        body,\n        \[materialAnchor\.position\.x, materialAnchor\.position\.y, materialAnchor\.position\.z\],\n        0,\n        0\.24,\n      \);\n      if \(!surface\) return \{ status: "too-far", affectedPanels: target\.instanceIds\.length \};\n      const position =''',
    '''      const materialAnchor = sewingStep0MeshWorldMaterialAnchor(item.mesh);\n      const position =''',
    "remove per-panel body proximity rejection",
)
viewport = viewport.replace('        surface,\n        bodyAudit:', '        bodyAudit:', 1)

viewport = sub_once(
    viewport,
    r'''      const rootSnapshot = snapshots\.get\(target\.rootInstanceId\);.*?      const transplanted = applySewingStep0SolvedComponent\(''',
    '''      // Resolve only the authored vertical neighborhood. The body is a\n      // placement reference here, never a fit target.\n      const authoredComponentCenter = new THREE.Vector3();\n      let authoredComponentCount = 0;\n      for (const instanceId of target.instanceIds) {\n        const snapshot = snapshots.get(instanceId);\n        if (!snapshot) continue;\n        authoredComponentCenter.add(meshWorldCentroid(snapshot.item.mesh));\n        authoredComponentCount += 1;\n      }\n      if (authoredComponentCount > 0) authoredComponentCenter.multiplyScalar(1 / authoredComponentCount);\n      const bodySection = avatar.humanBody.crossSections.length > 0\n        ? avatar.humanBody.crossSections.reduce((best, section) =>\n          Math.abs(section.yM - authoredComponentCenter.y) < Math.abs(best.yM - authoredComponentCenter.y)\n            ? section\n            : best,\n        )\n        : null;\n\n      const transplanted = applySewingStep0SolvedComponent(''',
    "remove body-fit preflight",
)

viewport = viewport.replace('          rootSurface: rootSnapshot?.surface ?? null,\n          bodyClearanceM: 0.0005,\n          bodyFit,\n', '', 1)

# Replace all post-transplant fitting/polish logic with a single acceptance path.
viewport = sub_once(
    viewport,
    r'''      const registeredBodyAudits: Record<string, unknown> = \{\};.*?    \} catch \(error\) \{''',
    '''      const bodyAudits: Record<string, unknown> = {};\n      for (const instanceId of target.instanceIds) {\n        const snapshot = snapshots.get(instanceId)!;\n        bodyAudits[instanceId] = {\n          before: snapshot.bodyAudit,\n          after: auditMeshBodyClearance(snapshot.item.mesh, body, 0.5, 112),\n          contactDeferredToPhysics: true,\n        };\n      }\n\n      const residualMm = (workerResidual?.maximumM ?? Number.POSITIVE_INFINITY) * 1_000;\n      const globalShapeSafe = Boolean(workerResidual)\n        && Number.isFinite(residualMm)\n        && residualMm <= 5\n        && workerMaterial !== null\n        && workerMaterial <= 0.02;\n      if (!globalShapeSafe) {\n        restoreSnapshots();\n        const rejectionReason = !workerResidual || !Number.isFinite(residualMm) || residualMm > 5\n          ? "global-sewing-shape-not-closed"\n          : "canonical-material-metric-exceeded";\n        this.host.dataset.sewingStep0Status = "rejected-global-shape";\n        this.host.dataset.sewingStep0Diagnostics = JSON.stringify({\n          rejectionReason,\n          authoredResidualBefore,\n          registeredResidual: workerResidual,\n          registeredMaterialDistortionMax: workerMaterial,\n          bodyAudits,\n        });\n        return {\n          status: "failed",\n          affectedPanels: target.instanceIds.length,\n          warning: `A montagem costurada não pôde ser formada sem alterar o molde (${rejectionReason}).`,\n        };\n      }\n\n      // Body placement gate: verify the sewn component is centered on the body\n      // axis, not beside/above it. Exact contact/clearance is intentionally NOT\n      // an acceptance condition in Montar; XPBD owns that in Provar.\n      const componentBox = new THREE.Box3();\n      for (const instanceId of target.instanceIds) {\n        const snapshot = snapshots.get(instanceId);\n        if (snapshot) componentBox.expandByObject(snapshot.item.mesh);\n      }\n      const componentCenter = componentBox.getCenter(new THREE.Vector3());\n      const sectionCenter = bodySection\n        ? bodySection.centerM\n          ? new THREE.Vector3(...bodySection.centerM)\n          : new THREE.Vector3(0, bodySection.yM, bodySection.centerZM)\n        : componentCenter.clone();\n      const horizontalOffsetM = Math.hypot(\n        componentCenter.x - sectionCenter.x,\n        componentCenter.z - sectionCenter.z,\n      );\n      if (bodySection && horizontalOffsetM > 0.08) {\n        restoreSnapshots();\n        this.host.dataset.sewingStep0Status = "rejected-component-placement";\n        this.host.dataset.sewingStep0Diagnostics = JSON.stringify({\n          rejectionReason: "component-not-centered-around-body",\n          horizontalOffsetMm: horizontalOffsetM * 1_000,\n          componentCenter: componentCenter.toArray(),\n          bodySectionCenter: sectionCenter.toArray(),\n        });\n        return {\n          status: "failed",\n          affectedPanels: target.instanceIds.length,\n          warning: "A forma costurada fechou, mas não pôde ser centralizada ao redor do manequim.",\n        };\n      }\n\n      for (const instanceId of target.instanceIds) {\n        const item = snapshots.get(instanceId)?.item;\n        if (item) syncMeshGeometryToAssemblyState(state, item);\n      }\n      const intrinsic = measureIntrinsicDistortion(state);\n      const renderedMeshes = captureGarmentMeshDiagnostics(\n        this.garmentMeshes.filter((item) => targetIds.has(item.key)),\n      );\n      this.refreshSewingOverlay();\n      this.host.dataset.sewingStep0Status = "applied-global-shape";\n      this.host.dataset.sewingStep0Ms = (performance.now() - startedAt).toFixed(2);\n      this.host.dataset.sewingStep0Diagnostics = JSON.stringify({\n        affectedPanels: target.instanceIds.length,\n        conformedPanels: 0,\n        maximumCentroidDisplacementMm: transplanted.maximumCentroidDisplacementM * 1_000,\n        metricDistortionMax: intrinsic.maxRelativeDistortion,\n        materialBefore,\n        materialAfter: workerMaterial,\n        bodyContactDeferredToPhysics: true,\n        bodyBounds: body.bounds,\n        bodySectionId: bodySection?.id ?? null,\n        horizontalOffsetMm: horizontalOffsetM * 1_000,\n        renderedMeshes,\n        registrationMode: transplanted.registrationMode,\n        bodyAudits,\n        proposalResidual: {\n          before: authoredResidualBefore,\n          afterLocal: workerResidual,\n          afterBody: workerResidual,\n        },\n        globalShape: {\n          strategy: response.diagnostics.assembly.strategy,\n          selectedSeeds: response.diagnostics.assembly.components.map((component) => ({\n            componentId: component.componentId,\n            panelInstanceIds: component.panelInstanceIds,\n            selectedSeed: component.selectedSeed,\n          })),\n          metrics: response.diagnostics.assembly.metrics,\n          warnings: response.warnings,\n          authoredResidualBefore,\n          registeredResidual: workerResidual,\n          registeredMaterialDistortionMax: workerMaterial,\n          maximumCentroidDisplacementMm: transplanted.maximumCentroidDisplacementM * 1_000,\n        },\n      });\n      this.host.dataset.simulationStatus = "disabled-in-montar";\n      this.requestRender();\n      return {\n        status: "applied",\n        affectedPanels: target.instanceIds.length,\n        conformedPanels: 0,\n        maximumCentroidDisplacementMm: transplanted.maximumCentroidDisplacementM * 1_000,\n        metricDistortionMax: intrinsic.maxRelativeDistortion,\n        seamResidualMaxMm: residualMm,\n      };\n    } catch (error) {''',
    "replace STEP-0 fitting/polish with preassembly acceptance",
)

# Remove imports that only belonged to the deleted second solver path.
viewport = viewport.replace('  auditSewingStep0Seams,\n', '')
viewport = viewport.replace('  solvePlacementAnchoredSewingStep0,\n', '')

viewport_path.write_text(viewport, encoding="utf-8")


# ---------------------------------------------------------------------------
# Browser gate. Every size is a preassembly case now. We verify sewn closure,
# material preservation, non-planar volume and body-centered placement. Body
# penetration is not a Montar failure because collision belongs to Provar.
# ---------------------------------------------------------------------------
audit_path = ROOT / "scripts/step0-browser-audit.mjs"
audit = audit_path.read_text(encoding="utf-8")
audit = replace_once(
    audit,
    '  await runScenario("self-seam-1020x300", 1020, 300, "wrap");\n  await runScenario("self-seam-435x227", 435, 227, "reject-too-small");\n',
    '  await runScenario("self-seam-1020x300", 1020, 300, "wrap");\n  await runScenario("self-seam-1400x300", 1400, 300, "wrap");\n  await runScenario("self-seam-435x227", 435, 227, "wrap");\n',
    "browser scenarios",
)

audit = sub_once(
    audit,
    r'''    const bodyAudits = Object\.values\(diagnostics\?\.bodyAudits \?\? \{\}\);\n    const bodySafe = bodyAudits\.length > 0 && bodyAudits\.every\(\(audit\) =>\n      Number\(audit\?\.after\?\.penetratingSamples \?\? 1\) === 0\n      && Number\(audit\?\.after\?\.minimumSignedClearanceMm \?\? -999\) >= -0\.5,\n    \);\n''',
    '',
    "remove body-clearance gate",
)

audit = replace_once(
    audit,
    '''      status = applied
        && Number.isFinite(residualMm) && residualMm <= 5
        && Number.isFinite(material) && material <= 0.02
        && bodySafe
        && surroundsBodyCenter
        ? "passed"
        : "failed";
''',
    '''      status = applied
        && Number.isFinite(residualMm) && residualMm <= 5
        && Number.isFinite(material) && material <= 0.02
        && surroundsBodyCenter
        && diagnostics?.bodyContactDeferredToPhysics === true
        ? "passed"
        : "failed";
''',
    "browser wrap acceptance",
)

audit_path.write_text(audit, encoding="utf-8")


# ---------------------------------------------------------------------------
# Canonical handoff note.
# ---------------------------------------------------------------------------
doc_path = ROOT / "docs/modifications-11.0.8.md"
doc = doc_path.read_text(encoding="utf-8")
append = '''\n\n---\n\n## STEP-0 contract correction — preassembly, not body fitting\n\nManual browser validation exposed a conceptual error in the previous STEP-0: it treated the mannequin circumference as a target and attempted to fit/shrink-wrap the sewn garment to the body before physics. That is not the Moldeon contract.\n\nThe corrected contract is:\n\n`2D pattern -> sewing assembly -> closed sewn volume -> approximate body-centered placement -> Provar/XPBD resolves gravity, collision, ease and drape.`\n\nConsequences:\n\n- the body is a placement reference/obstacle, not a geometric fit target in Montar;\n- STEP-0 never requires the garment circumference to match a body circumference;\n- oversized garments keep their authored ease instead of being vacuum-packed to the avatar;\n- undersized loops are still sewn/assembled rather than rejected by a body-circumference preflight;\n- one rigid transform is applied to the entire connected sewing component, regardless of whether it contains 1, 2, 4, 8 or more PanelInstances;\n- the sewn component is centered on the body axis at the authored vertical level;\n- exact body contact/clearance and final fitting are deferred to Provar/XPBD;\n- no second local body-aware sewing solve runs after the global sewn shape, so it cannot undo seam closure or introduce material stretch;\n- seam closure and canonical material preservation remain STEP-0 acceptance gates.\n\nThe key invariant is now: **Montar assembles the garment; Provar dresses it.**\n'''
if "## STEP-0 contract correction — preassembly, not body fitting" not in doc:
    doc += append
    doc_path.write_text(doc, encoding="utf-8")

print("Applied corrected STEP-0 preassembly contract.")
