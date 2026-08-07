import { buildCutPreviewRegions } from "../domain/modelingCut";
import type { InternalPathAnalysis } from "../domain/internalPaths";
import type { InternalPath, PatternPiece, PatternVector } from "../domain/pattern";

export function CutRegionPreview({
  piece,
  path,
  analysis,
}: {
  piece: PatternPiece;
  path: InternalPath;
  analysis: InternalPathAnalysis | null;
}) {
  const regions = buildCutPreviewRegions(piece, path, analysis);
  if (regions.length !== 2) return null;
  const points = regions.flatMap((region) => region.points);
  const bounds = boundsOf(points);
  const padding = 8;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const viewBox = `${bounds.minX - padding} ${bounds.minY - padding} ${width + padding * 2} ${height + padding * 2}`;
  return (
    <div className="cut-region-preview" aria-label="Prévia das duas regiões do corte">
      <svg viewBox={viewBox} width="150" height="92" role="img" aria-label="Duas regiões que serão geradas pelo corte">
        {regions.map((region, index) => (
          <polygon
            key={region.id}
            points={region.points.map((point) => `${point.xMm},${point.yMm}`).join(" ")}
            fill={index === 0 ? "rgba(92, 131, 173, .28)" : "rgba(194, 139, 71, .28)"}
            stroke={index === 0 ? "#5c83ad" : "#a46d2e"}
            strokeWidth={Math.max(width, height) / 180}
          />
        ))}
      </svg>
      <span>
        Prévia · A {(regions[0].areaMm2 / 100).toFixed(1)} cm² · B {(regions[1].areaMm2 / 100).toFixed(1)} cm²
      </span>
    </div>
  );
}

function boundsOf(points: PatternVector[]) {
  return {
    minX: Math.min(...points.map((point) => point.xMm)),
    minY: Math.min(...points.map((point) => point.yMm)),
    maxX: Math.max(...points.map((point) => point.xMm)),
    maxY: Math.max(...points.map((point) => point.yMm)),
  };
}
