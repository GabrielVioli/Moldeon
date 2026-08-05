from pathlib import Path
import re

def sub(src, pattern, repl, label, flags=re.S):
    out, count = re.subn(pattern, repl, src, count=1, flags=flags)
    if count != 1: raise SystemExit(f"{label}: {count}")
    return out

p=Path('apps/web/src/domain/internalPaths.ts'); s=p.read_text()
s=sub(s,r'function samplePathWithMetadata\(path: InternalPath\): SampledPathPoint\[\] \{.*?\n\}\n\nfunction sampleContourWithMetadata', '''function samplePathWithMetadata(path: InternalPath): SampledPathPoint[] {
  const nodes = new Map(path.nodes.map((node) => [node.id, node]));
  const result: SampledPathPoint[] = [];
  let walked = 0;
  for (const segment of path.segments) {
    const start = nodes.get(segment.startNodeId); const end = nodes.get(segment.endNodeId);
    if (!start || !end) continue;
    const steps = segment.kind === "cubic" ? PATH_CURVE_STEPS : 1;
    let previous: PatternVector | null = null;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps; const point = pointOnInternalSegment(segment, start, end, t);
      if (previous) walked += distance(previous, point);
      result.push({ ...point, segmentId: segment.id, segmentT: t, distanceMm: walked });
      previous = point;
    }
  }
  return result;
}

function sampleContourWithMetadata''','sample path')
s=sub(s,r'function sampleContourWithMetadata\(pieceValue: PatternPiece\): SampledContourPoint\[\] \{.*?\n\}\n\nfunction estimateSplitAreas', '''function sampleContourWithMetadata(pieceValue: PatternPiece): SampledContourPoint[] {
  const piece = migrateLegacyPieceToSegments(structuredClone(pieceValue));
  const nodes = new Map((piece.nodes ?? []).map((node) => [node.id, node]));
  const segments = new Map((piece.segments ?? []).map((segment) => [segment.id, segment]));
  const ordered = piece.contours?.find((contour) => contour.closed)?.segmentIds ?? [];
  const result: SampledContourPoint[] = [];
  let walked = 0;
  for (const id of ordered) {
    const segment = segments.get(id); const start = segment && nodes.get(segment.startNodeId); const end = segment && nodes.get(segment.endNodeId);
    if (!segment || !start || !end) continue;
    const steps = segment.kind === "cubic" ? CONTOUR_CURVE_STEPS : 1;
    let previous: PatternVector | null = null;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps; const point = pointOnPatternSegment(segment, start, end, t);
      if (previous) walked += distance(previous, point);
      result.push({ ...point, edgeId: segment.id, edgeT: t, distanceMm: walked });
      previous = point;
    }
  }
  return result;
}

function estimateSplitAreas''','sample contour')
s=sub(s,r'  const nearBoundaryWithoutCrossing =.*?\n  if \(intersections.length < 2\)', '''  const boundaryTangency = findBoundaryTangency(sampledPath, sampledContour);
  const nearBoundaryWithoutCrossing = intersections.length < 2 && sampledPath.some((point) => nearestContourDistance(sampledContour, point) <= INTERSECTION_EPSILON_MM * 3);
  if (intersections.some((intersection) => intersection.tangent) || boundaryTangency || nearBoundaryWithoutCrossing) {
    diagnostics.push(errorDiagnostic("tangent-intersection", "O caminho apenas tangencia ou acompanha a borda. Faça-o atravessar o contorno com um ângulo perceptível.", intersections.find((intersection) => intersection.tangent) ?? boundaryTangency));
  }
  if (intersections.length < 2)''','tangency')
s=s.replace('  const nearestIndex = nearestContourIndex(contour, center);\n  const centerDistance = contour[nearestIndex]?.distanceMm ?? 0;','  const centerDistance = nearestContourProjection(contour, center).distanceAlongMm;')
s=sub(s,r'function nearestContourDistance\(contour: SampledContourPoint\[\], point: PatternVector\): number \{.*?\n\}\n\nfunction nearestSampleIndex', '''function nearestContourDistance(contour: SampledContourPoint[], point: PatternVector): number {
  return nearestContourProjection(contour, point).distanceMm;
}
function nearestContourProjection(contour: SampledContourPoint[], point: PatternVector) {
  let best = { distanceMm: Number.POSITIVE_INFINITY, distanceAlongMm: 0, point: vector(contour[0] ?? point) };
  for (let i=0;i<contour.length-1;i+=1) {
    const a=contour[i], b=contour[i+1]; if (a.edgeId!==b.edgeId) continue;
    const hit=projectPointOnSegment(point,a,b); if(hit.distanceMm>=best.distanceMm) continue;
    best={distanceMm:hit.distanceMm,distanceAlongMm:a.distanceMm+(b.distanceMm-a.distanceMm)*hit.t,point:lerp(a,b,hit.t)};
  }
  return best;
}
function findBoundaryTangency(path: SampledPathPoint[], contour: SampledContourPoint[]): PatternVector | undefined {
  for(let i=0;i<path.length-1;i+=1){const a=path[i],b=path[i+1];if(a.segmentId!==b.segmentId||distance(a,b)<1e-9)continue;
    for(let j=0;j<contour.length-1;j+=1){const c=contour[j],d=contour[j+1];if(c.edgeId!==d.edgeId||distance(c,d)<1e-9)continue;
      const av=subtract(b,a),cv=subtract(d,c),sine=Math.abs(cross(av,cv))/Math.max(1e-9,length(av)*length(cv));if(sine>=TANGENCY_SINE)continue;
      const overlapX=Math.max(Math.min(a.xMm,b.xMm),Math.min(c.xMm,d.xMm))<=Math.min(Math.max(a.xMm,b.xMm),Math.max(c.xMm,d.xMm))+INTERSECTION_EPSILON_MM*3;
      const overlapY=Math.max(Math.min(a.yMm,b.yMm),Math.min(c.yMm,d.yMm))<=Math.min(Math.max(a.yMm,b.yMm),Math.max(c.yMm,d.yMm))+INTERSECTION_EPSILON_MM*3;if(!overlapX||!overlapY)continue;
      if(Math.min(projectPointOnSegment(a,c,d).distanceMm,projectPointOnSegment(b,c,d).distanceMm,projectPointOnSegment(c,a,b).distanceMm,projectPointOnSegment(d,a,b).distanceMm)<=INTERSECTION_EPSILON_MM*3)return vector(c);
    }}return undefined;
}

function nearestSampleIndex''','nearest contour')
p.write_text(s)

pd=Path('apps/web/src/domain/patternDocumentV3.ts'); d=pd.read_text().replace('possui lados com quantidades diferentes de intervalos.','possui múltiplos intervalos com quantidades diferentes entre os lados.'); pd.write_text(d)

pc=Path('apps/web/src/editor/PatternCanvas.tsx'); c=pc.read_text()
c=sub(c,r'    for \(const line of piece\.internalLines \?\? \[\]\) \{\n        const points = line\.points\.map.*?\n      \}', '''    for (const line of piece.internalLines ?? []) {
        const internal = line as unknown as { purpose:string; visible?:boolean; points?:Array<{xMm:number;yMm:number}>; nodes?:Array<{id:string;xMm:number;yMm:number;handleIn?:{xMm:number;yMm:number};handleOut?:{xMm:number;yMm:number}}>; segments?:Array<{kind:"line"|"cubic";startNodeId:string;endNodeId:string}> };
        if (internal.visible === false) continue;
        const byId=new Map((internal.nodes??[]).map((node)=>[node.id,node]));
        const local=internal.points??(internal.segments??[]).flatMap((segment,si)=>{const a=byId.get(segment.startNodeId),b=byId.get(segment.endNodeId);if(!a||!b)return[];const steps=segment.kind==="cubic"?16:1;const sampled=Array.from({length:steps+1},(_,i)=>{const t=i/steps;if(segment.kind==="line")return{xMm:a.xMm+(b.xMm-a.xMm)*t,yMm:a.yMm+(b.yMm-a.yMm)*t};const c1=a.handleOut?{xMm:a.xMm+a.handleOut.xMm,yMm:a.yMm+a.handleOut.yMm}:a,c2=b.handleIn?{xMm:b.xMm+b.handleIn.xMm,yMm:b.yMm+b.handleIn.yMm}:b,u=1-t;return{xMm:u*u*u*a.xMm+3*u*u*t*c1.xMm+3*u*t*t*c2.xMm+t*t*t*b.xMm,yMm:u*u*u*a.yMm+3*u*u*t*c1.yMm+3*u*t*t*c2.yMm+t*t*t*b.yMm}});return si===0?sampled:sampled.slice(1)});
        const points=local.map((point)=>pieceLocalToWorld(point,transform));if(points.length<2)continue;
        context.beginPath();points.forEach((point,index)=>index?context.lineTo(point.xMm,point.yMm):context.moveTo(point.xMm,point.yMm));
        context.setLineDash(internal.purpose==="fold"?[8/camera.zoom,5/camera.zoom]:internal.purpose==="reference"?[3/camera.zoom,3/camera.zoom]:[]);
        context.strokeStyle=internal.purpose==="dart"?"#b06084":internal.purpose==="cut"||internal.purpose==="cut-and-sew"?"#b3442e":"#59636c";context.lineWidth=1.5/camera.zoom;context.stroke();context.setLineDash([]);
      }''','canvas')
pc.write_text(c)
