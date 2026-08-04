import {
  getPatternEdges,
  type EdgeFinish,
  type PatternEdge,
  type PatternPiece,
  type SegmentRole,
} from "./pattern";

export type EdgeAssemblyClassification =
  | "must-sew"
  | "intentional-open"
  | "finished-open"
  | "fold"
  | "undefined";

export interface ClassifiedPatternEdge {
  pieceId: string;
  edgeId: string;
  role: SegmentRole;
  finish?: EdgeFinish;
  classification: EdgeAssemblyClassification;
  reason: string;
}

const MUST_SEW_ROLES = new Set<SegmentRole>([
  "shoulder",
  "frontArmhole",
  "backArmhole",
  "sideSeam",
  "sleeveCapFront",
  "sleeveCapBack",
  "inseam",
  "outseam",
  "frontCrotch",
  "backCrotch",
  "dartLeg",
]);

const INTENTIONAL_OPEN_ROLES = new Set<SegmentRole>([
  "neckline",
  "waist",
  "hem",
]);

/**
 * Classifica uma borda sem confundir abertura intencional com montagem
 * incompleta. Decotes, barras, cinturas e dobras não são erros por padrão.
 */
export function classifyPatternEdge(
  piece: PatternPiece,
  edge: PatternEdge,
): ClassifiedPatternEdge {
  const role = edge.role ?? "other";
  const finish = piece.edgeFinishes?.[edge.id];
  const inferredFoldEdgeId = piece.cutOnFold
    ? inferFoldEdgeId(piece)
    : undefined;

  if (role === "fold" || edge.id === inferredFoldEdgeId) {
    return {
      pieceId: piece.id,
      edgeId: edge.id,
      role,
      finish,
      classification: "fold",
      reason: "Linha de dobra do tecido.",
    };
  }

  if (finish !== undefined) {
    return {
      pieceId: piece.id,
      edgeId: edge.id,
      role,
      finish,
      classification: "finished-open",
      reason: finishReason(finish),
    };
  }

  if (INTENTIONAL_OPEN_ROLES.has(role)) {
    return {
      pieceId: piece.id,
      edgeId: edge.id,
      role,
      classification: "intentional-open",
      reason: intentionalOpenReason(role),
    };
  }

  if (MUST_SEW_ROLES.has(role)) {
    return {
      pieceId: piece.id,
      edgeId: edge.id,
      role,
      classification: "must-sew",
      reason: `A função ${role} normalmente precisa de uma costura correspondente.`,
    };
  }

  return {
    pieceId: piece.id,
    edgeId: edge.id,
    role,
    classification: "undefined",
    reason: "A função desta borda ainda não foi definida.",
  };
}

function inferFoldEdgeId(piece: PatternPiece): string | undefined {
  const xs = piece.points.map((point) => point.xMm);
  const ys = piece.points.map((point) => point.yMm);

  if (xs.length === 0 || ys.length === 0) return undefined;

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const tolerance = Math.max(
    2,
    Math.min(maxX - minX, maxY - minY) * 0.015,
  );

  return getPatternEdges(piece)
    .map((edge) => {
      const start = piece.points.find((point) => point.id === edge.startPointId);
      const end = piece.points.find((point) => point.id === edge.endPointId);

      if (!start || !end) return null;

      const vertical = Math.abs(start.xMm - end.xMm) <= tolerance;
      const horizontal = Math.abs(start.yMm - end.yMm) <= tolerance;
      const length = Math.hypot(
        end.xMm - start.xMm,
        end.yMm - start.yMm,
      );
      let peripheral = false;

      if (vertical) {
        const x = (start.xMm + end.xMm) / 2;
        peripheral =
          Math.abs(x - minX) <= tolerance ||
          Math.abs(x - maxX) <= tolerance;
      } else if (horizontal) {
        const y = (start.yMm + end.yMm) / 2;
        peripheral =
          Math.abs(y - minY) <= tolerance ||
          Math.abs(y - maxY) <= tolerance;
      }

      return peripheral ? { edgeId: edge.id, length } : null;
    })
    .filter(
      (candidate): candidate is { edgeId: string; length: number } =>
        candidate !== null,
    )
    .sort((left, right) => right.length - left.length)[0]?.edgeId;
}

function finishReason(finish: EdgeFinish): string {
  switch (finish) {
    case "raw":
      return "Borda marcada para permanecer a fio.";
    case "hem":
      return "Borda finalizada com bainha.";
    case "binding":
      return "Borda finalizada com viés.";
    case "facing":
      return "Borda finalizada com revel.";
    case "elastic":
      return "Borda finalizada com elástico.";
  }
}

function intentionalOpenReason(role: SegmentRole): string {
  switch (role) {
    case "neckline":
      return "Decote aberto intencionalmente.";
    case "waist":
      return "Cintura aberta ou aguardando cós.";
    case "hem":
      return "Barra aberta para acabamento.";
    default:
      return "Abertura intencional.";
  }
}
