import type {
  PatternDart,
  PatternPiece,
  Seam,
} from "../domain/pattern";

/**
 * Vetor 2D em milímetros.
 *
 * Os moldes do editor usam milímetros. A conversão para metros só deve
 * acontecer quando a malha for preparada para a simulação/renderização.
 */
export interface Vector2Mm {
  x: number;
  y: number;
}

/**
 * Vetor 3D em metros.
 *
 * O solver e o Three.js trabalharão em metros para evitar valores muito
 * grandes e facilitar a estabilidade numérica.
 */
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Caminho de uma borda dentro da malha.
 *
 * vertexIndices precisa estar ordenado do início da borda até o final,
 * seguindo a mesma direção usada no molde 2D.
 */
export interface PanelEdgePath {
  edgeId: string;
  pieceId: string;

  /**
   * Índices dos vértices pertencentes à borda.
   */
  vertexIndices: number[];

  /**
   * Distância acumulada em milímetros.
   *
   * Exemplo:
   * [0, 20, 45, 70]
   *
   * O último valor representa o comprimento total da borda.
   */
  cumulativeLengthsMm: number[];

  lengthMm: number;
}

/**
 * Relação entre um ponto original do molde e os vértices produzidos
 * durante a amostragem e triangulação.
 */
export interface SourcePointVertexMapping {
  sourcePointId: string;
  vertexIndices: number[];
}

/**
 * Informações da pence que serão convertidas em topologia real na Fase 2.
 *
 * Nesta primeira fase apenas preservamos os dados, sem fechar a pence ainda.
 */
export interface DartTopology {
  dart: PatternDart;

  /**
   * Será preenchido quando implementarmos o corte topológico da pence.
   */
  legAVertices: number[];
  legBVertices: number[];
  apexVertex: number | null;
}

/**
 * Representação intermediária de um painel.
 *
 * Esta estrutura fica entre o molde 2D e a simulação 3D.
 * Ela não depende do Three.js.
 */
export interface PanelTopology {
  pieceId: string;
  pieceName: string;

  /**
   * Cópia da peça que originou esta topologia.
   */
  sourcePiece: PatternPiece;

  /**
   * Coordenadas 2D em milímetros:
   *
   * [x0, y0, x1, y1, x2, y2, ...]
   */
  positions2DMm: Float32Array;

  /**
   * Índices dos triângulos:
   *
   * [a, b, c, a, c, d, ...]
   */
  triangles: Uint32Array;

  /**
   * Índices dos vértices que pertencem ao contorno externo.
   */
  boundaryVertices: number[];

  /**
   * Mapeamento entre edgeId e caminho ordenado de vértices.
   */
  edges: Map<string, PanelEdgePath>;

  /**
   * Relação entre pontos originais do molde e índices da malha.
   */
  sourcePointVertices: Map<string, number[]>;

  /**
   * Pences preservadas para processamento posterior.
   */
  darts: DartTopology[];

  boundsMm: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
}

/**
 * Uma referência direta a uma partícula da simulação.
 */
export interface ParticleReference {
  particleIndex: number;
}

/**
 * Referência interpolada entre duas partículas.
 *
 * Isso permite costurar bordas com quantidades diferentes de vértices
 * sem obrigar duas bordas a terem exatamente a mesma subdivisão.
 *
 * alpha = 0   -> usa apenas firstParticle
 * alpha = 1   -> usa apenas secondParticle
 * alpha = 0.5 -> ponto no meio dos dois
 */
export interface InterpolatedParticleReference {
  firstParticle: number;
  secondParticle: number;
  alpha: number;
}

export type ConstraintPoint =
  | ParticleReference
  | InterpolatedParticleReference;

/**
 * Restrição que preserva o tamanho das arestas da malha.
 */
export interface DistanceConstraint {
  type: "distance";
  first: number;
  second: number;
  restLength: number;
  stiffness: number;
}

/**
 * Restrição que une duas bordas.
 *
 * Ela pode ligar:
 * - duas peças diferentes;
 * - duas bordas da mesma peça;
 * - pontos interpolados de bordas com subdivisões diferentes.
 */
export interface StitchConstraint {
  type: "stitch";

  seamId: string;

  pieceA: string;
  pieceB: string;

  pointA: ConstraintPoint;
  pointB: ConstraintPoint;

  restDistance: number;
  stiffness: number;
}

/**
 * Restrição opcional para impedir que a peça inteira fique girando ou
 * caindo no espaço enquanto ainda não existe manequim.
 */
export interface AnchorConstraint {
  type: "anchor";
  particleIndex: number;
  target: Vector3;
  stiffness: number;
}

export type ClothConstraint =
  | DistanceConstraint
  | StitchConstraint
  | AnchorConstraint;

/**
 * Uma partícula corresponde normalmente a um vértice da malha.
 */
export interface ClothParticle {
  position: Vector3;
  previousPosition: Vector3;

  /**
   * Posição prevista para o próximo passo da simulação.
   */
  predictedPosition: Vector3;

  /**
   * Massa inversa.
   *
   * 0 significa partícula fixa.
   * 1 significa massa padrão.
   */
  inverseMass: number;
}

/**
 * Intervalo de partículas pertencente a uma peça.
 */
export interface PieceParticleRange {
  pieceId: string;
  start: number;
  count: number;
}

/**
 * Estado completo da simulação de uma roupa.
 */
export interface GarmentSimulationState {
  particles: ClothParticle[];
  constraints: ClothConstraint[];

  /**
   * Permite localizar quais partículas pertencem a cada peça.
   */
  pieceParticleRanges: Map<string, PieceParticleRange>;

  /**
   * Topologias utilizadas para construir este estado.
   */
  panels: Map<string, PanelTopology>;

  /**
   * Costuras que originaram as restrições.
   */
  seams: Seam[];

  /**
   * Número de passos já executados.
   */
  iteration: number;

  /**
   * Indica que o solver encontrou NaN, infinito ou outra condição inválida.
   */
  invalid: boolean;
}

/**
 * Resultado de uma operação de construção.
 *
 * Evita lançar exceções para erros esperados em moldes incompletos.
 */
export type Garment3DResult<T> =
  | {
      ok: true;
      value: T;
      warnings: string[];
    }
  | {
      ok: false;
      errors: string[];
      warnings: string[];
    };

/**
 * Configurações iniciais do solver.
 */
export interface ClothSolverOptions {
  substeps: number;
  constraintIterations: number;
  damping: number;

  /**
   * Gravidade em metros por segundo ao quadrado.
   *
   * Nesta etapa ficará em zero por padrão, pois a roupa ainda não será
   * sustentada por um corpo.
   */
  gravity: Vector3;

  /**
   * Distância máxima que uma partícula pode percorrer em um único passo.
   * Serve como proteção contra explosões numéricas.
   */
  maximumDisplacement: number;
}

export const DEFAULT_CLOTH_SOLVER_OPTIONS: ClothSolverOptions = {
  substeps: 2,
  constraintIterations: 12,
  damping: 0.985,
  gravity: {
    x: 0,
    y: 0,
    z: 0,
  },
  maximumDisplacement: 0.08,
};

export function isDirectParticleReference(
  reference: ConstraintPoint,
): reference is ParticleReference {
  return "particleIndex" in reference;
}

export function isInterpolatedParticleReference(
  reference: ConstraintPoint,
): reference is InterpolatedParticleReference {
  return "firstParticle" in reference;
}

export function cloneVector3(vector: Vector3): Vector3 {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

export function createVector3(
  x = 0,
  y = 0,
  z = 0,
): Vector3 {
  return { x, y, z };
}

export function vectorIsFinite(vector: Vector3): boolean {
  return (
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    Number.isFinite(vector.z)
  );
}