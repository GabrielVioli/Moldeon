import { describe, expect, it } from "vitest";
import { createXpbdState, measureXpbdDiagnostics, stepXpbd, type XpbdState } from "./xpbd";

const RUN_PERF = process.env.MOLDEON_PERF_BENCH === "1";

type Spec = { name: string; rows: number; cols: number; seamCount: number; bendCount: number };
const SPECS: Spec[] = [
  { name: "A-free-panel", rows: 20, cols: 20, seamCount: 0, bendCount: 500 },
  { name: "B-self-seam-tube", rows: 30, cols: 20, seamCount: 80, bendCount: 1200 },
  { name: "C-four-panel-cycle", rows: 45, cols: 30, seamCount: 160, bendCount: 3200 },
  { name: "D-heavy-garment", rows: 70, cols: 70, seamCount: 374, bendCount: 12997 },
];

function makeState(spec: Spec): XpbdState {
  const n = spec.rows * spec.cols;
  const positions = new Float32Array(n * 3);
  const material = new Float32Array(n * 2);
  const inverseMasses = new Float32Array(n).fill(1);
  const spacing = 0.02;
  for (let r = 0; r < spec.rows; r++) for (let c = 0; c < spec.cols; c++) {
    const i = r * spec.cols + c; const o = i * 3;
    positions[o] = c * spacing; positions[o + 1] = -r * spacing; positions[o + 2] = (c % 4) * 0.0001;
    material[i * 2] = c * spacing; material[i * 2 + 1] = r * spacing;
  }
  const triangles: number[] = [];
  const stretchPairs: Array<[number, number]> = [];
  const shearTriples: Array<[number, number, number]> = [];
  for (let r = 0; r < spec.rows - 1; r++) for (let c = 0; c < spec.cols - 1; c++) {
    const a = r * spec.cols + c, b = a + 1, d = a + spec.cols, e = d + 1;
    triangles.push(a, d, b, b, d, e);
    shearTriples.push([a, b, d], [e, d, b]);
  }
  for (let r = 0; r < spec.rows; r++) for (let c = 0; c < spec.cols; c++) {
    const a = r * spec.cols + c;
    if (c + 1 < spec.cols) stretchPairs.push([a, a + 1]);
    if (r + 1 < spec.rows) stretchPairs.push([a, a + spec.cols]);
    if (r + 1 < spec.rows && c + 1 < spec.cols) stretchPairs.push([a, a + spec.cols + 1]);
  }
  const allPairs = stretchPairs.slice();
  for (let i = 0; i < spec.bendCount; i++) {
    const a = (i * 17) % (n - 2); const b = Math.min(n - 1, a + 2);
    allPairs.push([a, b]);
  }
  const distanceIndices = new Uint32Array(allPairs.length * 2);
  const rests = new Float32Array(allPairs.length);
  const comps = new Float32Array(allPairs.length).fill(1e-7);
  const kinds = new Uint8Array(allPairs.length);
  for (let i = 0; i < allPairs.length; i++) {
    const [a,b] = allPairs[i]; distanceIndices[i*2]=a; distanceIndices[i*2+1]=b; kinds[i]=i<stretchPairs.length?0:1;
    const ao=a*3, bo=b*3; rests[i]=Math.hypot(positions[bo]-positions[ao],positions[bo+1]-positions[ao+1],positions[bo+2]-positions[ao+2]);
  }
  const shearIndices = new Uint32Array(shearTriples.length * 3);
  const restCos = new Float32Array(shearTriples.length);
  for (let i=0;i<shearTriples.length;i++) {
    const [p0,p1,p2]=shearTriples[i]; shearIndices.set([p0,p1,p2],i*3);
    const o0=p0*3,o1=p1*3,o2=p2*3; const x1=positions[o1]-positions[o0],y1=positions[o1+1]-positions[o0+1],z1=positions[o1+2]-positions[o0+2]; const x2=positions[o2]-positions[o0],y2=positions[o2+1]-positions[o0+1],z2=positions[o2+2]-positions[o0+2];
    restCos[i]=(x1*x2+y1*y2+z1*z2)/(Math.hypot(x1,y1,z1)*Math.hypot(x2,y2,z2));
  }
  const seamIndices = new Uint32Array(spec.seamCount*4).fill(0xffffffff), seamWeights = new Float32Array(spec.seamCount*4), seamRest = new Float32Array(spec.seamCount), seamGroupIds:string[]=[];
  for(let i=0;i<spec.seamCount;i++) { const row=i%spec.rows; const a=row*spec.cols, b=a+spec.cols-1; seamIndices[i*4]=a; seamIndices[i*4+2]=b; seamWeights[i*4]=1; seamWeights[i*4+2]=1; const ao=a*3,bo=b*3; seamRest[i]=Math.hypot(positions[bo]-positions[ao],positions[bo+1]-positions[ao+1],positions[bo+2]-positions[ao+2]); seamGroupIds.push(`group-${i%7}`); }
  return createXpbdState({ positions:new Float32Array(positions), previousPositions:new Float32Array(positions), predictedPositions:new Float32Array(positions), velocities:new Float32Array(n*3), inverseMasses, restPositions:new Float32Array(positions), materialCoordinates:material, triangles:new Uint32Array(triangles), distances:{indices:distanceIndices,restLengths:rests,compliances:comps,lambdas:new Float32Array(rests.length),kinds}, shears:{indices:shearIndices,restCosines:restCos,compliances:new Float32Array(restCos.length).fill(1e-7),lambdas:new Float32Array(restCos.length)}, seams:{indices:seamIndices,weights:seamWeights,restDistances:seamRest,compliances:new Float32Array(spec.seamCount).fill(1e-8),relaxations:new Float32Array(spec.seamCount).fill(1),lambdas:new Float32Array(spec.seamCount),seamGroupIds}, pins:{indices:new Uint32Array(0),targets:new Float32Array(0)}, config:{fixedTimeStep:1/120,maximumFrameDelta:1/20,maximumSubsteps:6,iterations:8,damping:0.996,gravity:[0,-9.81,0],maximumCorrection:0.035,maximumVelocity:12,seamTolerance:0.0025} });
}

function percentile(values:number[], p:number){const s=[...values].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor((s.length-1)*p))];}
function profile(spec:Spec){const state=makeState(spec);for(let i=0;i<5;i++)stepXpbd(state);const samples:any[]=[];for(let i=0;i<20;i++){stepXpbd(state);samples.push({...state.profile});}const keys=["integrationMs","stretchMs","shearMs","bendMs","seamMs","velocityUpdateMs","validationMs","solverStepTotalMs"] as const;const med:any={};for(const k of keys)med[k]=percentile(samples.map(x=>x[k]),.5);const total=med.solverStepTotalMs;const pct:any={};for(const k of keys.slice(0,-1))pct[k]=total?med[k]/total*100:0;const d=measureXpbdDiagnostics(state);return {scene:spec.name,counts:{particles:d.particleCount,triangles:d.triangleCount,stretch:d.stretchConstraintCount,shear:d.shearConstraintCount,bend:d.bendConstraintCount,seams:d.seamConstraintCount,iterations:d.iterations,substeps:d.maximumSubsteps},medianMs:total,p95Ms:percentile(samples.map(x=>x.solverStepTotalMs),.95),medianPhases:med,percent:pct,invalid:d.invalid,seamMean:d.seamErrorAverage,seamMax:d.seamErrorMaximum};}

describe("XPBD hotloop performance fixture",()=>{
  it.skipIf(!RUN_PERF)("prints deterministic baseline/performance profile",()=>{const out=SPECS.map(profile);console.log("MOLDEON_XPBD_PERF "+JSON.stringify(out));for(const x of out)expect(x.invalid).toBe(false);},60_000);
  it("keeps the heavy benchmark fixture structurally valid",()=>{const s=makeState(SPECS[3]);stepXpbd(s);expect(s.invalid).toBe(false);expect(s.positions.length/3).toBe(4900);});
});
