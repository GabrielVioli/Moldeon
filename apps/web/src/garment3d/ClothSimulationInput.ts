import type { FabricPhysics } from "../domain/fabric";
import type { GarmentDraft } from "../domain/pattern";
import type {
  AssemblyPanelInstance,
  GarmentAssemblyState,
  GlobalPointReference,
} from "./GarmentAssembly";
import type {
  AnchorConstraintBuffer,
  ClothConstraintBuffers,
  ClothSimulationInput,
  DistanceConstraintBuffer,
  InterpolatedConstraintBuffer,
} from "../physics/clothXpbd";

const METERS_PER_MM = 0.001;
const REFERENCE_WIDTH = 2;

export function buildClothSimulationInput(
  state: GarmentAssemblyState,
  garment: GarmentDraft,
): ClothSimulationInput {
  const restPositions2D = buildRestPositions2D(state);
  const materialCoordinates = new Float32Array(restPositions2D);
  const triangles = buildGlobalTriangles(state.instances);
  const constraints = buildConstraintBuffers(
    state,
    garment,
    restPositions2D,
  );

  return {
    positions: new Float32Array(state.positions),
    inverseMasses: new Float32Array(state.inverseMasses),
    restPositions2D,
    triangles,
    materialCoordinates,
    constraints,
  };
}

function buildRestPositions2D(state: GarmentAssemblyState): Float32Array {
  const result = new Float32Array(state.inverseMasses.length * 2);
  for (const instance of state.instances) {
    for (let local = 0; local < instance.vertexCount; local += 1) {
      const global = instance.particleStart + local;
      result[global * 2] = instance.topology.positions2DMm[local * 2] * METERS_PER_MM;
      result[global * 2 + 1] = instance.topology.positions2DMm[local * 2 + 1] * METERS_PER_MM;
    }
  }
  return result;
}

function buildGlobalTriangles(instances: readonly AssemblyPanelInstance[]): Uint32Array {
  const values: number[] = [];
  for (const instance of instances) {
    for (const local of instance.topology.triangles) {
      values.push(instance.particleStart + local);
    }
  }
  return Uint32Array.from(values);
}

function buildConstraintBuffers(
  state: GarmentAssemblyState,
  garment: GarmentDraft,
  restPositions2D: Float32Array,
): ClothConstraintBuffers {
  const particleFabric = buildParticleFabricMap(state, garment);
  const warp: DistanceEntry[] = [];
  const weft: DistanceEntry[] = [];
  const shear: DistanceEntry[] = [];

  for (const constraint of state.structuralConstraints) {
    const dx = restPositions2D[constraint.b * 2] - restPositions2D[constraint.a * 2];
    const dy = restPositions2D[constraint.b * 2 + 1] - restPositions2D[constraint.a * 2 + 1];
    const fabric = particleFabric[constraint.a] ?? DEFAULT_PHYSICS;
    const absoluteX = Math.abs(dx);
    const absoluteY = Math.abs(dy);
    if (absoluteY >= absoluteX * 1.25) {
      warp.push({
        a: constraint.a,
        b: constraint.b,
        restLength: constraint.restLength,
        compliance: stretchCompliance(fabric.stretchWarpPercent),
      });
    } else if (absoluteX >= absoluteY * 1.25) {
      weft.push({
        a: constraint.a,
        b: constraint.b,
        restLength: constraint.restLength,
        compliance: stretchCompliance(fabric.stretchWeftPercent),
      });
    } else {
      shear.push({
        a: constraint.a,
        b: constraint.b,
        restLength: constraint.restLength,
        compliance: shearCompliance(fabric),
      });
    }
  }

  return {
    warp: toDistanceBuffer(warp),
    weft: toDistanceBuffer(weft),
    shear: toDistanceBuffer(shear),
    bend: toDistanceBuffer(buildBendEntries(state, particleFabric)),
    stitches: buildStitchBuffer(state),
    anchors: buildAnchorBuffer(state),
  };
}

interface DistanceEntry {
  a: number;
  b: number;
  restLength: number;
  compliance: number;
}

function toDistanceBuffer(entries: readonly DistanceEntry[]): DistanceConstraintBuffer {
  return {
    a: Uint32Array.from(entries.map((entry) => entry.a)),
    b: Uint32Array.from(entries.map((entry) => entry.b)),
    restLength: Float32Array.from(entries.map((entry) => entry.restLength)),
    compliance: Float32Array.from(entries.map((entry) => entry.compliance)),
    lambda: new Float32Array(entries.length),
  };
}

function buildBendEntries(
  state: GarmentAssemblyState,
  particleFabric: readonly FabricPhysics[],
): DistanceEntry[] {
  const result: DistanceEntry[] = [];
  for (const instance of state.instances) {
    const adjacent = new Map<string, number>();
    const triangles = instance.topology.triangles;
    for (let offset = 0; offset < triangles.length; offset += 3) {
      const a = triangles[offset];
      const b = triangles[offset + 1];
      const c = triangles[offset + 2];
      registerOpposite(a, b, c);
      registerOpposite(b, c, a);
      registerOpposite(c, a, b);
    }

    function registerOpposite(localA: number, localB: number, localOpposite: number): void {
      const key = localA < localB ? `${localA}:${localB}` : `${localB}:${localA}`;
      const firstOpposite = adjacent.get(key);
      if (firstOpposite === undefined) {
        adjacent.set(key, localOpposite);
        return;
      }
      if (firstOpposite === localOpposite) return;
      const a = instance.particleStart + firstOpposite;
      const b = instance.particleStart + localOpposite;
      const restLength = particleDistance(state.initialPositions, a, b);
      if (restLength <= 1e-8) return;
      const fabric = particleFabric[a] ?? DEFAULT_PHYSICS;
      result.push({
        a,
        b,
        restLength,
        compliance: bendCompliance(fabric),
      });
    }
  }
  return result;
}

function buildStitchBuffer(state: GarmentAssemblyState): InterpolatedConstraintBuffer {
  const count = state.stitchConstraints.length;
  const aIndices = new Uint32Array(count * REFERENCE_WIDTH);
  const aWeights = new Float32Array(count * REFERENCE_WIDTH);
  const bIndices = new Uint32Array(count * REFERENCE_WIDTH);
  const bWeights = new Float32Array(count * REFERENCE_WIDTH);
  const restDistance = new Float32Array(count);
  const compliance = new Float32Array(count);

  state.stitchConstraints.forEach((constraint, index) => {
    writeReference(constraint.a, aIndices, aWeights, index);
    writeReference(constraint.b, bIndices, bWeights, index);
    restDistance[index] = constraint.restDistance;
    compliance[index] = Math.max(1e-9, (1 - constraint.stiffness) * 2e-6);
  });

  return {
    aIndices,
    aWeights,
    bIndices,
    bWeights,
    restDistance,
    compliance,
    lambda: new Float32Array(count),
  };
}

function writeReference(
  reference: GlobalPointReference,
  indices: Uint32Array,
  weights: Float32Array,
  constraintIndex: number,
): void {
  if (reference.particleIndices.length === 0) {
    throw new RangeError("Uma costura interpolada não possui partículas.");
  }
  if (reference.particleIndices.length > REFERENCE_WIDTH) {
    throw new RangeError("O Worker XPBD suporta referências lineares de até duas partículas.");
  }
  let total = 0;
  for (let slot = 0; slot < REFERENCE_WIDTH; slot += 1) {
    const sourceIndex = Math.min(slot, reference.particleIndices.length - 1);
    const weight = reference.weights[slot] ?? 0;
    indices[constraintIndex * REFERENCE_WIDTH + slot] = reference.particleIndices[sourceIndex];
    weights[constraintIndex * REFERENCE_WIDTH + slot] = weight;
    total += weight;
  }
  if (Math.abs(total - 1) > 1e-4) {
    throw new RangeError("Os pesos da costura interpolada precisam somar um.");
  }
}

function buildAnchorBuffer(state: GarmentAssemblyState): AnchorConstraintBuffer {
  const count = state.anchorConstraints.length;
  return {
    particle: Uint32Array.from(state.anchorConstraints.map((item) => item.particleIndex)),
    target: Float32Array.from(
      state.anchorConstraints.flatMap((item) => [item.targetX, item.targetY, item.targetZ]),
    ),
    compliance: Float32Array.from(
      state.anchorConstraints.map((item) => Math.max(1e-9, (1 - item.stiffness) * 8e-6)),
    ),
    lambda: new Float32Array(count),
  };
}

function buildParticleFabricMap(
  state: GarmentAssemblyState,
  garment: GarmentDraft,
): FabricPhysics[] {
  const pieceById = new Map(garment.pieces.map((piece) => [piece.id, piece]));
  const fabricById = new Map(garment.fabrics.map((fabric) => [fabric.id, fabric.physics]));
  const fallback = garment.fabrics[0]?.physics ?? DEFAULT_PHYSICS;
  const result = Array<FabricPhysics>(state.inverseMasses.length).fill(fallback);

  for (const instance of state.instances) {
    const piece = pieceById.get(instance.pieceId);
    const physics = fabricById.get(piece?.fabricId ?? "") ?? fallback;
    for (let local = 0; local < instance.vertexCount; local += 1) {
      result[instance.particleStart + local] = physics;
    }
  }
  return result;
}

function particleDistance(positions: Float32Array, a: number, b: number): number {
  const aOffset = a * 3;
  const bOffset = b * 3;
  return Math.hypot(
    positions[bOffset] - positions[aOffset],
    positions[bOffset + 1] - positions[aOffset + 1],
    positions[bOffset + 2] - positions[aOffset + 2],
  );
}

function stretchCompliance(stretchPercent: number): number {
  return 1e-8 + Math.min(100, Math.max(0, stretchPercent)) * 1.6e-7;
}

function shearCompliance(physics: FabricPhysics): number {
  const averageStretch = (physics.stretchWarpPercent + physics.stretchWeftPercent) / 2;
  return 4e-7 + Math.min(100, averageStretch) * 2.4e-7;
}

function bendCompliance(physics: FabricPhysics): number {
  const rigidity = Math.min(1, Math.max(0, physics.bending));
  return 2e-5 + (1 - rigidity) * 1.8e-3;
}

const DEFAULT_PHYSICS: FabricPhysics = {
  weightGsm: 165,
  thicknessMm: 0.42,
  stretchWarpPercent: 2,
  stretchWeftPercent: 3,
  bending: 0.46,
  friction: 0.5,
};
