import { describe, expect, it } from "vitest";
import {
  garmentDraftToPatternDocumentV3,
  patternDocumentV3ToGarmentDraft,
} from "./patternDocumentV3";
import {
  createDefaultFabricSource,
} from "./fabric";
import {
  getPatternEdges,
  migrateLegacyPieceToSegments,
  type GarmentDraft,
  type InternalPath,
  type PatternPiece,
  type PatternPoint,
} from "./pattern";
import { samplePatternContour } from "./polygonGeometry";
import {
  analyzeInternalPath,
  applyInternalPathOperation,
  createInternalPath,
  normalizeDartPathGeometry,
  setInternalPathSegmentKind,
} from "./internalPaths";

function point(id: string, xMm: number, yMm: number, handles: Partial<Pick<PatternPoint, "handleIn" | "handleOut">> = {}): PatternPoint {
  return { id, xMm, yMm, ...handles };
}

function piece(id = "piece", width = 200, height = 180): PatternPiece {
  return migrateLegacyPieceToSegments({
    id,
    name: id,
    seamAllowanceMm: 10,
    cutQuantity: 1,
    fabricId: "fabric-default",
    points: [
      point(`${id}:a`, 0, 0),
      point(`${id}:b`, width, 0),
      point(`${id}:c`, width, height),
      point(`${id}:d`, 0, height),
    ],
    grainline: { start: { xMm: width / 2, yMm: 20 }, end: { xMm: width / 2, yMm: height - 20 } },
    annotations: [{ id: `${id}:note`, label: "Centro", xMm: width / 2, yMm: height / 2 }],
  });
}

function curvedPiece(): PatternPiece {
  return migrateLegacyPieceToSegments({
    id: "curved-body",
    name: "Corpo curvo",
    seamAllowanceMm: 10,
    cutQuantity: 1,
    fabricId: "fabric-default",
    points: [
      point("curve:a", 0, 0, { handleOut: { xMm: 65, yMm: -35 } }),
      point("curve:b", 200, 0, { handleIn: { xMm: -65, yMm: -35 } }),
      point("curve:c", 200, 180, { handleOut: { xMm: -60, yMm: 35 } }),
      point("curve:d", 0, 180, { handleIn: { xMm: 60, yMm: 35 } }),
    ],
  });
}

function garment(source: PatternPiece): GarmentDraft {
  return {
    id: "garment",
    templateId: "custom",
    name: "Teste",
    description: "Teste de caminhos internos",
    bodyType: "feminine",
    measurements: {
      heightMm: 1700,
      bustMm: 900,
      waistMm: 720,
      hipMm: 980,
      shoulderWidthMm: 400,
      torsoLengthMm: 440,
      armLengthMm: 590,
      inseamMm: 780,
    },
    fabrics: [createDefaultFabricSource()],
    pieces: [source],
    workspaceStates: [{
      pieceId: source.id,
      transform: { pieceId: source.id, xMm: 35, yMm: 48, rotationDeg: 12 },
      visible: true,
      locked: false,
    }],
  };
}

function attach(source: PatternPiece, path: InternalPath): PatternPiece {
  return { ...source, internalLines: [...(source.internalLines ?? []), path] };
}

function area(source: PatternPiece): number {
  const points = samplePatternContour(source.points);
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twice += current.xMm * next.yMm - next.xMm * current.yMm;
  }
  return Math.abs(twice) / 2;
}

function expectValidTopology(source: PatternPiece): void {
  const nodes = new Set(source.nodes?.map((node) => node.id));
  expect(nodes.size).toBeGreaterThanOrEqual(3);
  for (const segment of source.segments ?? []) {
    expect(nodes.has(segment.startNodeId)).toBe(true);
    expect(nodes.has(segment.endNodeId)).toBe(true);
  }
  for (const contour of source.contours ?? []) {
    const segments = new Set(source.segments?.map((segment) => segment.id));
    expect(contour.segmentIds.every((id) => segments.has(id))).toBe(true);
  }
}

function expectNoOrphanSeams(result: GarmentDraft): void {
  for (const seam of result.seams ?? []) {
    for (const range of [seam.first, seam.second]) {
      const owner = result.pieces.find((candidate) => candidate.id === range.pieceId);
      expect(owner).toBeDefined();
      expect(getPatternEdges(owner!).some((edge) => edge.id === range.edgeId)).toBe(true);
    }
  }
}

describe("InternalPath e operações geométricas", () => {
  it.each([
    ["perna-apice-perna", [{ xMm: 70, yMm: 0 }, { xMm: 120, yMm: 95 }, { xMm: 170, yMm: 0 }]],
    ["perna-invertida-apice-perna", [{ xMm: 170, yMm: 0 }, { xMm: 120, yMm: 95 }, { xMm: 70, yMm: 0 }]],
    ["apice-perna-perna", [{ xMm: 120, yMm: 95 }, { xMm: 70, yMm: 0 }, { xMm: 170, yMm: 0 }]],
  ])("normaliza a pence em V por geometria, não por ordem: %s", (_name, points) => {
    const source = piece("dart-order", 240, 320);
    const normalized = normalizeDartPathGeometry(source, createInternalPath(source.id, "dart", points));

    expect(normalized.valid).toBe(true);
    expect(normalized.diagnostics).toEqual([]);
    expect(normalized.geometry).toMatchObject({
      legA: { xMm: 70, yMm: 0 },
      apex: { xMm: 120, yMm: 95 },
      legB: { xMm: 170, yMm: 0 },
      widthMm: 100,
    });
    expect(normalized.geometry?.path.metadata).toMatchObject({
      dartBoundaryAnchorVersion: 1,
      dartLegAEdgeId: expect.any(String),
      dartLegBEdgeId: expect.any(String),
    });
  });

  it.each([
    ["muito pequena", [{ xMm: 119.9, yMm: 0 }, { xMm: 120, yMm: 0.1 }, { xMm: 120.1, yMm: 0 }]],
    ["muito grande", [{ xMm: 1, yMm: 0 }, { xMm: 120, yMm: 319 }, { xMm: 239, yMm: 0 }]],
    ["estreita e longa", [{ xMm: 118, yMm: 0 }, { xMm: 120, yMm: 280 }, { xMm: 122, yMm: 0 }]],
    ["larga e curta", [{ xMm: 25, yMm: 0 }, { xMm: 120, yMm: 2 }, { xMm: 215, yMm: 0 }]],
  ])("aceita uma pence %s sem proporção estética", (_name, points) => {
    const source = piece(`dart-${_name}`, 240, 320);
    const normalized = normalizeDartPathGeometry(source, createInternalPath(source.id, "dart", points));
    expect(normalized.valid).toBe(true);
    expect(normalized.geometry?.widthMm).toBeGreaterThan(0);
    expect(normalized.geometry?.lengthMm).toBeGreaterThan(0);
  });

  it("rejeita somente um V estruturalmente ambíguo com diagnóstico sem ordem de clique", () => {
    const source = piece("dart-ambiguous", 240, 320);
    const normalized = normalizeDartPathGeometry(source, createInternalPath(source.id, "dart", [
      { xMm: 60, yMm: 80 },
      { xMm: 120, yMm: 120 },
      { xMm: 180, yMm: 80 },
    ]));
    expect(normalized.valid).toBe(false);
    expect(normalized.diagnostics.map((diagnostic) => diagnostic.message)).toContain("Não foi possível identificar duas pernas da pence.");
    expect(normalized.diagnostics.map((diagnostic) => diagnostic.message).join(" ")).not.toMatch(/primeiro|ordem/i);
  });

  it("corta por um caminho reto e conserva a área combinada", () => {
    const source = piece();
    const path = createInternalPath(source.id, "cut", [
      { xMm: -20, yMm: 90 },
      { xMm: 220, yMm: 90 },
    ]);
    const input = garment(attach(source, path));
    const result = applyInternalPathOperation(input, source.id, path.id);

    expect(result.ok).toBe(true);
    expect(result.createdPieceIds).toHaveLength(2);
    const children = result.createdPieceIds.map((id) => result.garment.pieces.find((candidate) => candidate.id === id)!);
    children.forEach(expectValidTopology);
    expect(Math.abs(children.reduce((sum, child) => sum + area(child), 0) - area(source))).toBeLessThan(1.5);
    expect(result.garment.workspaceStates?.every((state) => state.transform.xMm === 35)).toBe(true);
    expectNoOrphanSeams(result.garment);
  });

  it("corta por caminho curvo com múltiplos segmentos", () => {
    const source = piece("multi", 240, 200);
    let path = createInternalPath(source.id, "cut", [
      { xMm: -30, yMm: 65 },
      { xMm: 80, yMm: 140 },
      { xMm: 160, yMm: 55 },
      { xMm: 270, yMm: 120 },
    ]);
    path = setInternalPathSegmentKind(path, path.segments[0].id, "cubic");
    path = setInternalPathSegmentKind(path, path.segments[2].id, "cubic");
    const analysis = analyzeInternalPath(source, path);
    expect(analysis.valid).toBe(true);
    expect(analysis.intersections).toHaveLength(2);

    const result = applyInternalPathOperation(garment(attach(source, path)), source.id, path.id);
    expect(result.ok).toBe(true);
    expect(result.garment.pieces.filter((candidate) => result.createdPieceIds.includes(candidate.id)).some((candidate) => candidate.segments?.some((segment) => segment.kind === "cubic"))).toBe(true);
  });

  it("preserva curvas do contorno externo ao cortar", () => {
    const source = curvedPiece();
    const path = createInternalPath(source.id, "cut", [
      { xMm: -30, yMm: 82 },
      { xMm: 230, yMm: 96 },
    ], { curved: true });
    const result = applyInternalPathOperation(garment(attach(source, path)), source.id, path.id);
    expect(result.ok).toBe(true);
    const children = result.createdPieceIds.map((id) => result.garment.pieces.find((candidate) => candidate.id === id)!);
    expect(children.some((child) => child.segments?.some((segment) => segment.kind === "cubic" && segment.id.includes("cut-result")))).toBe(true);
    expect(Math.abs(children.reduce((sum, child) => sum + area(child), 0) - area(source))).toBeLessThan(6);
  });

  it("rejeita tangência sem modificar o documento", () => {
    const source = piece("tangent");
    const path = createInternalPath(source.id, "cut", [
      { xMm: -20, yMm: 0 },
      { xMm: 220, yMm: 0 },
    ]);
    const input = garment(attach(source, path));
    const before = structuredClone(input);
    const analysis = analyzeInternalPath(source, path);
    const result = applyInternalPathOperation(input, source.id, path.id);
    expect(analysis.valid).toBe(false);
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === "tangent-intersection")).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.garment).toEqual(before);
  });

  it("rejeita caminhos com mais de duas interseções", () => {
    const source = piece("many", 200, 200);
    const path = createInternalPath(source.id, "cut", [
      { xMm: -20, yMm: 35 },
      { xMm: 220, yMm: 35 },
      { xMm: -20, yMm: 100 },
      { xMm: 220, yMm: 165 },
    ]);
    const analysis = analyzeInternalPath(source, path);
    expect(analysis.valid).toBe(false);
    expect(analysis.intersections.length).toBeGreaterThan(2);
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === "too-many-intersections")).toBe(true);
  });

  it("corta e mantém costurado como um SeamGroup V3 por arco", () => {
    const source = piece("joined", 230, 180);
    let path = createInternalPath(source.id, "cut-and-sew", [
      { xMm: -15, yMm: 55 },
      { xMm: 110, yMm: 135 },
      { xMm: 245, yMm: 72 },
    ], { curved: true });
    path = setInternalPathSegmentKind(path, path.segments[1].id, "cubic");
    const result = applyInternalPathOperation(garment(attach(source, path)), source.id, path.id, { keepJoined: true });
    expect(result.ok).toBe(true);
    expect(result.createdSeamGroupId).toBeTruthy();
    const parts = result.garment.seams?.filter((seam) => seam.groupId === result.createdSeamGroupId) ?? [];
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expectNoOrphanSeams(result.garment);

    const document = garmentDraftToPatternDocumentV3(result.garment);
    const group = document.seamGroups.find((candidate) => candidate.id === result.createdSeamGroupId);
    expect(group).toBeDefined();
    expect(group?.first.length).toBe(parts.length);
    expect(group?.second.length).toBe(parts.length);
    const restored = patternDocumentV3ToGarmentDraft(document);
    const restoredGroup = restored.seams?.find((seam) => seam.groupId === result.createdSeamGroupId);
    expect(restoredGroup).toBeDefined();
    expect(restoredGroup?.firstRanges).toEqual(group?.first);
    expect(restoredGroup?.secondRanges).toEqual(group?.second);
  });

  it.each([
    ["saia", 240, 320, { xMm: 120, yMm: 0 }, { xMm: 120, yMm: 95 }, 28],
    ["corpo", 280, 250, { xMm: 0, yMm: 125 }, { xMm: 95, yMm: 125 }, 34],
  ])("converte uma pence real de %s em pernas topológicas", (_name, width, height, center, apex, dartWidth) => {
    const source = piece(`dart-${_name}`, width as number, height as number);
    const path = {
      ...createInternalPath(source.id, "dart", [center as { xMm: number; yMm: number }, apex as { xMm: number; yMm: number }]),
      metadata: { geometryVersion: 1, snapEnabled: true, dartWidthMm: dartWidth as number },
    };
    const result = applyInternalPathOperation(garment(attach(source, path)), source.id, path.id);
    expect(result.ok).toBe(true);
    const updated = result.garment.pieces.find((candidate) => candidate.id === source.id)!;
    const dart = updated.darts?.at(-1);
    expect(dart?.closed).toBe(true);
    expect(dart?.closure).toEqual(expect.objectContaining({ kind: "paired-legs", state: "closed", targetDistanceMm: 0 }));
    expect(dart?.legSegmentIds).toHaveLength(2);
    const dartPath = updated.internalLines?.find((candidate) => candidate.id === path.id) as InternalPath;
    expect(dartPath.segments).toHaveLength(3);
    expect(dartPath.segments.some((segment) => segment.id === dart?.legSegmentIds?.[0])).toBe(true);
  });
});
