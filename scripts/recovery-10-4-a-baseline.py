from pathlib import Path

p = Path('apps/web/src/physics/xpbd.ts')
s = p.read_text()

s = s.replace('export interface XpbdState {', '''export interface XpbdProfileTimings {\n  integrationMs: number;\n  stretchMs: number;\n  shearMs: number;\n  bendMs: number;\n  seamMs: number;\n  velocityUpdateMs: number;\n  validationMs: number;\n  solverStepTotalMs: number;\n}\n\nexport interface XpbdState {''')
s = s.replace('  invalid: boolean;\n}', '  invalid: boolean;\n  profile: XpbdProfileTimings;\n}', 1)
s = s.replace('  droppedTimeSeconds: number;\n}', '''  droppedTimeSeconds: number;\n  integrationMs: number;\n  stretchMs: number;\n  shearMs: number;\n  bendMs: number;\n  seamMs: number;\n  velocityUpdateMs: number;\n  validationMs: number;\n  solverStepTotalMs: number;\n  iterations: number;\n  maximumSubsteps: number;\n}''', 1)
s = s.replace('input: Omit<XpbdState, "correctionLimits" | "stablePositions" | "maximumCorrectionApplied" | "accumulator" | "stepCount" | "invalid">,', 'input: Omit<XpbdState, "correctionLimits" | "stablePositions" | "maximumCorrectionApplied" | "accumulator" | "stepCount" | "invalid" | "profile">,')
s = s.replace('    invalid: false,\n  };', '''    invalid: false,\n    profile: { integrationMs: 0, stretchMs: 0, shearMs: 0, bendMs: 0, seamMs: 0, velocityUpdateMs: 0, validationMs: 0, solverStepTotalMs: 0 },\n  };''', 1)
old = '''export function stepXpbd(state: XpbdState): void {\n  const dt = state.config.fixedTimeStep;\n  if (!Number.isFinite(dt) || dt <= 0) throw new RangeError("O passo da simula\\u00e7\\u00e3o precisa ser positivo e finito.");\n\n  state.previousPositions.set(state.positions);\n  state.maximumCorrectionApplied = 0;\n  resetLambdas(state);\n  integrate(state, dt);\n\n  for (let iteration = 0; iteration < state.config.iterations; iteration += 1) {\n    solveDistanceSet(state, dt, 0);\n    solveShearSet(state, dt);\n    solveDistanceSet(state, dt, 1);\n    solveSeamSet(state, dt);\n    enforcePins(state);\n  }\n\n  updateVelocitiesAndPositions(state, dt);\n  state.stepCount += 1;\n\n  if (!positionsAreSafe(state.positions)) {\n    state.positions.set(state.stablePositions);\n    state.previousPositions.set(state.stablePositions);\n    state.predictedPositions.set(state.stablePositions);\n    state.velocities.fill(0);\n    state.invalid = true;\n    return;\n  }\n\n  state.stablePositions.set(state.positions);\n  state.invalid = false;\n}'''
new = '''export function stepXpbd(state: XpbdState): void {\n  const stepStarted = performance.now();\n  const profile = state.profile;\n  profile.integrationMs = 0; profile.stretchMs = 0; profile.shearMs = 0; profile.bendMs = 0; profile.seamMs = 0; profile.velocityUpdateMs = 0; profile.validationMs = 0;\n  const dt = state.config.fixedTimeStep;\n  if (!Number.isFinite(dt) || dt <= 0) throw new RangeError("O passo da simula\\u00e7\\u00e3o precisa ser positivo e finito.");\n\n  state.previousPositions.set(state.positions);\n  state.maximumCorrectionApplied = 0;\n  resetLambdas(state);\n  let phaseStarted = performance.now();\n  integrate(state, dt);\n  profile.integrationMs = performance.now() - phaseStarted;\n\n  for (let iteration = 0; iteration < state.config.iterations; iteration += 1) {\n    phaseStarted = performance.now(); solveDistanceSet(state, dt, 0); profile.stretchMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now(); solveShearSet(state, dt); profile.shearMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now(); solveDistanceSet(state, dt, 1); profile.bendMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now(); solveSeamSet(state, dt); profile.seamMs += performance.now() - phaseStarted;\n    enforcePins(state);\n  }\n\n  phaseStarted = performance.now();\n  updateVelocitiesAndPositions(state, dt);\n  profile.velocityUpdateMs = performance.now() - phaseStarted;\n  state.stepCount += 1;\n\n  phaseStarted = performance.now();\n  if (!positionsAreSafe(state.positions)) {\n    state.positions.set(state.stablePositions);\n    state.previousPositions.set(state.stablePositions);\n    state.predictedPositions.set(state.stablePositions);\n    state.velocities.fill(0);\n    state.invalid = true;\n    profile.validationMs = performance.now() - phaseStarted;\n    profile.solverStepTotalMs = performance.now() - stepStarted;\n    return;\n  }\n\n  state.stablePositions.set(state.positions);\n  state.invalid = false;\n  profile.validationMs = performance.now() - phaseStarted;\n  profile.solverStepTotalMs = performance.now() - stepStarted;\n}'''
if old not in s:
    raise SystemExit('stepXpbd block not found')
s = s.replace(old, new)
s = s.replace('    droppedTimeSeconds,\n  };', '''    droppedTimeSeconds,\n    integrationMs: state.profile.integrationMs,\n    stretchMs: state.profile.stretchMs,\n    shearMs: state.profile.shearMs,\n    bendMs: state.profile.bendMs,\n    seamMs: state.profile.seamMs,\n    velocityUpdateMs: state.profile.velocityUpdateMs,\n    validationMs: state.profile.validationMs,\n    solverStepTotalMs: state.profile.solverStepTotalMs,\n    iterations: state.config.iterations,\n    maximumSubsteps: state.config.maximumSubsteps,\n  };''', 1)
p.write_text(s)

proto = Path('apps/web/src/physics/xpbdProtocol.ts')
t = proto.read_text().replace('  physicsStepMs?: number;\n}', '  physicsStepMs?: number;\n  workerStepTotalMs?: number;\n}')
proto.write_text(t)

worker = Path('apps/web/src/workers/simulation.worker.ts')
w = worker.read_text().replace('let lastPhysicsStepMs = 0;', 'let lastPhysicsStepMs = 0;\nlet lastWorkerStepTotalMs = 0;')
w = w.replace('  lastPhysicsStepMs = performance.now() - startedAt;\n  return currentDiagnostics(1);', '  lastPhysicsStepMs = performance.now() - startedAt;\n  lastWorkerStepTotalMs = lastPhysicsStepMs;\n  return currentDiagnostics(1);')
w = w.replace('  return { ...measureXpbdDiagnostics(state, substeps), physicsStepMs: lastPhysicsStepMs };', '  return { ...measureXpbdDiagnostics(state, substeps), physicsStepMs: lastPhysicsStepMs, workerStepTotalMs: lastWorkerStepTotalMs };')
worker.write_text(w)

bench = Path('apps/web/src/physics/xpbdHotloopPerformance.test.ts')
bench.write_text(r'''import { describe, expect, it } from "vitest";
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
    material[i * 2] = c * 20; material[i * 2 + 1] = r * 20;
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
''')
print('baseline profiler patch applied')
