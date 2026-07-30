import {
  createSeamAllowanceContour,
  samplePatternContour,
} from "../domain/polygonGeometry";
import type { PatternPoint, PatternSnapshot } from "../domain/pattern";

const EXPORT_PADDING_MM = 20;

export function createPatternSvg(snapshot: PatternSnapshot): string {
  const points = snapshot.piece.points;
  const sampledPattern = samplePatternContour(points);
  const seamPoints = createSeamAllowanceContour(
    sampledPattern,
    snapshot.piece.seamAllowanceMm,
  );
  const cuttingLine =
    seamPoints && snapshot.piece.seamAllowanceMm > 0
      ? seamPoints
      : sampledPattern;
  const bounds = contourBounds(cuttingLine);
  const width = bounds.maxX - bounds.minX + EXPORT_PADDING_MM * 2;
  const height = bounds.maxY - bounds.minY + EXPORT_PADDING_MM * 2;
  const transformPoint = (point: PatternPoint) => ({
    ...point,
    xMm: point.xMm - bounds.minX + EXPORT_PADDING_MM,
    yMm: point.yMm - bounds.minY + EXPORT_PADDING_MM,
  });
  const transformedPattern = points.map(transformPoint);
  const transformedCuttingLine = cuttingLine.map(transformPoint);
  const hasSeparateCuttingLine =
    seamPoints !== null && snapshot.piece.seamAllowanceMm > 0;
  const cuttingPath = hasSeparateCuttingLine
    ? contourPath(transformedCuttingLine)
    : patternContourPath(transformedPattern);
  const title = escapeXml(snapshot.piece.name);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(width)}mm" height="${formatNumber(height)}mm" viewBox="0 0 ${formatNumber(width)} ${formatNumber(height)}">
  <title>${title}</title>
  <g fill="none" stroke="#000">
    <path id="cutting-line" d="${cuttingPath}" stroke-width="0.5" />
    ${hasSeparateCuttingLine ? `<path id="stitching-line" d="${patternContourPath(transformedPattern)}" stroke-width="0.35" stroke-dasharray="4 2" />` : ""}
  </g>
  <text x="${EXPORT_PADDING_MM}" y="10" font-family="Arial, sans-serif" font-size="5">${title}</text>
  <text x="${EXPORT_PADDING_MM}" y="${formatNumber(height - 7)}" font-family="Arial, sans-serif" font-size="4">Margem de costura: ${formatNumber(snapshot.piece.seamAllowanceMm)} mm · escala vetorial 1:1</text>
</svg>`;
}

function patternContourPath(points: readonly PatternPoint[]): string {
  const commands = [`M ${formatNumber(points[0].xMm)} ${formatNumber(points[0].yMm)}`];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current.handleOut || next.handleIn) {
      commands.push(
        `C ${formatNumber(current.xMm + (current.handleOut?.xMm ?? 0))} ${formatNumber(current.yMm + (current.handleOut?.yMm ?? 0))} ` +
          `${formatNumber(next.xMm + (next.handleIn?.xMm ?? 0))} ${formatNumber(next.yMm + (next.handleIn?.yMm ?? 0))} ` +
          `${formatNumber(next.xMm)} ${formatNumber(next.yMm)}`,
      );
    } else {
      commands.push(`L ${formatNumber(next.xMm)} ${formatNumber(next.yMm)}`);
    }
  }
  return `${commands.join(" ")} Z`;
}

export function exportPatternAsSvg(snapshot: PatternSnapshot) {
  const blob = new Blob([createPatternSvg(snapshot)], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slugify(snapshot.piece.name)}.svg`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function contourPath(points: readonly PatternPoint[]): string {
  return `${points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${formatNumber(point.xMm)} ${formatNumber(point.yMm)}`,
    )
    .join(" ")} Z`;
}

function contourBounds(points: readonly PatternPoint[]) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.xMm);
    maxX = Math.max(maxX, point.xMm);
    minY = Math.min(minY, point.yMm);
    maxY = Math.max(maxY, point.yMm);
  }

  return { minX, maxX, minY, maxY };
}

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character];
  });
}
