import { describe, expect, it } from "vitest";
import {
  getPatternEdges,
  type GarmentDraft,
  type PatternSnapshot,
} from "../domain/pattern";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import {
  buildCoarseAssemblySet,
  type CoarseAssemblyMesh,
} from "./CoarseAssemblyMesh";
import type {
  AssemblyPanelInstance,
  GarmentAssemblyState,
} from "./GarmentAssembly";
import { buildPhysicalGarmentAssembly } from "./PhysicalGarmentAssembly";

type Point3 = readonly [number, number, number];

interface DartAssemblyFixture {
  state: GarmentAssemblyState;
  foldA: AssemblyPanelInstance;
  foldB: AssemblyPanelInstance;
  coarseA: CoarseAssemblyMesh;
  coarseB: CoarseAssemblyMesh;
  foldEdgeId: string;
}

describe("CoarseAssemblyMesh closed-dart frame", () => {
  it("is O(3)-equivariant under instance rotation and preserves cut-on-fold parity", () => {
    const unrotated = buildDartAssembly(0);
    const angleDeg = 37;
    const rotated = buildDartAssembly(angleDeg);
    const angleRad = angleDeg * Math.PI / 180;

    expect(unrotated.foldA.materialParity).toBe(1);
    expect(unrotated.foldB.materialParity).toBe(-1);
    expect(rotated.foldA.materialParity).toBe(1);
    expect(rotated.foldB.materialParity).toBe(-1);

    expectCenteredRotation(unrotated.coarseA.positions, rotated.coarseA.positions, angleRad);
    expectCenteredRotation(unrotated.coarseB.positions, rotated.coarseB.positions, angleRad);

    expectFoldReflection(unrotated);
    expectFoldReflection(rotated);
    expectMatchingMetricLengths(unrotated.coarseA, unrotated.coarseB);
    expectMatchingMetricLengths(rotated.coarseA, rotated.coarseB);
  });
});

function buildDartAssembly(rotationZDeg: number): DartAssemblyFixture {
  const source = createBaselineFixture("dart-piece");
  const draft: GarmentDraft = {
    ...source,
    assemblyPlacements: source.assemblyPlacements?.map((placement) => ({
      ...placement,
      rotationDeg: [
        placement.rotationDeg[0],
        placement.rotationDeg[1],
        rotationZDeg,
      ],
    })),
  };
  const snapshots: PatternSnapshot[] = draft.pieces.map((piece) => ({
    piece,
    areaMm2: 0,
    perimeterMm: 0,
    issues: [],
  }));
  const state = buildPhysicalGarmentAssembly(snapshots, draft);
  const coarse = buildCoarseAssemblySet(state);
  const foldA = state.instances.find((instance) => instance.id.endsWith(":fold-a"));
  const foldB = state.instances.find((instance) => instance.id.endsWith(":fold-b"));
  if (!foldA || !foldB) throw new Error("A fixture de pence não gerou o par cut-on-fold.");
  const coarseA = coarse.byInstanceId.get(foldA.id);
  const coarseB = coarse.byInstanceId.get(foldB.id);
  if (!coarseA || !coarseB) throw new Error("O par cut-on-fold não chegou à malha coarse.");
  const foldEdge = getPatternEdges(draft.pieces[0]).find((edge) => edge.role === "fold");
  if (!foldEdge) throw new Error("A fixture de pence não possui uma borda de dobra.");
  return {
    state,
    foldA,
    foldB,
    coarseA,
    coarseB,
    foldEdgeId: foldEdge.id,
  };
}

function expectCenteredRotation(
  source: Float32Array,
  target: Float32Array,
  angleRad: number,
): void {
  expect(target.length).toBe(source.length);
  const sourceCenter = centroid(source);
  const targetCenter = centroid(target);
  for (let vertex = 0; vertex < source.length / 3; vertex += 1) {
    const local = subtract(point(source, vertex), sourceCenter);
    const expected = rotateZ(local, angleRad);
    const actual = subtract(point(target, vertex), targetCenter);
    expectPointClose(actual, expected, 2e-5);
  }
}

function expectFoldReflection(fixture: DartAssemblyFixture): void {
  const path = fixture.foldA.topology.edges.get(fixture.foldEdgeId);
  if (!path || path.vertexIndices.length < 2) {
    throw new Error("A borda de dobra não foi materializada na topologia física.");
  }
  const start = physicalPoint(
    fixture.state.initialPositions,
    fixture.foldA,
    path.vertexIndices[0],
  );
  const end = physicalPoint(
    fixture.state.initialPositions,
    fixture.foldA,
    path.vertexIndices[path.vertexIndices.length - 1],
  );

  expect(fixture.coarseB.positions.length).toBe(fixture.coarseA.positions.length);
  for (let vertex = 0; vertex < fixture.coarseA.positions.length / 3; vertex += 1) {
    const expected = reflectPointAcrossVerticalPlane(
      point(fixture.coarseA.positions, vertex),
      start,
      end,
    );
    expectPointClose(point(fixture.coarseB.positions, vertex), expected, 2e-5);
  }

  const triangleOffset = largestTriangleOffset(fixture.coarseA);
  const normalA = triangleNormal(fixture.coarseA, triangleOffset);
  const normalB = triangleNormal(fixture.coarseB, triangleOffset);
  const reflectedNormal = reflectVectorAcrossVerticalPlane(normalA, start, end);
  const expectedNormalB = scale(reflectedNormal, -1);
  expect(dot(normalB, expectedNormalB)).toBeGreaterThan(0.9999);
}

function expectMatchingMetricLengths(
  first: CoarseAssemblyMesh,
  second: CoarseAssemblyMesh,
): void {
  expect(second.metricEdges).toHaveLength(first.metricEdges.length);
  for (let index = 0; index < first.metricEdges.length; index += 1) {
    const firstEdge = first.metricEdges[index];
    const secondEdge = second.metricEdges[index];
    expect(secondEdge.a).toBe(firstEdge.a);
    expect(secondEdge.b).toBe(firstEdge.b);
    const firstLength = distance(
      point(first.positions, firstEdge.a),
      point(first.positions, firstEdge.b),
    );
    const secondLength = distance(
      point(second.positions, secondEdge.a),
      point(second.positions, secondEdge.b),
    );
    expect(Math.abs(secondLength - firstLength)).toBeLessThan(2e-6);
  }
}

function physicalPoint(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  localVertex: number,
): Point3 {
  return point(positions, instance.particleStart + localVertex);
}

function point(values: Float32Array, vertex: number): Point3 {
  return [values[vertex * 3], values[vertex * 3 + 1], values[vertex * 3 + 2]];
}

function centroid(values: Float32Array): Point3 {
  let x = 0;
  let y = 0;
  let z = 0;
  const count = values.length / 3;
  for (let vertex = 0; vertex < count; vertex += 1) {
    x += values[vertex * 3];
    y += values[vertex * 3 + 1];
    z += values[vertex * 3 + 2];
  }
  return [x / count, y / count, z / count];
}

function rotateZ(value: Point3, angle: number): Point3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    value[0] * cosine - value[1] * sine,
    value[0] * sine + value[1] * cosine,
    value[2],
  ];
}

function reflectPointAcrossVerticalPlane(
  value: Point3,
  lineStart: Point3,
  lineEnd: Point3,
): Point3 {
  const reflected = reflectVectorAcrossVerticalPlane(
    [value[0] - lineStart[0], value[1] - lineStart[1], value[2]],
    [0, 0, 0],
    [lineEnd[0] - lineStart[0], lineEnd[1] - lineStart[1], 0],
  );
  return [reflected[0] + lineStart[0], reflected[1] + lineStart[1], value[2]];
}

function reflectVectorAcrossVerticalPlane(
  value: Point3,
  lineStart: Point3,
  lineEnd: Point3,
): Point3 {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) throw new Error("A linha de reflexão é degenerada.");
  const ux = dx / length;
  const uy = dy / length;
  const projection = value[0] * ux + value[1] * uy;
  return [
    2 * projection * ux - value[0],
    2 * projection * uy - value[1],
    value[2],
  ];
}

function largestTriangleOffset(mesh: CoarseAssemblyMesh): number {
  let bestOffset = 0;
  let bestArea = -1;
  for (let offset = 0; offset < mesh.triangles.length; offset += 3) {
    const a = point(mesh.positions, mesh.triangles[offset]);
    const b = point(mesh.positions, mesh.triangles[offset + 1]);
    const c = point(mesh.positions, mesh.triangles[offset + 2]);
    const area = length(cross(subtract(b, a), subtract(c, a))) * 0.5;
    if (area > bestArea) {
      bestArea = area;
      bestOffset = offset;
    }
  }
  return bestOffset;
}

function triangleNormal(mesh: CoarseAssemblyMesh, offset: number): Point3 {
  const a = point(mesh.positions, mesh.triangles[offset]);
  const b = point(mesh.positions, mesh.triangles[offset + 1]);
  const c = point(mesh.positions, mesh.triangles[offset + 2]);
  return normalize(cross(subtract(b, a), subtract(c, a)));
}

function expectPointClose(actual: Point3, expected: Point3, tolerance: number): void {
  expect(Math.abs(actual[0] - expected[0])).toBeLessThan(tolerance);
  expect(Math.abs(actual[1] - expected[1])).toBeLessThan(tolerance);
  expect(Math.abs(actual[2] - expected[2])).toBeLessThan(tolerance);
}

function subtract(first: Point3, second: Point3): Point3 {
  return [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
}

function scale(value: Point3, scalar: number): Point3 {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function dot(first: Point3, second: Point3): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function cross(first: Point3, second: Point3): Point3 {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function length(value: Point3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function normalize(value: Point3): Point3 {
  const magnitude = length(value);
  if (magnitude <= 1e-12) throw new Error("Não é possível normalizar um vetor nulo.");
  return scale(value, 1 / magnitude);
}

function distance(first: Point3, second: Point3): number {
  return length(subtract(second, first));
}
