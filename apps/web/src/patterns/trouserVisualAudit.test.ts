import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PatternPiece, PatternPoint } from "../domain/pattern";
import { buildTrouserLogicalAssembly } from "../domain/trouserLogicalAssembly";
import {
  createAllParametricBodyFixtures,
  createParametricBodyFixture,
} from "../testFixtures/parametricBodyFixtures";
import { createGarmentFromTemplate } from "./templateCatalog";

describe("trouser visual evidence", () => {
  it("renders front/back, body comparison and logical assembly diagrams", () => {
    const medium = createParametricBodyFixture("medium");
    const garment = createGarmentFromTemplate(
      "straight-pants",
      medium.supplied,
      medium.bodyType,
      medium.profile,
    );
    const assembly = buildTrouserLogicalAssembly(garment.pieces);
    expect(assembly.valid, assembly.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toBe(true);

    const frontBackSvg = renderFrontBackSvg(garment.pieces);
    const comparisonSvg = renderComparisonSvg();
    const graphSvg = renderAssemblyGraphSvg(assembly);
    for (const svg of [frontBackSvg, comparisonSvg, graphSvg]) {
      expect(svg).toContain("<svg");
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(svg.match(/<path/g)?.length ?? 0).toBeGreaterThan(0);
    }

    const artifactDirectory = process.env.PROMPT07_ARTIFACT_DIR;
    if (!artifactDirectory) return;
    mkdirSync(artifactDirectory, { recursive: true });
    writeFileSync(join(artifactDirectory, "trouser-front-back-medium.svg"), frontBackSvg);
    writeFileSync(join(artifactDirectory, "trouser-body-comparison.svg"), comparisonSvg);
    writeFileSync(join(artifactDirectory, "trouser-assembly-graph.svg"), graphSvg);
    writeFileSync(
      join(artifactDirectory, "prompt07-visual-audit.json"),
      JSON.stringify({
        physicalDevicesValidated: false,
        threeDimensionalPreviewUsedAsEvidence: false,
        templateVersion: garment.parametric?.templateVersion,
        definitions: garment.pieces.map((piece) => ({
          id: piece.id,
          name: piece.name,
          cutQuantity: piece.cutQuantity,
          placementCount: piece.previewPlacements?.length ?? 0,
          pointCount: piece.points.length,
          pathValid: piece.points.every((point) => Number.isFinite(point.xMm) && Number.isFinite(point.yMm)),
        })),
        instances: assembly.instances.map((instance) => ({
          id: instance.id,
          sourcePatternId: instance.sourcePatternId,
          side: instance.bodySide,
          surface: instance.surface,
          mirrored: instance.mirrored,
        })),
        legs: assembly.legs,
        crotch: assembly.crotch,
        openConnectorCount: assembly.openConnectorIds.length,
        diagnostics: assembly.diagnostics,
        scenarios: [
          { name: "front-back-medium", status: "passed", paths: garment.pieces.length },
          { name: "five-body-comparison", status: "passed", cards: createAllParametricBodyFixtures().length },
          { name: "four-instance-assembly-graph", status: "passed", nodes: assembly.instances.length, seams: assembly.seams.length },
        ],
      }, null, 2),
    );
  });
});

function renderFrontBackSvg(pieces: readonly PatternPiece[]): string {
  const cards = pieces.map((piece, index) => renderPieceCard(piece, 60 + index * 560, 100, 500, 1120));
  return svgDocument(
    1180,
    1280,
    `<text x="60" y="54" class="title">Calça reta paramétrica · frente e costas</text>
     <text x="60" y="80" class="subtitle">Molde 2D autoritativo · straight-pants@2 · milímetros</text>
     ${cards.join("\n")}`,
  );
}

function renderComparisonSvg(): string {
  const cards = createAllParametricBodyFixtures().map((fixture, index) => {
    const garment = createGarmentFromTemplate(
      "straight-pants",
      fixture.supplied,
      fixture.bodyType,
      fixture.profile,
    );
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = 40 + column * 620;
    const y = 90 + row * 720;
    const outlines = garment.pieces.map((piece, pieceIndex) =>
      renderPieceOutline(piece, x + 20 + pieceIndex * 285, y + 75, 250, 570),
    ).join("\n");
    return `<g>
      <rect x="${x}" y="${y}" width="580" height="670" rx="16" class="card"/>
      <text x="${x + 20}" y="${y + 38}" class="card-title">${escapeXml(fixture.id)}</text>
      <text x="${x + 20}" y="${y + 61}" class="small">${fixture.supplied.waistMm} cintura · ${fixture.supplied.hipMm} quadril · ${fixture.supplied.heightMm} altura</text>
      ${outlines}
    </g>`;
  });
  return svgDocument(
    1900,
    1500,
    `<text x="40" y="48" class="title">Comparação paramétrica em cinco corpos</text>${cards.join("\n")}`,
  );
}

function renderAssemblyGraphSvg(
  assembly: ReturnType<typeof buildTrouserLogicalAssembly>,
): string {
  const positions: Record<string, { x: number; y: number }> = {
    "straight-pants-front:panel:1": { x: 240, y: 260 },
    "straight-pants-back:panel:1": { x: 240, y: 660 },
    "straight-pants-front:panel:2": { x: 980, y: 260 },
    "straight-pants-back:panel:2": { x: 980, y: 660 },
  };
  const seamLines = assembly.seams.map((seam) => {
    const first = positions[seam.first.instanceId];
    const second = positions[seam.second.instanceId];
    if (!first || !second) return "";
    const x1 = first.x + 150;
    const y1 = first.y + 70;
    const x2 = second.x + 150;
    const y2 = second.y + 70;
    return `<g>
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="seam"/>
      <text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 10}" text-anchor="middle" class="seam-label">${escapeXml(seam.role)}</text>
    </g>`;
  }).join("\n");
  const nodes = assembly.instances.map((instance) => {
    const position = positions[instance.id];
    if (!position) return "";
    return `<g>
      <rect x="${position.x}" y="${position.y}" width="300" height="140" rx="18" class="node"/>
      <text x="${position.x + 18}" y="${position.y + 34}" class="node-title">${escapeXml(instance.sourceDefinitionRole)} · ${escapeXml(instance.bodySide)}</text>
      <text x="${position.x + 18}" y="${position.y + 62}" class="small">${escapeXml(instance.id)}</text>
      <text x="${position.x + 18}" y="${position.y + 88}" class="small">origem: ${escapeXml(instance.sourcePatternId)}</text>
      <text x="${position.x + 18}" y="${position.y + 114}" class="small">espelhado: ${instance.mirrored ? "sim" : "não"}</text>
    </g>`;
  }).join("\n");
  const open = assembly.openConnectorIds.map((id, index) =>
    `<text x="70" y="${980 + index * 24}" class="small">aberto · ${escapeXml(id)}</text>`,
  ).join("\n");
  return svgDocument(
    1500,
    1220,
    `<text x="60" y="54" class="title">Grafo lógico da calça · quatro instâncias</text>
     <text x="60" y="82" class="subtitle">Duas pernas tubulares, gancho contínuo, cintura e barras abertas</text>
     ${seamLines}
     ${nodes}
     <text x="60" y="940" class="card-title">Conectores deliberadamente abertos</text>
     ${open}`,
  );
}

function renderPieceCard(
  piece: PatternPiece,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" class="card"/>
    <text x="${x + 24}" y="${y + 42}" class="card-title">${escapeXml(piece.name)}</text>
    <text x="${x + 24}" y="${y + 69}" class="small">${escapeXml(piece.id)} · cortar ${piece.cutQuantity ?? 1}x</text>
    ${renderPieceOutline(piece, x + 35, y + 90, width - 70, height - 135)}
  </g>`;
}

function renderPieceOutline(
  piece: PatternPiece,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const bounds = pieceBounds(piece);
  const scale = Math.min(width / Math.max(bounds.width, 1), height / Math.max(bounds.height, 1));
  const transform = (point: { xMm: number; yMm: number }) => ({
    x: x + (point.xMm - bounds.minX) * scale,
    y: y + (point.yMm - bounds.minY) * scale,
  });
  const path = contourPath(piece.points, transform);
  const lines = (piece.internalLines ?? []).map((line) => {
    const start = line.nodes[0];
    const end = line.nodes[line.nodes.length - 1];
    if (!start || !end) return "";
    const a = transform(start);
    const b = transform(end);
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="reference"/>`;
  }).join("\n");
  const grain = piece.grainline
    ? (() => {
        const a = transform(piece.grainline!.start);
        const b = transform(piece.grainline!.end);
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="grain" marker-end="url(#arrow)"/>`;
      })()
    : "";
  const darts = (piece.darts ?? []).map((dart) => {
    const legA = transform(dart.legA);
    const legB = transform(dart.legB);
    const apex = transform(dart.apex);
    return `<path d="M ${legA.x} ${legA.y} L ${apex.x} ${apex.y} L ${legB.x} ${legB.y}" class="dart"/>`;
  }).join("\n");
  return `<g><path d="${path}" class="pattern"/>${lines}${grain}${darts}</g>`;
}

function contourPath(
  points: readonly PatternPoint[],
  transform: (point: { xMm: number; yMm: number }) => { x: number; y: number },
): string {
  if (points.length === 0) return "";
  const first = transform(points[0]);
  const commands = [`M ${first.x} ${first.y}`];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const end = transform(next);
    if (current.handleOut || next.handleIn) {
      const controlA = transform({
        xMm: current.xMm + (current.handleOut?.xMm ?? 0),
        yMm: current.yMm + (current.handleOut?.yMm ?? 0),
      });
      const controlB = transform({
        xMm: next.xMm + (next.handleIn?.xMm ?? 0),
        yMm: next.yMm + (next.handleIn?.yMm ?? 0),
      });
      commands.push(`C ${controlA.x} ${controlA.y} ${controlB.x} ${controlB.y} ${end.x} ${end.y}`);
    } else {
      commands.push(`L ${end.x} ${end.y}`);
    }
  }
  commands.push("Z");
  return commands.join(" ");
}

function pieceBounds(piece: PatternPiece) {
  const xs = piece.points.map((point) => point.xMm);
  const ys = piece.points.map((point) => point.yMm);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function svgDocument(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z"/></marker>
  </defs>
  <style>
    svg { background: #f7f4ee; font-family: Inter, Arial, sans-serif; }
    .title { font-size: 28px; font-weight: 700; fill: #161616; }
    .subtitle { font-size: 15px; fill: #555; }
    .card { fill: #fff; stroke: #c8c2b8; stroke-width: 2; }
    .card-title, .node-title { font-size: 20px; font-weight: 700; fill: #222; }
    .small { font-size: 13px; fill: #555; }
    .pattern { fill: #e7ddd0; fill-opacity: .72; stroke: #171717; stroke-width: 2.3; vector-effect: non-scaling-stroke; }
    .reference { stroke: #777; stroke-width: 1.2; stroke-dasharray: 7 5; vector-effect: non-scaling-stroke; }
    .grain { stroke: #111; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
    .dart { fill: none; stroke: #8a3f2e; stroke-width: 1.8; vector-effect: non-scaling-stroke; }
    .node { fill: #fff; stroke: #272727; stroke-width: 2; }
    .seam { stroke: #3f5a76; stroke-width: 4; }
    .seam-label { font-size: 14px; font-weight: 700; fill: #23384e; paint-order: stroke; stroke: #f7f4ee; stroke-width: 6; }
  </style>
  ${body}
</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  }[character] ?? character));
}
