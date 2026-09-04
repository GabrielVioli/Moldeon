from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


helper = r'''import * as THREE from "three";
import type { AssemblyStitchConstraint, GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import type { GarmentAssemblyMeshData } from "../garment3d/GarmentThreeBridge";
import { connectedSewingInstanceIds } from "./SewingInteraction";

export type SewingStep0Status =
  | "applied"
  | "no-seams"
  | "needs-placement"
  | "too-far"
  | "stale"
  | "failed";

export interface SewingStep0RunResult {
  status: SewingStep0Status;
  affectedPanels: number;
  conformedPanels?: number;
  maximumCentroidDisplacementMm?: number;
  metricDistortionMax?: number;
  seamResidualMaxMm?: number;
  warning?: string;
}

export interface SewingStep0Target {
  rootInstanceId: string;
  instanceIds: string[];
}

export interface SewingStep0Registration {
  rotation: THREE.Quaternion;
  solvedRootCentroid: THREE.Vector3;
  currentRootCentroid: THREE.Vector3;
}

export function resolveSewingStep0Target(
  constraints: readonly Pick<AssemblyStitchConstraint, "instanceA" | "instanceB" | "seamGroupId" | "seamId">[],
  selectedSeamId: string | null,
  selectedInstanceIds: readonly string[],
): SewingStep0Target | null {
  const physical = constraints.filter((constraint) =>
    Boolean(constraint.instanceA)
    && Boolean(constraint.instanceB)
    && !constraint.seamGroupId.startsWith("dart:"),
  );
  if (physical.length === 0) return null;

  let root: string | undefined;
  if (selectedSeamId) {
    const selected = physical.find((constraint) => constraint.seamId === selectedSeamId);
    if (!selected) return null;
    root = selected.instanceA;
  }
  if (!root) {
    const participating = new Set(physical.flatMap((constraint) => [constraint.instanceA!, constraint.instanceB!]));
    root = selectedInstanceIds.find((id) => participating.has(id)) ?? physical[0].instanceA;
  }
  if (!root) return null;

  const participating = new Set(physical.flatMap((constraint) => [constraint.instanceA!, constraint.instanceB!]));
  const instanceIds = connectedSewingInstanceIds(physical, root)
    .filter((id) => participating.has(id));
  if (instanceIds.length === 0) return null;
  return { rootInstanceId: root, instanceIds };
}

export function meshWorldCentroid(mesh: THREE.Mesh): THREE.Vector3 {
  const positions = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  mesh.updateMatrixWorld(true);
  const centroid = new THREE.Vector3();
  const point = new THREE.Vector3();
  if (positions.count === 0) return centroid;
  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
    centroid.add(point);
  }
  return centroid.multiplyScalar(1 / positions.count);
}

export function buildSewingStep0Registration(
  solvedRootPositions: Float32Array,
  currentRootWorldPositions: Float32Array,
  triangles: Uint16Array | Uint32Array,
): SewingStep0Registration | null {
  if (solvedRootPositions.length !== currentRootWorldPositions.length || solvedRootPositions.length < 9) return null;
  const solvedFrame = firstStableTriangleFrame(solvedRootPositions, triangles);
  const currentFrame = firstStableTriangleFrame(currentRootWorldPositions, triangles);
  if (!solvedFrame || !currentFrame) return null;

  const solvedBasis = new THREE.Matrix4().makeBasis(solvedFrame.x, solvedFrame.y, solvedFrame.z);
  const currentBasis = new THREE.Matrix4().makeBasis(currentFrame.x, currentFrame.y, currentFrame.z);
  const solvedQuaternion = new THREE.Quaternion().setFromRotationMatrix(solvedBasis);
  const currentQuaternion = new THREE.Quaternion().setFromRotationMatrix(currentBasis);
  const rotation = currentQuaternion.multiply(solvedQuaternion.invert()).normalize();
  return {
    rotation,
    solvedRootCentroid: centroidOfPositions(solvedRootPositions),
    currentRootCentroid: centroidOfPositions(currentRootWorldPositions),
  };
}

export function transformSewingStep0Point(
  point: THREE.Vector3,
  registration: SewingStep0Registration,
): THREE.Vector3 {
  return point
    .clone()
    .sub(registration.solvedRootCentroid)
    .applyQuaternion(registration.rotation)
    .add(registration.currentRootCentroid);
}

export function applySewingStep0SolvedComponent(
  currentState: GarmentAssemblyState,
  solvedState: GarmentAssemblyState,
  meshes: readonly GarmentAssemblyMeshData[],
  target: SewingStep0Target,
  maximumCentroidDisplacementM = 0.45,
): { appliedIds: string[]; maximumCentroidDisplacementM: number } | null {
  const currentRootMesh = meshes.find((item) => item.key === target.rootInstanceId);
  const solvedRoot = solvedState.instances.find((instance) => instance.id === target.rootInstanceId);
  if (!currentRootMesh || !solvedRoot) return null;
  const solvedRootPositions = sliceInstancePositions(solvedState, solvedRoot.id);
  const currentRootWorldPositions = worldPositions(currentRootMesh.mesh);
  if (!solvedRootPositions) return null;
  const registration = buildSewingStep0Registration(
    solvedRootPositions,
    currentRootWorldPositions,
    solvedRoot.topology.triangles,
  );
  if (!registration) return null;

  const pending = new Map<string, Float32Array>();
  let maximumDisplacement = 0;
  for (const id of target.instanceIds) {
    const currentInstance = currentState.instances.find((instance) => instance.id === id);
    const solvedInstance = solvedState.instances.find((instance) => instance.id === id);
    const meshData = meshes.find((item) => item.key === id);
    if (!currentInstance || !solvedInstance || !meshData) return null;
    if (currentInstance.vertexCount !== solvedInstance.vertexCount || currentInstance.vertexCount <= 0) return null;
    const solved = sliceInstancePositions(solvedState, id);
    if (!solved || solved.length !== currentInstance.vertexCount * 3) return null;

    meshData.mesh.updateMatrixWorld(true);
    const inverseCurrentWorld = meshData.mesh.matrixWorld.clone().invert();
    const local = new Float32Array(solved.length);
    const transformedWorld = new Float32Array(solved.length);
    const point = new THREE.Vector3();
    for (let offset = 0; offset < solved.length; offset += 3) {
      point.set(solved[offset], solved[offset + 1], solved[offset + 2]);
      const world = transformSewingStep0Point(point, registration);
      transformedWorld[offset] = world.x;
      transformedWorld[offset + 1] = world.y;
      transformedWorld[offset + 2] = world.z;
      world.applyMatrix4(inverseCurrentWorld);
      local[offset] = world.x;
      local[offset + 1] = world.y;
      local[offset + 2] = world.z;
    }

    const currentCentroid = meshWorldCentroid(meshData.mesh);
    const nextCentroid = centroidOfPositions(transformedWorld);
    const displacement = currentCentroid.distanceTo(nextCentroid);
    maximumDisplacement = Math.max(maximumDisplacement, displacement);
    if (!Number.isFinite(displacement) || displacement > maximumCentroidDisplacementM) return null;
    if (![...local].every(Number.isFinite)) return null;
    pending.set(id, local);
  }

  for (const [id, local] of pending) writeInstancePositions(currentState, id, local);
  return { appliedIds: [...pending.keys()], maximumCentroidDisplacementM: maximumDisplacement };
}

export function syncMeshGeometryToAssemblyState(
  state: GarmentAssemblyState,
  meshData: GarmentAssemblyMeshData,
): boolean {
  const instance = state.instances.find((candidate) => candidate.id === meshData.key);
  const position = meshData.mesh.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!instance || !position || position.count !== instance.vertexCount) return false;
  const local = new Float32Array(instance.vertexCount * 3);
  for (let index = 0; index < instance.vertexCount; index += 1) {
    local[index * 3] = position.getX(index);
    local[index * 3 + 1] = position.getY(index);
    local[index * 3 + 2] = position.getZ(index);
  }
  writeInstancePositions(state, instance.id, local);
  meshData.dressed.set(local);
  return true;
}

export function bakeWorldGeometryIntoAuthoredTransform(
  mesh: THREE.Mesh,
  originalMatrixWorld: THREE.Matrix4,
  originalPosition: THREE.Vector3,
  originalQuaternion: THREE.Quaternion,
  originalScale: THREE.Vector3,
): void {
  mesh.updateMatrixWorld(true);
  const afterMatrixWorld = mesh.matrixWorld.clone();
  const originalWorldInverse = originalMatrixWorld.clone().invert();
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index)
      .applyMatrix4(afterMatrixWorld)
      .applyMatrix4(originalWorldInverse);
    position.setXYZ(index, point.x, point.y, point.z);
  }
  position.needsUpdate = true;
  mesh.position.copy(originalPosition);
  mesh.quaternion.copy(originalQuaternion);
  mesh.scale.copy(originalScale);
  mesh.updateMatrixWorld(true);
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}

function writeInstancePositions(state: GarmentAssemblyState, instanceId: string, local: Float32Array): void {
  const instance = state.instances.find((candidate) => candidate.id === instanceId);
  if (!instance || local.length !== instance.vertexCount * 3) return;
  const start = instance.particleStart * 3;
  state.positions.set(local, start);
  state.previousPositions.set(local, start);
}

function sliceInstancePositions(state: GarmentAssemblyState, instanceId: string): Float32Array | null {
  const instance = state.instances.find((candidate) => candidate.id === instanceId);
  if (!instance) return null;
  const start = instance.particleStart * 3;
  const end = start + instance.vertexCount * 3;
  if (end > state.positions.length) return null;
  return new Float32Array(state.positions.slice(start, end));
}

function worldPositions(mesh: THREE.Mesh): Float32Array {
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  mesh.updateMatrixWorld(true);
  const result = new Float32Array(position.count * 3);
  const point = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
    result[index * 3] = point.x;
    result[index * 3 + 1] = point.y;
    result[index * 3 + 2] = point.z;
  }
  return result;
}

function centroidOfPositions(positions: Float32Array): THREE.Vector3 {
  const centroid = new THREE.Vector3();
  const count = Math.floor(positions.length / 3);
  if (count === 0) return centroid;
  for (let offset = 0; offset < count * 3; offset += 3) {
    centroid.x += positions[offset];
    centroid.y += positions[offset + 1];
    centroid.z += positions[offset + 2];
  }
  return centroid.multiplyScalar(1 / count);
}

function firstStableTriangleFrame(
  positions: Float32Array,
  triangles: Uint16Array | Uint32Array,
): { x: THREE.Vector3; y: THREE.Vector3; z: THREE.Vector3 } | null {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let offset = 0; offset + 2 < triangles.length; offset += 3) {
    readPoint(positions, triangles[offset], a);
    readPoint(positions, triangles[offset + 1], b);
    readPoint(positions, triangles[offset + 2], c);
    const x = b.clone().sub(a);
    const side = c.clone().sub(a);
    const z = new THREE.Vector3().crossVectors(x, side);
    if (x.lengthSq() <= 1e-12 || z.lengthSq() <= 1e-12) continue;
    x.normalize();
    z.normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    return { x, y, z };
  }
  return null;
}

function readPoint(positions: Float32Array, index: number, target: THREE.Vector3): void {
  const offset = index * 3;
  target.set(positions[offset], positions[offset + 1], positions[offset + 2]);
}
'''
Path("apps/web/src/viewport/SewingStep0.ts").write_text(helper, encoding="utf-8")

test = r'''import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  buildSewingStep0Registration,
  resolveSewingStep0Target,
  transformSewingStep0Point,
} from "./SewingStep0";

function constraint(instanceA: string, instanceB: string, seamId: string, seamGroupId = seamId) {
  return { instanceA, instanceB, seamId, seamGroupId };
}

describe("11.0.8 STEP-0 target and rigid registration", () => {
  it("solves only the selected active sewn component and ignores darts", () => {
    const target = resolveSewingStep0Target([
      constraint("a", "b", "seam-1"),
      constraint("b", "c", "seam-2"),
      constraint("c", "d", "dart-1", "dart:waist"),
      constraint("x", "y", "seam-3"),
    ], "seam-1", []);
    expect(target?.rootInstanceId).toBe("a");
    expect(new Set(target?.instanceIds)).toEqual(new Set(["a", "b", "c"]));
  });

  it("does not silently fall back to another relation when the selected seam is inactive/missing", () => {
    expect(resolveSewingStep0Target([
      constraint("a", "b", "seam-1"),
    ], "inactive-seam", [])).toBeNull();
  });

  it("keeps a valid self-sewn physical panel as a one-panel STEP-0 target", () => {
    const target = resolveSewingStep0Target([
      constraint("tube", "tube", "self-seam"),
    ], "self-seam", []);
    expect(target).toEqual({ rootInstanceId: "tube", instanceIds: ["tube"] });
  });

  it("registers solver coordinates onto the authored root frame with rotation only", () => {
    const solved = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]);
    const current = new Float32Array([
      10, 20, 30,
      10, 21, 30,
      9, 20, 30,
    ]);
    const triangles = new Uint32Array([0, 1, 2]);
    const registration = buildSewingStep0Registration(solved, current, triangles);
    expect(registration).not.toBeNull();
    const mappedA = transformSewingStep0Point(new THREE.Vector3(0, 0, 0), registration!);
    const mappedB = transformSewingStep0Point(new THREE.Vector3(1, 0, 0), registration!);
    expect(mappedA.distanceTo(mappedB)).toBeCloseTo(1, 8);
    expect(registration!.solvedRootCentroid.clone()
      .applyQuaternion(registration!.rotation)
      .sub(registration!.solvedRootCentroid.clone().applyQuaternion(registration!.rotation))
      .length()).toBeCloseTo(0, 8);
    const mappedCentroid = transformSewingStep0Point(registration!.solvedRootCentroid, registration!);
    expect(mappedCentroid.distanceTo(registration!.currentRootCentroid)).toBeLessThan(1e-8);
  });
});
'''
Path("apps/web/src/viewport/SewingStep0.test.ts").write_text(test, encoding="utf-8")

replace_once(
    "apps/web/src/garment3d/AssemblyWorkerProtocol.ts",
    '  mode?: "workspace" | "simulation";',
    '  mode?: "workspace" | "step0" | "simulation";',
)
replace_once(
    "apps/web/src/garment3d/AssemblyWorkerClient.ts",
    '  mode?: "workspace" | "simulation";',
    '  mode?: "workspace" | "step0" | "simulation";',
)

client_test_path = Path("apps/web/src/garment3d/AssemblyWorkerClient.test.ts")
client_test = client_test_path.read_text(encoding="utf-8")
anchor = '''  it("ignores stale generation/revision responses", async () => {'''
step0_case = '''  it("forwards explicit geometric STEP-0 mode without touching XPBD", async () => {\n    const worker = new FakeWorker();\n    const client = new AssemblyWorkerClient(() => worker);\n    const document = garmentDraftToPatternDocumentV3(createBlankGarment());\n    const pending = client.solve({ document, revision: "step0", mode: "step0" });\n    const request = worker.requests[0];\n    expect(request.type).toBe("solve");\n    if (request.type !== "solve") throw new Error("solve request expected");\n    expect(request.mode).toBe("step0");\n    worker.emit({\n      type: "solved", generation: request.generation, revision: "step0",\n      state: emptyState(), diagnostics: emptyDiagnostics(), warnings: [],\n    });\n    await expect(pending).resolves.toMatchObject({ revision: "step0" });\n    client.dispose();\n  });\n\n'''
if anchor not in client_test:
    raise SystemExit("AssemblyWorkerClient.test anchor missing")
client_test_path.write_text(client_test.replace(anchor, step0_case + anchor, 1), encoding="utf-8")

global_path = "apps/web/src/viewport/GlobalThreeViewport.ts"
replace_once(
    global_path,
    'import { connectedSewingInstanceIds } from "./SewingInteraction";\n',
    'import { connectedSewingInstanceIds } from "./SewingInteraction";\nimport {\n  applySewingStep0SolvedComponent,\n  bakeWorldGeometryIntoAuthoredTransform,\n  meshWorldCentroid,\n  resolveSewingStep0Target,\n  syncMeshGeometryToAssemblyState,\n  type SewingStep0RunResult,\n} from "./SewingStep0";\n',
)

step0_method = r'''  async runSewingStep0(
    selectedSeamId: string | null = this.sewingState.selectedSeamId,
  ): Promise<SewingStep0RunResult> {
    const input = this.currentInput;
    const state = this.assemblyState;
    const avatar = this.currentAvatarModel;
    if (this.viewportMode !== "assembly" || !input || !state || !avatar) {
      return { status: "failed", affectedPanels: 0, warning: "Montagem 3D ainda não está pronta." };
    }
    const target = resolveSewingStep0Target(
      state.stitchConstraints,
      selectedSeamId,
      [...this.selectedInstanceIds],
    );
    if (!target) return { status: "no-seams", affectedPanels: 0 };

    const targetIds = new Set(target.instanceIds);
    const missingPlacement = input.panelInstances.some((instance) =>
      targetIds.has(instance.id)
      && (instance.placementStatus !== "confirmed" || !instance.arrangementAnchor),
    );
    if (missingPlacement) {
      return { status: "needs-placement", affectedPanels: target.instanceIds.length };
    }

    const body = avatar.humanBody.visualMesh;
    prepareBodySurfaceQuery(body);
    for (const instanceId of target.instanceIds) {
      const item = this.garmentMeshes.find((candidate) => candidate.key === instanceId);
      if (!item) return { status: "failed", affectedPanels: target.instanceIds.length };
      const centroid = meshWorldCentroid(item.mesh);
      if (!closestBodySurfacePoint(body, [centroid.x, centroid.y, centroid.z], 12, 0.36)) {
        return { status: "too-far", affectedPanels: target.instanceIds.length };
      }
    }

    // STEP-0 is geometric authoring only. Keeping the XPBD worker paused is an
    // explicit contract, not an implementation detail.
    this.simulation.pause();
    const geometryRevision = input.geometryRevision;
    const sewingRevision = input.sewingRevision;
    const arrangementRevision = input.arrangementRevision;
    const revision = `step0:${geometryRevision}:${sewingRevision}:${arrangementRevision}:${performance.now().toFixed(3)}`;
    const startedAt = performance.now();
    this.host.dataset.sewingStep0Status = "solving";
    this.host.dataset.sewingStep0Target = JSON.stringify(target.instanceIds);

    try {
      const response = await this.assembly.solve({
        document: input.assemblyDocument,
        revision,
        mode: "step0",
      });
      const current = this.currentInput;
      if (!current
        || current.geometryRevision !== geometryRevision
        || current.sewingRevision !== sewingRevision
        || current.arrangementRevision !== arrangementRevision
        || this.viewportMode !== "assembly") {
        this.host.dataset.sewingStep0Status = "stale";
        return { status: "stale", affectedPanels: target.instanceIds.length };
      }
      if (response.state.invalid || response.diagnostics.assembly.invalid) {
        this.host.dataset.sewingStep0Status = "failed";
        return {
          status: "failed",
          affectedPanels: target.instanceIds.length,
          warning: response.diagnostics.assembly.warnings[0] ?? response.warnings[0],
        };
      }

      const applied = applySewingStep0SolvedComponent(
        state,
        response.state,
        this.garmentMeshes,
        target,
        0.45,
      );
      if (!applied) {
        this.host.dataset.sewingStep0Status = "rejected-placement";
        return {
          status: "failed",
          affectedPanels: target.instanceIds.length,
          warning: "A solução geométrica exigiria deslocar demais o placement manual.",
        };
      }

      for (const instanceId of applied.appliedIds) {
        const item = this.garmentMeshes.find((candidate) => candidate.key === instanceId);
        if (item) refreshMeshFromAssembly(item, state);
      }

      let conformedPanels = 0;
      const bodyAudits: Record<string, unknown> = {};
      for (const instanceId of applied.appliedIds) {
        const item = this.garmentMeshes.find((candidate) => candidate.key === instanceId);
        if (!item) continue;
        const centroid = meshWorldCentroid(item.mesh);
        const surface = closestBodySurfacePoint(body, [centroid.x, centroid.y, centroid.z], 12, 0.28);
        if (!surface) {
          bodyAudits[instanceId] = { conformed: false, reason: "surface-too-far-after-seam-solve" };
          continue;
        }

        item.mesh.updateMatrixWorld(true);
        const originalMatrixWorld = item.mesh.matrixWorld.clone();
        const originalPosition = item.mesh.position.clone();
        const originalQuaternion = item.mesh.quaternion.clone();
        const originalScale = item.mesh.scale.clone();
        const conform = adjustMeshToBodySurface(item.mesh, body, surface.attachment, undefined, {
          clearanceMm: Math.max(12, surface.attachment.normalOffsetMm),
          captureDistanceMm: 220,
          maximumVertexProjectionDistanceMm: 160,
          maximumMetricDistortion: 0.08,
          minimumProjectedVertexRatio: 0.25,
        });
        if (conform.conformed) {
          // Adjust is allowed a small normal translation. Bake that visible
          // result into geometry so the persisted/manual object transform
          // remains the placement authority for STEP-0.
          bakeWorldGeometryIntoAuthoredTransform(
            item.mesh,
            originalMatrixWorld,
            originalPosition,
            originalQuaternion,
            originalScale,
          );
          syncMeshGeometryToAssemblyState(state, item);
          conformedPanels += 1;
        }
        bodyAudits[instanceId] = {
          ...conform,
          clearance: auditMeshBodyClearance(item.mesh, body, 1, 96),
        };
      }

      const intrinsic = measureIntrinsicDistortion(state);
      this.refreshSewingOverlay();
      this.host.dataset.sewingStep0Status = "applied";
      this.host.dataset.sewingStep0Ms = (performance.now() - startedAt).toFixed(2);
      this.host.dataset.sewingStep0Diagnostics = JSON.stringify({
        affectedPanels: applied.appliedIds.length,
        conformedPanels,
        maximumCentroidDisplacementMm: applied.maximumCentroidDisplacementM * 1_000,
        metricDistortionMax: intrinsic.maxRelativeDistortion,
        assembly: response.diagnostics.assembly.metrics,
        bodyAudits,
      });
      this.host.dataset.simulationStatus = "disabled-in-montar";
      this.requestRender();
      return {
        status: "applied",
        affectedPanels: applied.appliedIds.length,
        conformedPanels,
        maximumCentroidDisplacementMm: applied.maximumCentroidDisplacementM * 1_000,
        metricDistortionMax: intrinsic.maxRelativeDistortion,
        seamResidualMaxMm: response.diagnostics.assembly.metrics.structuralSeamMaxMm,
        warning: response.warnings[0],
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        this.host.dataset.sewingStep0Status = "stale";
        return { status: "stale", affectedPanels: target.instanceIds.length };
      }
      console.error("STEP-0 geométrico:", error);
      this.host.dataset.sewingStep0Status = "failed";
      return {
        status: "failed",
        affectedPanels: target.instanceIds.length,
        warning: error instanceof Error ? error.message : "Falha no STEP-0 geométrico.",
      };
    }
  }

'''
replace_once(global_path, '  rotateArrangementSelection(axis: Exclude<ArrangementAxis, "free">, deltaDeg: number): void {', step0_method + '  rotateArrangementSelection(axis: Exclude<ArrangementAxis, "free">, deltaDeg: number): void {')

viewport_path = "apps/web/src/viewport/GarmentViewport.tsx"
replace_once(
    viewport_path,
    '  const [touchMultiSelect, setTouchMultiSelect] = useState(false);\n  const [showSewingConnections, setShowSewingConnections] = useState(() => {',
    '  const [touchMultiSelect, setTouchMultiSelect] = useState(false);\n  const [sewingStep0Running, setSewingStep0Running] = useState(false);\n  const [sewingStep0Notice, setSewingStep0Notice] = useState<string | null>(null);\n  const [showSewingConnections, setShowSewingConnections] = useState(() => {',
)

old_visibility = '''      {displayMode === "side-preview" ? (\n        <button\n          type="button"\n          className="viewport-sewing-visibility"\n          aria-pressed={showSewingConnections}\n          onClick={() => setShowSewingConnections((visible) => !visible)}\n        >\n          {showSewingConnections ? "Ocultar conexões" : "Mostrar conexões"}\n        </button>\n      ) : null}\n'''
new_visibility = '''      {displayMode === "side-preview" ? (\n        <>\n          <button\n            type="button"\n            className="viewport-sewing-visibility"\n            aria-pressed={showSewingConnections}\n            onClick={() => setShowSewingConnections((visible) => !visible)}\n          >\n            {showSewingConnections ? "Ocultar conexões" : "Mostrar conexões"}\n          </button>\n          <button\n            type="button"\n            className="viewport-sewing-step0"\n            disabled={sewingStep0Running}\n            title="Aproxima e curva geometricamente o componente costurado. Não inicia física."\n            onClick={async () => {\n              const viewport = viewportRef.current;\n              if (!viewport || sewingStep0Running) return;\n              setSewingStep0Running(true);\n              setSewingStep0Notice("Calculando montagem geométrica…");\n              const result = await viewport.runSewingStep0(selectedSeamId);\n              setSewingStep0Running(false);\n              if (result.status === "applied") {\n                setSewingStep0Notice(`STEP-0 aplicado em ${result.affectedPanels} painel(is). Física continua desligada.`);\n              } else if (result.status === "too-far") {\n                setSewingStep0Notice("Aproxime os painéis do corpo antes de ajustar a montagem.");\n              } else if (result.status === "needs-placement") {\n                setSewingStep0Notice("Posicione os painéis no 3D antes de ajustar a montagem.");\n              } else if (result.status === "no-seams") {\n                setSewingStep0Notice("Selecione ou crie uma costura ativa para montar.");\n              } else if (result.status === "stale") {\n                setSewingStep0Notice("A montagem mudou durante o cálculo. Rode o STEP-0 novamente.");\n              } else {\n                setSewingStep0Notice(result.warning ?? "Não foi possível montar sem violar o placement atual.");\n              }\n            }}\n          >\n            {sewingStep0Running ? "Ajustando…" : "Ajustar montagem"}\n          </button>\n          {sewingStep0Notice ? (\n            <div className="viewport-sewing-step0-status" role="status">{sewingStep0Notice}</div>\n          ) : null}\n        </>\n      ) : null}\n'''
replace_once(viewport_path, old_visibility, new_visibility)

styles = Path("apps/web/src/styles.css")
styles.write_text(styles.read_text(encoding="utf-8") + r'''

/* 11.0.8 Phase J: explicit geometric STEP-0 gate. */
.viewport-sewing-step0 {
  position: absolute;
  z-index: 9;
  top: 52px;
  right: 10px;
  min-height: 36px;
  padding: 7px 10px;
  border: 1px solid rgba(78, 96, 84, .48);
  border-radius: 9px;
  background: rgba(244, 249, 244, .94);
  box-shadow: 0 3px 12px rgba(24, 34, 28, .08);
  color: #263a2d;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}
.viewport-sewing-step0:disabled { opacity: .62; cursor: progress; }
.viewport-sewing-step0-status {
  position: absolute;
  z-index: 9;
  top: 94px;
  right: 10px;
  max-width: min(290px, calc(100% - 20px));
  padding: 7px 9px;
  border: 1px solid rgba(78, 96, 84, .28);
  border-radius: 8px;
  background: rgba(250, 249, 246, .94);
  color: #4d514c;
  font-size: 10px;
  line-height: 1.3;
  pointer-events: none;
}
@media (max-width: 760px), (pointer: coarse) {
  .viewport-sewing-step0 {
    top: calc(58px + env(safe-area-inset-top));
    right: calc(8px + env(safe-area-inset-right));
    min-height: 44px;
  }
  .viewport-sewing-step0-status {
    top: calc(108px + env(safe-area-inset-top));
    right: calc(8px + env(safe-area-inset-right));
    font-size: 10px;
  }
}
''', encoding="utf-8")

docs = Path("docs/modifications-11.0.8.md")
docs.write_text(docs.read_text(encoding="utf-8") + r'''

---

## Fase J — STEP-0 geométrico para gate manual

Foi adicionada uma ação **Ajustar montagem** no viewport 3D. Ela é deliberadamente explícita: não roda automaticamente ao confirmar uma seam e não liga XPBD.

Fluxo:

1. resolve o `connected component` físico a partir dos stitch constraints ativos (darts não conectam painéis);
2. exige `PanelInstanceV3` com placement manual/confirmado;
3. recusa componentes cujo painel esteja longe demais do `HumanBodyModel.visualMesh`;
4. usa o Assembly Worker em modo `step0`, que chama o solver geométrico coarse/isometric já existente e separado de XPBD;
5. registra rigidamente a solução do solver no frame mundial do painel-raiz atual, sem escala, mantendo o placement manual como autoridade;
6. aplica somente os painéis do componente alvo ao workspace atual;
7. executa conform corporal local e limitado usando `adjustMeshToBodySurface`, sem restaurar o molde flat e sem gravar deformação em `PatternDefinitionV3`;
8. qualquer pequena translação normal feita pelo conform é baked na geometria runtime, preservando o transform rígido authored do painel;
9. atualiza threads/notches a partir da mesma relação canônica e mantém `simulationStatus=disabled-in-montar`.

Guard rails:

- nenhum arquivo em `physics/**` é alterado;
- `step0` usa Assembly Worker, não `XpbdWorkerClient`;
- sem gravidade, velocidade, timestep ou auto-dress;
- sem inferência por nome/template/role;
- sem autoscale;
- selected seam tem prioridade; se ela estiver inativa/sem constraint física, não há fallback silencioso para outra seam;
- resultado é rejeitado se exigir deslocamento de centroide > 450 mm em relação ao placement manual;
- mudanças de geometry/sewing/arrangement durante o solve invalidam o resultado como stale;
- painel longe do corpo é recusado antes do solve.

### Gate manual J1/J2

1. Camiseta frente/costas próximas ao torso: costurar laterais/ombros e clicar `Ajustar montagem`.
2. Verificar que bordas costuradas se aproximam e os painéis começam a formar um volume sem simulação.
3. Frente continua na frente e costas continuam atrás; nenhuma peça atravessa o corpo para buscar caminho curto.
4. Escala permanece 1 e o molde não encolhe para fechar seam.
5. Saia/calça: laterais devem aproximar ao redor do quadril/pernas mantendo placement.
6. Componente desconectado fica imóvel.
7. Peça deliberadamente longe do corpo retorna `Aproxime os painéis do corpo antes de ajustar a montagem.`
8. Repetir STEP-0 deve permanecer estável, sem segundo salto grande.
9. Depois do STEP-0, mover/girar manualmente ainda funciona e as threads acompanham.
10. Durante todo o gate, física/XPBD permanece OFF em Montar/Costurar.

Não avançar para 11.0.9 antes deste gate humano.
''', encoding="utf-8")

print("Applied 11.0.8 geometric STEP-0 gate")
