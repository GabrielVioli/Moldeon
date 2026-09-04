import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import type { GarmentAssemblyMeshData } from "../garment3d/GarmentThreeBridge";
import type { HumanBodyMesh } from "../avatar/HumanBodyModel";
import { createBlankGarment } from "../domain/blankGarment";
import { createDefaultFabricSource } from "../domain/fabric";
import { getPatternEdges, type PatternPiece } from "../domain/pattern";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { buildResolvedGarmentAssembly } from "../garment3d/ResolvedGarmentAssembly";
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

function cylinderBody(radiusM = 0.05): HumanBodyMesh {
  const geometry = new THREE.CylinderGeometry(radiusM, radiusM, 0.5, 48, 4, false);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const index = geometry.getIndex()!;
  return {
    positions: new Float32Array(Array.from(position.array as Float32Array, (value, offset) => (
      offset % 3 === 1 ? value + 1 : value
    ))),
    normals: new Float32Array(normal.array as Float32Array),
    indices: new Uint32Array(index.array),
    regionIds: Array.from({ length: position.count }, () => "pelvis-front"),
    bounds: { min: [-radiusM, 0.75, -radiusM], max: [radiusM, 1.25, radiusM] },
    topologySignature: "step0-cylinder-body",
    sourceAssetId: "canonical-female.glb",
  };
}

function selfSeamedGrid(): { state: GarmentAssemblyState; mesh: GarmentAssemblyMeshData; target: SewingStep0Target } {
  const columns = 24;
  const rows = 4;
  const width = 0.4;
  const height = 0.2;
  const positions: number[] = [];
  const triangles: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      positions.push((column / columns - 0.5) * width, (row / rows - 0.5) * height, 0);
    }
  }
  const vertex = (column: number, row: number) => row * (columns + 1) + column;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = vertex(column, row);
      const b = vertex(column + 1, row);
      const c = vertex(column + 1, row + 1);
      const d = vertex(column, row + 1);
      triangles.push(a, b, c, a, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(triangles);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.set(0, 1, 0.07);
  mesh.updateMatrixWorld(true);
  const structural = new Map<string, { a: number; b: number; restLength: number; stiffness: number }>();
  for (let offset = 0; offset + 2 < triangles.length; offset += 3) {
    const ids = [triangles[offset], triangles[offset + 1], triangles[offset + 2]];
    for (const [a, b] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const key = `${low}:${high}`;
      if (structural.has(key)) continue;
      const ax = positions[low * 3];
      const ay = positions[low * 3 + 1];
      const bx = positions[high * 3];
      const by = positions[high * 3 + 1];
      structural.set(key, { a: low, b: high, restLength: Math.hypot(bx - ax, by - ay), stiffness: 1 });
    }
  }
  const stitches = Array.from({ length: rows + 1 }, (_, row) => ({
    id: `tube:${row}`,
    seamId: "tube",
    seamGroupId: "tube",
    treatment: "plain",
    distribution: "uniform" as const,
    targetRatio: 1,
    slackMm: 0,
    a: { particleIndices: [vertex(0, row)], weights: [1] },
    b: { particleIndices: [vertex(columns, row)], weights: [1] },
    restDistance: 0,
    physicalRestDistance: 0,
    stiffness: 1,
    instanceA: "tube-panel",
    instanceB: "tube-panel",
    progress: row / rows,
  }));
  const assembly = {
    positions: new Float32Array(positions.length),
    initialPositions: new Float32Array(positions.length),
    previousPositions: new Float32Array(positions.length),
    inverseMasses: new Float32Array(positions.length / 3),
    instances: [{
      id: "tube-panel",
      particleStart: 0,
      vertexCount: positions.length / 3,
      topology: { triangles: Uint32Array.from(triangles) },
    }],
    structuralConstraints: [...structural.values()],
    stitchConstraints: stitches,
    anchorConstraints: [],
    warnings: [],
    invalid: false,
  } as unknown as GarmentAssemblyState;
  return {
    state: assembly,
    mesh: {
      key: "tube-panel",
      mesh,
      flat: new Float32Array(positions),
      dressed: new Float32Array(positions),
    } as unknown as GarmentAssemblyMeshData,
    target: { rootInstanceId: "tube-panel", instanceIds: ["tube-panel"] },
  };
}

function twoPanelCycle(): {
  state: GarmentAssemblyState;
  meshes: GarmentAssemblyMeshData[];
  target: SewingStep0Target;
} {
  const source = selfSeamedGrid();
  const sourcePositions = source.mesh.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const local = new Float32Array(sourcePositions.array as Float32Array);
  for (let index = 0; index < local.length; index += 3) local[index] *= 0.5;
  const triangles = source.mesh.mesh.geometry.getIndex()!.array;
  const count = sourcePositions.count;
  const makeMesh = (key: string, z: number) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(local), 3));
    geometry.setIndex(Array.from(triangles));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.position.set(0, 1, z);
    mesh.updateMatrixWorld(true);
    return { key, mesh, flat: new Float32Array(local), dressed: new Float32Array(local) } as unknown as GarmentAssemblyMeshData;
  };
  const front = makeMesh("front-cycle", 0.07);
  const back = makeMesh("back-cycle", -0.07);
  const structural: GarmentAssemblyState["structuralConstraints"] = [];
  for (const offset of [0, count]) {
    for (const edge of source.state.structuralConstraints) {
      const ax = local[edge.a * 3];
      const ay = local[edge.a * 3 + 1];
      const bx = local[edge.b * 3];
      const by = local[edge.b * 3 + 1];
      structural.push({ a: edge.a + offset, b: edge.b + offset, restLength: Math.hypot(bx - ax, by - ay), stiffness: 1 });
    }
  }
  const columns = 24;
  const rows = 4;
  const vertex = (column: number, row: number) => row * (columns + 1) + column;
  const stitch = (seamId: string, row: number, a: number, b: number) => ({
    id: `${seamId}:${row}`,
    seamId,
    seamGroupId: seamId,
    treatment: "plain",
    distribution: "uniform" as const,
    targetRatio: 1,
    slackMm: 0,
    a: { particleIndices: [a], weights: [1] },
    b: { particleIndices: [count + b], weights: [1] },
    restDistance: 0,
    physicalRestDistance: 0,
    stiffness: 1,
    instanceA: "front-cycle",
    instanceB: "back-cycle",
    progress: row / rows,
  });
  const stitches = Array.from({ length: rows + 1 }, (_, row) => [
    stitch("left-cycle", row, vertex(0, row), vertex(columns, row)),
    stitch("right-cycle", row, vertex(columns, row), vertex(0, row)),
  ]).flat();
  return {
    state: {
      positions: new Float32Array(count * 6),
      initialPositions: new Float32Array(count * 6),
      previousPositions: new Float32Array(count * 6),
      inverseMasses: new Float32Array(count * 2),
      instances: [
        { id: "front-cycle", particleStart: 0, vertexCount: count, topology: { triangles } },
        { id: "back-cycle", particleStart: count, vertexCount: count, topology: { triangles } },
      ],
      structuralConstraints: structural,
      stitchConstraints: stitches,
      anchorConstraints: [],
      warnings: [],
      invalid: false,
    } as unknown as GarmentAssemblyState,
    meshes: [front, back],
    target: { rootInstanceId: "front-cycle", instanceIds: ["front-cycle", "back-cycle"] },
  };
}

function authoredRectangleFixture(widthMm: number, heightMm: number) {
  const piece: PatternPiece = {
    id: "authored-rectangle",
    name: "authored-rectangle",
    seamAllowanceMm: 0,
    cutQuantity: 1,
    points: [
      { id: "a", xMm: 0, yMm: 0 },
      { id: "b", xMm: widthMm, yMm: 0 },
      { id: "c", xMm: widthMm, yMm: heightMm },
      { id: "d", xMm: 0, yMm: heightMm },
    ],
  };
  const edges = getPatternEdges(piece);
  const blank = createBlankGarment();
  const fabric = createDefaultFabricSource();
  const draft = {
    ...blank,
    fabrics: [fabric],
    pieces: [{ ...piece, fabricId: fabric.id }],
    seams: [{
      id: "authored-tube",
      name: "authored-tube",
      first: { pieceId: piece.id, edgeId: edges[1].id, startT: 0, endT: 1 },
      second: { pieceId: piece.id, edgeId: edges[3].id, startT: 0, endT: 1 },
      direction: "opposite" as const,
      easeRatio: 0,
      type: "standard",
      active: true,
    }],
  };
  const input = buildResolvedAssemblyInput(draft);
  const state = buildResolvedGarmentAssembly(input);
  const instance = state.instances[0];
  const source = instance.topology.positions2DMm;
  const positions = new Float32Array(instance.vertexCount * 3);
  for (let index = 0; index < instance.vertexCount; index += 1) {
    positions[index * 3] = (source[index * 2] - widthMm * 0.5) * 0.001;
    positions[index * 3 + 1] = -(source[index * 2 + 1] - heightMm * 0.5) * 0.001;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(Array.from(instance.topology.triangles));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.set(0, 1, 0.168);
  mesh.updateMatrixWorld(true);
  return {
    state,
    mesh: { key: instance.id, mesh, flat: new Float32Array(positions), dressed: new Float32Array(positions) } as unknown as GarmentAssemblyMeshData,
    target: { rootInstanceId: instance.id, instanceIds: [instance.id] } as SewingStep0Target,
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
    // Local bending may move a remote material point farther than the old
    // uniform cage; the authored material anchor above remains bounded.
    expect(proposal!.maximumVertexDisplacementM).toBeLessThan(0.15);
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

  it("closes a large same-panel cycle by isometric bending without moving its material anchor", () => {
    const fixture = selfSeamedGrid();
    const proposal = solvePlacementAnchoredSewingStep0(
      fixture.state,
      [fixture.mesh],
      fixture.target,
      { iterations: 72, body: cylinderBody(), bodyClearanceM: 0.006 },
    );
    expect(proposal).not.toBeNull();
    expect(proposal!.afterResidual.maximumM).toBeLessThan(0.004);
    expect(proposal!.metricDistortionMax).toBeLessThan(0.02);
    expect(proposal!.maximumCentroidDisplacementM).toBeLessThanOrEqual(0.018001);
    const local = proposal!.positionsByInstanceId.get("tube-panel")!;
    const worldZ = Array.from({ length: local.length / 3 }, (_, index) => local[index * 3 + 2] + 0.07);
    expect(Math.min(...worldZ)).toBeLessThan(-0.045);
    expect(Math.max(...worldZ)).toBeGreaterThan(0.065);
  });

  it("jointly wraps a two-panel seam-graph cycle without swapping front and back anchors", () => {
    const fixture = twoPanelCycle();
    const proposal = solvePlacementAnchoredSewingStep0(
      fixture.state,
      fixture.meshes,
      fixture.target,
      { iterations: 72, body: cylinderBody(), bodyClearanceM: 0.006 },
    );
    expect(proposal).not.toBeNull();
    expect(auditSewingStep0Seams(proposal!.beforeResidual, proposal!.afterResidual).accepted).toBe(true);
    expect(proposal!.afterResidual.maximumM).toBeLessThan(0.008);
    expect(proposal!.metricDistortionMax).toBeLessThan(0.02);
    expect(proposal!.maximumCentroidDisplacementM).toBeLessThanOrEqual(0.018001);
  });

  it("closes the real authored 1020 x 300 mm rectangle topology without metric rejection", () => {
    const fixture = authoredRectangleFixture(1020, 300);
    const proposal = solvePlacementAnchoredSewingStep0(
      fixture.state,
      [fixture.mesh],
      fixture.target,
      { iterations: 72, body: cylinderBody(0.159), bodyClearanceM: 0.0005 },
    );
    expect(proposal).not.toBeNull();
    expect(proposal!.afterResidual.maximumM).toBeLessThan(0.005);
    expect(proposal!.metricDistortionMax).toBeLessThan(0.02);
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
