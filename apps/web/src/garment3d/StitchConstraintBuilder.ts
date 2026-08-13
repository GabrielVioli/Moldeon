import {
  edgeRangeSequenceLength,
  resolveEdgeRangeSequenceProgress,
  seamSideRanges,
  type EdgeRange,
  type GarmentDraft,
  type SeamTreatment,
} from "../domain/pattern";
import {
  buildPanelTopology,
  type PanelTopology,
} from "./PanelTopology";
import type {
  ConstraintPoint,
  PanelEdgePath,
  StitchConstraint as CanonicalStitchConstraint,
} from "./types";

/**
 * Compatibilidade temporária com PanelSimulation.ts.
 *
 * pointA e pointB são a representação correta para o novo motor.
 * vertexA e vertexB continuarão existindo até PanelSimulation ser
 * migrado para restrições interpoladas.
 */
export interface StitchConstraint
  extends CanonicalStitchConstraint {
  /**
   * @deprecated Use pointA.
   */
  vertexA: number;

  /**
   * @deprecated Use pointB.
   */
  vertexB: number;
}

export interface BuildSelfSeamConstraintOptions {
  /**
   * Restringe a construção a apenas uma peça.
   *
   * Isso evita que a simulação de uma manga receba índices de uma saia,
   * calça ou qualquer outro painel.
   */
  pieceId?: string;

  /**
   * Topologia já construída.
   *
   * Evita reconstruir a mesma topologia dentro do builder.
   */
  topology?: PanelTopology;

  /**
   * Distância aproximada entre pontos de costura.
   */
  sampleSpacingMm?: number;

  minSampleCount?: number;
  maxSampleCount?: number;
}

const DEFAULT_SAMPLE_SPACING_MM = 18;
const DEFAULT_MIN_SAMPLE_COUNT = 2;
const DEFAULT_MAX_SAMPLE_COUNT = 160;
const PARAMETER_EPSILON = 1e-7;
const LENGTH_EPSILON_MM = 1e-6;

/**
 * Converte todas as costuras próprias válidas em restrições geométricas.
 *
 * Costura própria significa:
 *
 * seam.first.pieceId === seam.second.pieceId
 *
 * Exemplos:
 * - perna de calça fechada nela mesma;
 * - manga tubular;
 * - cós;
 * - punho;
 * - saia de painel único.
 */
export function buildSelfSeamConstraints(
  garment: GarmentDraft,
  optionsOrLegacySampleCount:
    | BuildSelfSeamConstraintOptions
    | number = {},
): StitchConstraint[] {
  const options = normalizeOptions(
    optionsOrLegacySampleCount,
  );

  const topologyCache = new Map<string, PanelTopology>();
  const constraints: StitchConstraint[] = [];
  const constraintKeys = new Set<string>();

  for (const seam of garment.seams ?? []) {
    if (seam.active === false) continue;
    const firstRanges = seamSideRanges(seam, "first");
    const secondRanges = seamSideRanges(seam, "second");
    const involvedPieceIds = new Set([...firstRanges, ...secondRanges].map((range) => range.pieceId));
    if (involvedPieceIds.size !== 1) {
      continue;
    }

    const pieceId = [...involvedPieceIds][0];

    if (
      options.pieceId !== undefined &&
      options.pieceId !== pieceId
    ) {
      continue;
    }

    /*
     * Não faz sentido costurar exatamente o mesmo intervalo
     * da mesma borda sobre ele mesmo.
     */
    if (rangeSequencesAreIdentical(firstRanges, secondRanges)) {
      continue;
    }

    const piece = garment.pieces.find(
      (candidate) => candidate.id === pieceId,
    );

    if (!piece) {
      continue;
    }

    const topology =
      resolveTopology(
        pieceId,
        piece,
        options,
        topologyCache,
      );

    const firstLengthMm = edgeRangeSequenceLength([piece], firstRanges);
    const secondLengthMm = edgeRangeSequenceLength([piece], secondRanges);

    if (
      firstLengthMm <= LENGTH_EPSILON_MM ||
      secondLengthMm <= LENGTH_EPSILON_MM
    ) {
      continue;
    }

    const sampleCount = resolveSampleCount(
      firstLengthMm,
      secondLengthMm,
      options,
    );

    const stiffness = treatmentStiffness(
      seam.treatment,
    );

    for (
      let sampleIndex = 0;
      sampleIndex < sampleCount;
      sampleIndex += 1
    ) {
      const progress =
        sampleCount <= 1
          ? 0
          : sampleIndex / (sampleCount - 1);

      const secondProgress =
        seam.direction === "opposite"
          ? 1 - progress
          : progress;
      const firstPoint = resolveEdgeRangeSequenceProgress([piece], firstRanges, progress);
      const secondPoint = resolveEdgeRangeSequenceProgress([piece], secondRanges, secondProgress);
      if (!firstPoint || !secondPoint) continue;
      const firstPath = topology.edges.get(firstPoint.range.edgeId);
      const secondPath = topology.edges.get(secondPoint.range.edgeId);
      if (!firstPath || !secondPath) continue;

      const pointA = createConstraintPoint(
        firstPath,
        firstPoint.t,
      );

      const pointB = createConstraintPoint(
        secondPath,
        secondPoint.t,
      );

      /*
       * Algumas costuras compartilham um vértice no começo ou no fim.
       * Não criamos uma restrição que ligue um ponto a ele mesmo.
       */
      if (constraintPointsAreEqual(pointA, pointB)) {
        continue;
      }

      const key = [
        seam.id,
        constraintPointKey(pointA),
        constraintPointKey(pointB),
      ].join("/");

      if (constraintKeys.has(key)) {
        continue;
      }

      constraintKeys.add(key);

      constraints.push({
        type: "stitch",
        seamId: seam.id,

        pieceA: pieceId,
        pieceB: pieceId,

        pointA,
        pointB,

        /*
         * Campos de compatibilidade com o solver atual.
         * O próximo passo removerá essa aproximação.
         */
        vertexA: representativeVertex(pointA),
        vertexB: representativeVertex(pointB),

        restDistance: 0,
        stiffness,
      });
    }
  }

  return constraints;
}

function normalizeOptions(
  optionsOrLegacySampleCount:
    | BuildSelfSeamConstraintOptions
    | number,
): Required<
  Pick<
    BuildSelfSeamConstraintOptions,
    | "sampleSpacingMm"
    | "minSampleCount"
    | "maxSampleCount"
  >
> &
  Pick<
    BuildSelfSeamConstraintOptions,
    "pieceId" | "topology"
  > {
  if (
    typeof optionsOrLegacySampleCount ===
    "number"
  ) {
    const count = clampInteger(
      optionsOrLegacySampleCount,
      DEFAULT_MIN_SAMPLE_COUNT,
      DEFAULT_MAX_SAMPLE_COUNT,
    );

    return {
      sampleSpacingMm:
        DEFAULT_SAMPLE_SPACING_MM,
      minSampleCount: count,
      maxSampleCount: count,
    };
  }

  const sampleSpacingMm =
    Number.isFinite(
      optionsOrLegacySampleCount.sampleSpacingMm,
    ) &&
    (optionsOrLegacySampleCount.sampleSpacingMm ??
      0) > 0
      ? optionsOrLegacySampleCount.sampleSpacingMm!
      : DEFAULT_SAMPLE_SPACING_MM;

  const minSampleCount = clampInteger(
    optionsOrLegacySampleCount.minSampleCount ??
      DEFAULT_MIN_SAMPLE_COUNT,
    2,
    DEFAULT_MAX_SAMPLE_COUNT,
  );

  const maxSampleCount = clampInteger(
    optionsOrLegacySampleCount.maxSampleCount ??
      DEFAULT_MAX_SAMPLE_COUNT,
    minSampleCount,
    512,
  );

  return {
    pieceId: optionsOrLegacySampleCount.pieceId,
    topology: optionsOrLegacySampleCount.topology,
    sampleSpacingMm,
    minSampleCount,
    maxSampleCount,
  };
}

function resolveTopology(
  pieceId: string,
  piece: GarmentDraft["pieces"][number],
  options: BuildSelfSeamConstraintOptions,
  cache: Map<string, PanelTopology>,
): PanelTopology {
  if (
    options.topology?.pieceId === pieceId
  ) {
    return options.topology;
  }

  const cached = cache.get(pieceId);

  if (cached) {
    return cached;
  }

  const topology = buildPanelTopology(piece);
  cache.set(pieceId, topology);

  return topology;
}

function resolveSampleCount(
  firstLengthMm: number,
  secondLengthMm: number,
  options: Required<
    Pick<
      BuildSelfSeamConstraintOptions,
      | "sampleSpacingMm"
      | "minSampleCount"
      | "maxSampleCount"
    >
  >,
): number {
  const longestLengthMm = Math.max(
    firstLengthMm,
    secondLengthMm,
  );

  /*
   * +1 inclui os dois extremos da costura.
   */
  const estimatedCount =
    Math.ceil(
      longestLengthMm /
        options.sampleSpacingMm,
    ) + 1;

  return clampInteger(
    estimatedCount,
    options.minSampleCount,
    options.maxSampleCount,
  );
}

function createConstraintPoint(
  path: PanelEdgePath,
  t: number,
): ConstraintPoint {
  if (path.vertexIndices.length === 0) {
    throw new Error(
      `A borda ${path.edgeId} não possui vértices.`,
    );
  }

  if (path.vertexIndices.length === 1) {
    return {
      particleIndex: path.vertexIndices[0],
    };
  }

  const normalizedT = clamp01(t);
  const targetDistance =
    normalizedT * path.lengthMm;

  if (targetDistance <= LENGTH_EPSILON_MM) {
    return {
      particleIndex: path.vertexIndices[0],
    };
  }

  if (
    path.lengthMm - targetDistance <=
    LENGTH_EPSILON_MM
  ) {
    return {
      particleIndex:
        path.vertexIndices[
          path.vertexIndices.length - 1
        ],
    };
  }

  let upperIndex = 1;

  while (
    upperIndex <
      path.cumulativeLengthsMm.length &&
    path.cumulativeLengthsMm[upperIndex] <
      targetDistance
  ) {
    upperIndex += 1;
  }

  upperIndex = Math.min(
    upperIndex,
    path.vertexIndices.length - 1,
  );

  const lowerIndex = Math.max(
    0,
    upperIndex - 1,
  );

  const lowerDistance =
    path.cumulativeLengthsMm[lowerIndex];
  const upperDistance =
    path.cumulativeLengthsMm[upperIndex];

  const segmentLength =
    upperDistance - lowerDistance;

  if (
    segmentLength <= LENGTH_EPSILON_MM
  ) {
    return {
      particleIndex:
        path.vertexIndices[lowerIndex],
    };
  }

  const alpha = clamp01(
    (targetDistance - lowerDistance) /
      segmentLength,
  );

  if (alpha <= PARAMETER_EPSILON) {
    return {
      particleIndex:
        path.vertexIndices[lowerIndex],
    };
  }

  if (alpha >= 1 - PARAMETER_EPSILON) {
    return {
      particleIndex:
        path.vertexIndices[upperIndex],
    };
  }

  return {
    firstParticle:
      path.vertexIndices[lowerIndex],
    secondParticle:
      path.vertexIndices[upperIndex],
    alpha,
  };
}

function edgeRangeLengthMm(
  path: PanelEdgePath,
  range: EdgeRange,
): number {
  return (
    path.lengthMm *
    Math.abs(
      clamp01(range.endT) -
        clamp01(range.startT),
    )
  );
}

function interpolateRangeParameter(
  range: EdgeRange,
  progress: number,
): number {
  const start = clamp01(range.startT);
  const end = clamp01(range.endT);

  return start + (end - start) * clamp01(progress);
}

function representativeVertex(
  point: ConstraintPoint,
): number {
  if ("particleIndex" in point) {
    return point.particleIndex;
  }

  return point.alpha < 0.5
    ? point.firstParticle
    : point.secondParticle;
}

function constraintPointsAreEqual(
  first: ConstraintPoint,
  second: ConstraintPoint,
): boolean {
  return (
    constraintPointKey(first) ===
    constraintPointKey(second)
  );
}

function constraintPointKey(
  point: ConstraintPoint,
): string {
  if ("particleIndex" in point) {
    return `vertex:${point.particleIndex}`;
  }

  return [
    "interpolated",
    point.firstParticle,
    point.secondParticle,
    point.alpha.toFixed(8),
  ].join(":");
}

function rangesAreIdentical(
  first: EdgeRange,
  second: EdgeRange,
): boolean {
  return (
    first.pieceId === second.pieceId &&
    first.edgeId === second.edgeId &&
    Math.abs(first.startT - second.startT) <=
      PARAMETER_EPSILON &&
    Math.abs(first.endT - second.endT) <=
      PARAMETER_EPSILON
  );
}

function rangeSequencesAreIdentical(
  first: readonly EdgeRange[],
  second: readonly EdgeRange[],
): boolean {
  return first.length === second.length
    && first.every((range, index) => rangesAreIdentical(range, second[index]));
}

function treatmentStiffness(
  treatment: SeamTreatment | undefined,
): number {
  switch (treatment ?? "standard") {
    case "standard":
      return 1;

    case "ease":
      return 0.96;

    case "gather":
      return 0.9;

    case "stretch":
      return 0.86;

    case "intentional-mismatch":
      return 0.75;
  }
}

function clampInteger(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.min(
    maximum,
    Math.max(minimum, Math.floor(value)),
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
