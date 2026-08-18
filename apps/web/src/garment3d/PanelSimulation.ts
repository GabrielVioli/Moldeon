import type { PanelTopology } from "./PanelTopology";
import type { StitchConstraint } from "./StitchConstraintBuilder";
import { solveDistanceConstraints, type LegacyXpbdState, type DistanceConstraint } from "../physics/xpbd";

export interface PanelSimulationState {
  topology: PanelTopology;
  positions: Float32Array;
  previousPositions: Float32Array;
  inverseMasses: Float32Array;
  constraints: DistanceConstraint[];
}

const DEFAULT_STIFFNESS = 1;
const TIME_STEP = 1 / 60;
const ITERATIONS = 10;

export function initializePanelSimulation(
  topology: PanelTopology,
  stitchConstraints: StitchConstraint[],
): PanelSimulationState {
  const positions = createInitial3DPositions(topology);
  const previousPositions = new Float32Array(positions);
  const inverseMasses = new Float32Array(positions.length / 3).fill(1);
  const structuralConstraints = buildStructuralConstraints(topology, positions);

  const xpbdConstraints: DistanceConstraint[] = [
    ...structuralConstraints,
    ...stitchConstraints.map((constraint) => ({
      a: constraint.vertexA,
      b: constraint.vertexB,
      restLength: constraint.restDistance,
      compliance: 0,
      lambda: 0,
    })),
  ];

  return {
    topology,
    positions,
    previousPositions,
    inverseMasses,
    constraints: xpbdConstraints,
  };
}

export function simulatePanel(
  state: PanelSimulationState,
  deltaSeconds = TIME_STEP,
): PanelSimulationState {
  if (state.positions.length === 0) return state;
  if (state.constraints.length === 0) return state;

  const xpbdState: LegacyXpbdState = {
    positions: state.positions,
    previousPositions: state.previousPositions,
    inverseMasses: state.inverseMasses,
    constraints: state.constraints,
  };

  solveDistanceConstraints(xpbdState, deltaSeconds, ITERATIONS);
  return state;
}

function createInitial3DPositions(topology: PanelTopology): Float32Array {
  const vertexCount = topology.positions2D.length / 2;
  const positions = new Float32Array(vertexCount * 3);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < vertexCount; index += 1) {
    const x = topology.positions2D[index * 2];
    const y = topology.positions2D[index * 2 + 1];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const width = Math.max(maxX - minX, 1e-3);
  const height = Math.max(maxY - minY, 1e-3);
  const radius = Math.max(0.05, width / (2 * Math.PI));
  const centerY = (minY + maxY) / 2;

  for (let index = 0; index < vertexCount; index += 1) {
    const x = topology.positions2D[index * 2];
    const y = topology.positions2D[index * 2 + 1];
    const t = (x - minX) / width;
    const angle = t * Math.PI * 2;
    positions[index * 3] = radius * Math.cos(angle);
    positions[index * 3 + 1] = y - centerY;
    positions[index * 3 + 2] = radius * Math.sin(angle);
  }

  return positions;
}

function buildStructuralConstraints(
  topology: PanelTopology,
  positions: Float32Array,
): DistanceConstraint[] {
  const edges = new Set<string>();
  const triangles = topology.triangles;
  const result: DistanceConstraint[] = [];

  for (let index = 0; index < triangles.length; index += 3) {
    const a = triangles[index];
    const b = triangles[index + 1];
    const c = triangles[index + 2];
    addEdge(a, b, result, edges, positions);
    addEdge(b, c, result, edges, positions);
    addEdge(c, a, result, edges, positions);
  }

  return result;
}

function addEdge(
  a: number,
  b: number,
  constraints: DistanceConstraint[],
  seen: Set<string>,
  positions: Float32Array,
) {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  if (seen.has(key)) return;
  seen.add(key);
  const aOffset = a * 3;
  const bOffset = b * 3;
  const dx = positions[bOffset] - positions[aOffset];
  const dy = positions[bOffset + 1] - positions[aOffset + 1];
  const dz = positions[bOffset + 2] - positions[aOffset + 2];
  const restLength = Math.hypot(dx, dy, dz);
  constraints.push({
    a,
    b,
    restLength,
    compliance: 0,
    lambda: 0,
  });
}
