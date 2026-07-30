import { PatternSnapshot } from "../domain/pattern";

export function exportPatternAsSvg(snapshot: PatternSnapshot) {
  const points = snapshot.piece.points;
  const minX = Math.min(...points.map((point) => point.xMm));
  const maxX = Math.max(...points.map((point) => point.xMm));
  const minY = Math.min(...points.map((point) => point.yMm));
  const maxY = Math.max(...points.map((point) => point.yMm));
  const padding = 30;
  const width = maxX - minX + padding * 2;
  const height = maxY - minY + padding * 2;
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.xMm - minX + padding} ${point.yMm - minY + padding}`)
    .join(" ");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">
  <title>${escapeXml(snapshot.piece.name)}</title>
  <path d="${path} Z" fill="none" stroke="#000" stroke-width="0.5" />
  <text x="${padding}" y="${padding - 8}" font-family="Arial" font-size="6">${escapeXml(snapshot.piece.name)}</text>
</svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slugify(snapshot.piece.name)}.svg`;
  anchor.click();
  URL.revokeObjectURL(url);
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
