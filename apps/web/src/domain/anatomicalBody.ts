import type { BodyMeasurements, BodyType } from "./pattern";

export interface AnatomicalMeasurements extends BodyMeasurements {
  bicepMm: number;
  wristMm: number;
  thighMm: number;
  calfMm: number;
}

export interface BodyLandmarks {
  shoulderY: number;
  bustY: number;
  waistY: number;
  hipY: number;
  crotchY: number;
  kneeY: number;
  wristY: number;
}

export interface AnatomicalBodyMesh {
  positions: number[];
  indices: number[];
  measurements: AnatomicalMeasurements;
  landmarks: BodyLandmarks;
  bodyType: BodyType;
}

export function deriveAnatomicalMeasurements(input: BodyMeasurements): AnatomicalMeasurements {
  return {
    ...input,
    bicepMm: positiveOr(input.bicepMm, input.bustMm * 0.33),
    wristMm: positiveOr(input.wristMm, input.bustMm * 0.18),
    thighMm: positiveOr(input.thighMm, input.hipMm * 0.58),
    calfMm: positiveOr(input.calfMm, input.hipMm * 0.38),
  };
}

export function createBodyLandmarks(measurements: BodyMeasurements): BodyLandmarks {
  const height = measurements.heightMm;
  return {
    shoulderY: height * 0.82,
    bustY: height * 0.72,
    waistY: height * 0.61,
    hipY: height * 0.53,
    crotchY: height * 0.47,
    kneeY: height * 0.285,
    wristY: height * 0.49,
  };
}

/**
 * Low-poly anatomical proxy shared by collision and visible fitting views.
 * Coordinates are millimetres, Y-up. Circumference stations are kept exact.
 */
export function generateAnatomicalBodyMesh(
  input: BodyMeasurements,
  bodyType: BodyType,
  radialSegments = 24,
): AnatomicalBodyMesh {
  const measurements = deriveAnatomicalMeasurements(input);
  const landmarks = createBodyLandmarks(measurements);
  const segments = Math.max(12, Math.min(40, Math.round(radialSegments)));
  const bustRadius = measurements.bustMm / (Math.PI * 2);
  const waistRadius = measurements.waistMm / (Math.PI * 2);
  const hipRadius = measurements.hipMm / (Math.PI * 2);
  const shoulderRadius = Math.max(measurements.shoulderWidthMm / 2, bustRadius * 1.08);
  const stations: Array<[number, number, number]> = [
    [measurements.heightMm * 0.94, shoulderRadius * 0.34, shoulderRadius * 0.35],
    [measurements.heightMm * 0.88, shoulderRadius * 0.55, shoulderRadius * 0.52],
    [landmarks.shoulderY, shoulderRadius, bustRadius * 0.72],
    [landmarks.bustY, bustRadius, bustRadius],
    [landmarks.waistY, waistRadius, waistRadius],
    [landmarks.hipY, hipRadius, hipRadius],
    [landmarks.crotchY, hipRadius * 0.78, hipRadius * 0.75],
    [measurements.heightMm * 0.35, measurements.thighMm / (Math.PI * 2), measurements.thighMm / (Math.PI * 2)],
    [landmarks.kneeY, measurements.calfMm / (Math.PI * 2) * 0.85, measurements.calfMm / (Math.PI * 2) * 0.85],
    [measurements.heightMm * 0.07, measurements.wristMm / (Math.PI * 2) * 0.72, measurements.wristMm / (Math.PI * 2) * 0.72],
  ];

  const positions: number[] = [];
  for (const [y, radiusX, radiusZ] of stations) {
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = segment / segments * Math.PI * 2;
      positions.push(Math.cos(angle) * radiusX, y, Math.sin(angle) * radiusZ);
    }
  }
  const indices: number[] = [];
  for (let station = 0; station < stations.length - 1; station += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = station * segments + segment;
      const b = station * segments + next;
      const c = (station + 1) * segments + segment;
      const d = (station + 1) * segments + next;
      indices.push(a, c, b, b, c, d);
    }
  }
  capRing(positions, indices, 0, segments, true);
  capRing(positions, indices, (stations.length - 1) * segments, segments, false);
  return { positions, indices, measurements, landmarks, bodyType };
}

export function inspectAnatomicalBodyMesh(mesh: AnatomicalBodyMesh): {
  finite: boolean;
  vertexCount: number;
  triangleCount: number;
  indexBoundsValid: boolean;
} {
  const vertexCount = mesh.positions.length / 3;
  return {
    finite: mesh.positions.every(Number.isFinite),
    vertexCount,
    triangleCount: mesh.indices.length / 3,
    indexBoundsValid: mesh.indices.every((index) => Number.isInteger(index) && index >= 0 && index < vertexCount),
  };
}

export function stationCircumferences(measurements: BodyMeasurements): Pick<AnatomicalMeasurements, "bustMm" | "waistMm" | "hipMm"> {
  return { bustMm: measurements.bustMm, waistMm: measurements.waistMm, hipMm: measurements.hipMm };
}

function capRing(positions: number[], indices: number[], ringStart: number, segments: number, reverse: boolean): void {
  const centerIndex = positions.length / 3;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let index = 0; index < segments; index += 1) {
    x += positions[(ringStart + index) * 3];
    y += positions[(ringStart + index) * 3 + 1];
    z += positions[(ringStart + index) * 3 + 2];
  }
  positions.push(x / segments, y / segments, z / segments);
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    if (reverse) indices.push(centerIndex, ringStart + next, ringStart + segment);
    else indices.push(centerIndex, ringStart + segment, ringStart + next);
  }
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
