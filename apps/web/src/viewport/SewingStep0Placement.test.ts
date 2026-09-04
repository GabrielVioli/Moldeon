import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import type { GarmentAssemblyMeshData } from "../garment3d/GarmentThreeBridge";
import type { HumanBodyMesh } from "../avatar/HumanBodyModel";
import {
  auditSewingStep0Seams,
  measureCurrentSewingStep0Residual,
  measureCurrentSewingStep0MaterialDistortion,
  solvePlacementAnchoredSewingStep0,
  type SewingStep0Target,
} from "./SewingStep0";

function boxBody(): HumanBodyMesh {
  const geometry = new THREE.BoxGeometry(0.18, 0.5, 0.1);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const index = geometry.getIndex();
  return {
    positions: new Float32Array(Array.from(position.array as Float32Array, (value, index) => (
      index % 3 === 1 ? value + 1 : value
    ))),
    normals: new Float32Array(normal.array as Float32Array),
    indices: index ? new Uint32Array(index.array) : Uint32Array.from({ length: position.count }, (_, value) => value),
    regionIds: Array.from({ length: position.count }, () => "pelvis-front"),
    bounds: { min: [-0.09, 0.75, -0.05], max: [0.09, 1.25, 0.05] },
    topologySignature: "step0-box-body",
    sourceAssetId: "canonical-female.glb",
  };
}

function quadGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -0.05, -0.1, 0,
     0.05, -0.1, 0,
     0.05,  0.1, 0,
    -0.05,  0.1, 0,
  ]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

function meshData(key: string, x: number, z: number): GarmentAssemblyMeshData {
  const mesh = new THREE.Mesh(quadGeometry(), new THREE.MeshBasicMaterial());
  mesh.position.set(x, 1, z);
  mesh.updateMatrixWorld(true);
  return {
    key,
    mesh,
    flat: new Float32Array(mesh.geometry.getAttribute("position").array as Float32Array),
    dressed: new Float32Array(mesh.geometry.getAttribute("position").array as Float32Array),
  } as unknown as GarmentAssemblyMeshData;
}

function state(): GarmentAssemblyState {
  const structural = [
    [0, 1, 0.1], [1, 2, 0.2], [2, 3, 0.1], [3, 0, 0.2], [0, 2, Math.hypot(0.1, 0.2)],
    [4, 5, 0.1], [5, 6, 0.2], [6, 7, 0.1], [7, 4, 0.2], [4, 6, Math.hypot(0.1, 0.2)],
  ].map(([a, b, restLength]) => ({ a, b, restLength, stiffness: 1 }));
  const seam = (id: string, a: number, b: number) => ({
    id,
    seamId: id,
    seamGroupId: id,
    treatment: "plain",
    distribution: "uniform" as const,
    targetRatio: 1,
    slackMm: 0,
    a: { particleIndices: [a], weights: [1] },
    b: { particleIndices: [b], weights: [1] },
    restDistance: 0,
    physicalRestDistance: 0,
    stiffness: 1,
    instanceA: "front",
    instanceB: "back",
  });
  return {
    positions: new Float32Array(8 * 3),
    initialPositions: new Float32Array(8 * 3),
    previousPositions: new Float32Array(8 * 3),
    inverseMasses: new Float32Array(8),
    instances: [
      { id: "front", particleStart: 0, vertexCount: 4, topology: {} },
      { id: "back", particleStart: 4, vertexCount: 4, topology: {} },
    ] as GarmentAssemblyState["instances"],
    structuralConstraints: structural,
    stitchConstraints: [seam("low", 1, 4), seam("high", 2, 7)],
    anchorConstraints: [],
    warnings: [],
    invalid: false,
  };
}

function applyProposal(
  meshes: GarmentAssemblyMeshData[],
  positionsByInstanceId: Map<string, Float32Array>,
): void {
  for (const item of meshes) {
    const positions = positionsByInstanceId.get(item.key);
    if (!positions) continue;
    const attribute = item.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    (attribute.array as Float32Array).set(positions);
    attribute.needsUpdate = true;
  }
}

const target: SewingStep0Target = { rootInstanceId: "front", instanceIds: ["front", "back"] };

describe("placement-anchored STEP-0", () => {
  it("improves sewn boundaries without replacing either manually authored transform", () => {
    const assembly = state();
    const front = meshData("front", -0.07, 0.11);
    const back = meshData("back", 0.07, -0.11);
    const meshes = [front, back];
    const frontPosition = front.mesh.position.clone();
    const backPosition = back.mesh.position.clone();
    const before = measureCurrentSewingStep0Residual(assembly, meshes, target)!;
    const proposal = solvePlacementAnchoredSewingStep0(assembly, meshes, target, {
      iterations: 72,
      maximumVertexDisplacementM: 0.065,
      maximumCentroidDisplacementM: 0.018,
    });

    expect(proposal).not.toBeNull();
    expect(proposal!.afterResidual.meanM).toBeLessThan(before.meanM);
    expect(auditSewingStep0Seams(proposal!.beforeResidual, proposal!.afterResidual).accepted).toBe(true);
    expect(proposal!.maximumCentroidDisplacementM).toBeLessThanOrEqual(0.018001);
    expect(proposal!.maximumVertexDisplacementM).toBeLessThanOrEqual(0.065001);
    expect(proposal!.metricDistortionMax).toBeLessThan(0.025);
    expect(front.mesh.position.toArray()).toEqual(frontPosition.toArray());
    expect(back.mesh.position.toArray()).toEqual(backPosition.toArray());
    expect(front.mesh.position.z).toBeGreaterThan(0);
    expect(back.mesh.position.z).toBeLessThan(0);
  });

  it("closes a same-panel relation locally instead of requiring a second placement system", () => {
    const assembly = state();
    assembly.instances = [assembly.instances[0]];
    assembly.structuralConstraints = assembly.structuralConstraints.slice(0, 5);
    assembly.stitchConstraints = [{
      ...assembly.stitchConstraints[0],
      seamId: "strap-loop",
      seamGroupId: "strap-loop",
      instanceA: "front",
      instanceB: "front",
      a: { particleIndices: [0], weights: [1] },
      b: { particleIndices: [1], weights: [1] },
    }];
    const front = meshData("front", 0, 0.12);
    const selfTarget: SewingStep0Target = { rootInstanceId: "front", instanceIds: ["front"] };
    const before = measureCurrentSewingStep0Residual(assembly, [front], selfTarget)!;
    const proposal = solvePlacementAnchoredSewingStep0(assembly, [front], selfTarget, { iterations: 72 });
    expect(proposal).not.toBeNull();
    expect(proposal!.afterResidual.meanM).toBeLessThan(before.meanM);
    expect(front.mesh.position.z).toBeCloseTo(0.12, 8);
  });

  it("keeps front/back material on its authored body hemisphere while seams converge", () => {
    const assembly = state();
    const front = meshData("front", -0.07, 0.08);
    const back = meshData("back", 0.07, -0.08);
    const proposal = solvePlacementAnchoredSewingStep0(assembly, [front, back], target, {
      iterations: 72,
      body: boxBody(),
      bodyClearanceM: 0.006,
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.afterResidual.meanM).toBeLessThan(proposal!.beforeResidual.meanM);
    expect(proposal!.minimumBodyClearanceM).not.toBeNull();
    expect(proposal!.minimumBodyClearanceM!).toBeGreaterThan(-0.001);
    const frontLocal = proposal!.positionsByInstanceId.get("front")!;
    const backLocal = proposal!.positionsByInstanceId.get("back")!;
    expect(Math.min(...[2, 5, 8, 11].map((offset) => frontLocal[offset] + front.mesh.position.z))).toBeGreaterThan(0.049);
    expect(Math.max(...[2, 5, 8, 11].map((offset) => backLocal[offset] + back.mesh.position.z))).toBeLessThan(-0.049);
  });

  it("is deterministic and does not mutate the authored meshes while proposing", () => {
    const assembly = state();
    const meshes = [meshData("front", -0.07, 0.11), meshData("back", 0.07, -0.11)];
    const original = meshes.map((item) => new Float32Array(
      (item.mesh.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array,
    ));
    const first = solvePlacementAnchoredSewingStep0(assembly, meshes, target, { iterations: 72 });
    const second = solvePlacementAnchoredSewingStep0(assembly, meshes, target, { iterations: 72 });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    for (const id of target.instanceIds) {
      expect([...first!.positionsByInstanceId.get(id)!]).toEqual([...second!.positionsByInstanceId.get(id)!]);
    }
    meshes.forEach((item, index) => {
      expect([...(item.mesh.geometry.getAttribute("position") as THREE.BufferAttribute).array]).toEqual([...original[index]]);
    });
  });

  it("does not accumulate material-metric creep across repeated STEP-0 runs", () => {
    const assembly = state();
    const meshes = [meshData("front", -0.07, 0.11), meshData("back", 0.07, -0.11)];
    const first = solvePlacementAnchoredSewingStep0(assembly, meshes, target, { iterations: 72 })!;
    applyProposal(meshes, first.positionsByInstanceId);
    const firstMetric = measureCurrentSewingStep0MaterialDistortion(assembly, meshes, target)!;
    const firstResidual = measureCurrentSewingStep0Residual(assembly, meshes, target)!;
    const second = solvePlacementAnchoredSewingStep0(assembly, meshes, target, { iterations: 72 })!;
    applyProposal(meshes, second.positionsByInstanceId);
    const secondMetric = measureCurrentSewingStep0MaterialDistortion(assembly, meshes, target)!;
    const secondResidual = measureCurrentSewingStep0Residual(assembly, meshes, target)!;
    expect(secondMetric).toBeLessThanOrEqual(Math.max(0.0005, firstMetric + 0.0001));
    expect(secondResidual.meanM).toBeLessThanOrEqual(firstResidual.meanM + 0.0001);
  });

  it("rejects an average improvement that hides a regressed SeamGroup", () => {
    const before = {
      maximumM: 0.03,
      meanM: 0.02,
      evaluated: 2,
      bySeam: {
        waist: { maximumM: 0.01, meanM: 0.01, evaluated: 1 },
        side: { maximumM: 0.03, meanM: 0.03, evaluated: 1 },
      },
    };
    const after = {
      maximumM: 0.012,
      meanM: 0.0065,
      evaluated: 2,
      bySeam: {
        waist: { maximumM: 0.012, meanM: 0.012, evaluated: 1 },
        side: { maximumM: 0.001, meanM: 0.001, evaluated: 1 },
      },
    };
    const audit = auditSewingStep0Seams(before, after);
    expect(audit.accepted).toBe(false);
    expect(audit.worsenedSeamIds).toContain("waist");
  });
});
