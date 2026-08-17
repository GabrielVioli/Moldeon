import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { GarmentDraft } from "../domain/pattern";
import { buildXpbdInitialization, type XpbdInitializationData } from "../physics/GarmentXpbdAdapter";
import { createXpbdState, measureXpbdDiagnostics, stepXpbd, type XpbdState } from "../physics/xpbd";
import { createGeneralGarmentShellFixture } from "../testFixtures/generalGarmentShell";
import { measureIntrinsicDistortion, type GarmentAssemblyState } from "./GarmentAssembly";
import { auditAdapterSeamResiduals } from "./InitialSeamResidual";
import { buildResolvedAssemblyInput } from "./ResolvedAssemblyInput";
import { buildSemanticAvatarArrangement } from "./SemanticAvatarArrangement";

const REPORT = process.env.MOLDEON_10_5_REPORT === "1";
const BASELINE_MEAN_MM = 26.48663664528049;
const BASELINE_MAX_MM = 180.15574377647158;

describe("Prompt 10.5 general garment spatial assembly", () => {
  it("builds a non-planar shell from side + shoulder relations while keeping free boundaries free", () => {
    const result = arrange(createGeneralGarmentShellFixture());
    const assembly = result.arrangement.initialSeamResidualAudit.afterTubeAlignment;
    const adapter = adapterAudit(result);
    const spatial = result.arrangement.spatialAssemblyDiagnostics[0];
    const distortion = measureIntrinsicDistortion(result.arrangement.state);
    expect(spatial.strategy).toBe("constraint-spatial-shell");
    expect(spatial.poseConstraintCount).toBe(6);
    expect(spatial.freeBoundaryCount).toBeGreaterThan(0);
    expect(spatial.detectedCycles).toBeGreaterThan(0);
    expect(normalSpread(result.arrangement.state.positions, result.arrangement.state.instances)).toBeGreaterThan(0.25);
    expect(assembly.meanResidualMm).toBeLessThan(BASELINE_MEAN_MM * 0.7);
    expect(assembly.maxResidualMm).toBeLessThan(BASELINE_MAX_MM * 0.3);
    expect(adapter.maximumCorrespondenceJumpMm).toBeLessThan(1e-3);
    expect(distortion.maxRelativeDistortion).toBeLessThan(2e-4);
    const multi = relationGroupsByPair(result.arrangement.state);
    expect([...multi.values()].filter((groups) => groups.size > 1)).toHaveLength(2);
    expect([...multi.values()].some((groups) => groups.has("g-side-ab") && groups.has("g-shoulder-ab"))).toBe(true);
    if (REPORT) console.log(`MOLDEON_10_5_STEP0 ${JSON.stringify(reportSnapshot(result))}`);
  });

  it("does not invent a closed shell when shoulder relations are removed", () => {
    const result = arrange(createGeneralGarmentShellFixture({ shoulders: false }));
    expect(result.arrangement.constraintSpatialAssembly.components.every((component) => component.strategy === "underconstrained-open")).toBe(true);
    expect(result.arrangement.initialSeamResidualAudit.afterTubeAlignment.invariantErrors).toEqual([]);
  });

  it("opens coherently when one side seam is removed and keeps free boundaries", () => {
    const garment = createGeneralGarmentShellFixture({ removeSide: true });
    const result = arrange(garment);
    expect(result.arrangement.spatialAssemblyDiagnostics[0].freeBoundaryCount).toBeGreaterThanOrEqual(garment.pieces.length * 2);
    expect(result.arrangement.initialSeamResidualAudit.afterTubeAlignment.groups.some((group) => group.seamGroupId === "g-side-cd")).toBe(false);
    expect([...result.arrangement.state.positions].every(Number.isFinite)).toBe(true);
  });

  it("is independent from display names, piece order and seam order", () => {
    const canonical = arrange(createGeneralGarmentShellFixture());
    const renamed = arrange(createGeneralGarmentShellFixture({ randomNames: true }));
    const reordered = arrange(createGeneralGarmentShellFixture({ reorderPieces: true, reverseSeams: true }));
    expect(canonicalPose(canonical.arrangement.state)).toEqual(canonicalPose(renamed.arrangement.state));
    expectPoseClose(canonicalPose(canonical.arrangement.state), canonicalPose(reordered.arrangement.state), 2e-5);
  });

  it("rebuilds A to B to A without stale shell pose", () => {
    const garmentA = createGeneralGarmentShellFixture();
    const first = arrange(garmentA);
    arrange(createGeneralGarmentShellFixture({ removeSide: true }));
    const restored = arrange(garmentA);
    expectPoseClose(canonicalPose(first.arrangement.state), canonicalPose(restored.arrangement.state), 1e-7);
  });

  it("survives exactly one zero-gravity XPBD step without a structural kick", () => {
    const result = physicalState(createGeneralGarmentShellFixture(), "prompt-10.5-one-step");
    const before = new Float32Array(result.state.positions);
    const initial = measureXpbdDiagnostics(result.state);
    stepXpbd(result.state);
    const after = measureXpbdDiagnostics(result.state, 1);
    const displacement = maxDisplacement(before, result.state.positions);
    expect(result.state.invalid).toBe(false);
    expect(displacement).toBeLessThan(0.05);
    expect(after.seamErrorMaximum).toBeLessThanOrEqual(initial.seamErrorMaximum + 1e-7);
    expect(normalSpread(result.state.positions, result.assembly.instances)).toBeGreaterThan(0.1);
    if (REPORT) console.log(`MOLDEON_10_5_ONE_STEP ${JSON.stringify({ maxDisplacementM: displacement, seamMeanMm: after.seamErrorAverage * 1000, seamMaxMm: after.seamErrorMaximum * 1000, physicsStepMs: result.state.profile.solverStepTotalMs })}`);
  });

  it("remains a finite spatial shell after 240 zero-gravity steps", () => {
    const result = physicalState(createGeneralGarmentShellFixture(), "prompt-10.5-240-step");
    const before = new Float32Array(result.state.positions);
    const initial = measureXpbdDiagnostics(result.state);
    const timings: number[] = [];
    const startedAt = performance.now();
    for (let step = 0; step < 240; step += 1) { stepXpbd(result.state); if (step >= 40) timings.push(result.state.profile.solverStepTotalMs); }
    const elapsed = performance.now() - startedAt;
    const after = measureXpbdDiagnostics(result.state, 240);
    const displacement = maxDisplacement(before, result.state.positions);
    expect(result.state.invalid).toBe(false);
    expect([...result.state.positions].every(Number.isFinite)).toBe(true);
    expect(after.seamErrorAverage).toBeLessThan(initial.seamErrorAverage);
    expect(after.seamErrorMaximum).toBeLessThan(initial.seamErrorMaximum);
    expect(displacement).toBeLessThan(0.5);
    expect(normalSpread(result.state.positions, result.assembly.instances)).toBeGreaterThan(0.05);
    if (REPORT) console.log(`MOLDEON_10_5_240_STEP ${JSON.stringify({ elapsedMs: elapsed, maxDisplacementM: displacement, seamMeanBeforeMm: initial.seamErrorAverage * 1000, seamMaxBeforeMm: initial.seamErrorMaximum * 1000, seamMeanAfterMm: after.seamErrorAverage * 1000, seamMaxAfterMm: after.seamErrorMaximum * 1000, physicsStepMedianMs: percentile(timings, 0.5), physicsStepP95Ms: percentile(timings, 0.95), normalSpreadRad: normalSpread(result.state.positions, result.assembly.instances) })}`);
  });
});

function arrange(garment: GarmentDraft) {
  const input = buildResolvedAssemblyInput(garment);
  const avatar = buildAvatarParametricModel(input.document.measurements.values, input.document.body.type);
  const arrangement = buildSemanticAvatarArrangement(input, avatar);
  const initialization = buildXpbdInitialization(arrangement.state, arrangement.garment, `10.5:${garment.id}`, { config: { gravity: [0, 0, 0] } });
  return { arrangement, initialization };
}

function physicalState(garment: GarmentDraft, revision: string): { state: XpbdState; initialization: XpbdInitializationData; assembly: GarmentAssemblyState } {
  const { arrangement, initialization } = arrange(garment);
  const state = createXpbdState({ positions: initialization.positions, previousPositions: initialization.previousPositions, predictedPositions: initialization.predictedPositions, velocities: initialization.velocities, inverseMasses: initialization.inverseMasses, restPositions: initialization.restPositions, materialCoordinates: initialization.materialCoordinates, triangles: initialization.triangles, distances: { indices: initialization.distanceIndices, restLengths: initialization.distanceRestLengths, compliances: initialization.distanceCompliances, lambdas: new Float32Array(initialization.distanceRestLengths.length), kinds: initialization.distanceKinds }, shears: { indices: initialization.shearIndices, restCosines: initialization.shearRestCosines, compliances: initialization.shearCompliances, lambdas: new Float32Array(initialization.shearRestCosines.length) }, seams: { indices: initialization.seamIndices, weights: initialization.seamWeights, restDistances: initialization.seamRestDistances, compliances: initialization.seamCompliances, relaxations: initialization.seamRelaxations, lambdas: new Float32Array(initialization.seamRestDistances.length), seamGroupIds: initialization.seamGroupIds }, pins: { indices: initialization.pinIndices, targets: initialization.pinTargets }, config: { ...initialization.config, gravity: [0, 0, 0] } });
  return { state, initialization, assembly: arrangement.state };
}

function adapterAudit(result: ReturnType<typeof arrange>) { return auditAdapterSeamResiduals(result.arrangement.state, result.arrangement.garment, result.initialization.positions, result.initialization.seamIndices, result.initialization.seamWeights, result.initialization.seamRestDistances, result.initialization.seamGroupIds); }
function reportSnapshot(result: ReturnType<typeof arrange>) { const assembly=result.arrangement.initialSeamResidualAudit.afterTubeAlignment; const adapter=adapterAudit(result); return { assemblyMeanMm:assembly.meanResidualMm, assemblyMaxMm:assembly.maxResidualMm, adapterMeanMm:adapter.meanResidualMm, adapterMaxMm:adapter.maxResidualMm, maximumCorrespondenceJumpMm:adapter.maximumCorrespondenceJumpMm, normalSpreadRad:normalSpread(result.arrangement.state.positions,result.arrangement.state.instances), intrinsic:measureIntrinsicDistortion(result.arrangement.state), components:result.arrangement.spatialAssemblyDiagnostics, groups:assembly.groups.map((group)=>({id:group.seamGroupId,class:group.classification,meanMm:group.meanResidualMm,maxMm:group.maxResidualMm,instances:group.instanceIds,rangesA:group.rangesA,rangesB:group.rangesB})) }; }

function relationGroupsByPair(state:GarmentAssemblyState):Map<string,Set<string>>{const result=new Map<string,Set<string>>();for(const constraint of state.stitchConstraints){if(!constraint.instanceA||!constraint.instanceB||constraint.instanceA===constraint.instanceB)continue;const key=[constraint.instanceA,constraint.instanceB].sort().join("<->");const groups=result.get(key)??new Set<string>();groups.add(constraint.seamGroupId);result.set(key,groups);}return result;}
function canonicalPose(state:GarmentAssemblyState):Record<string,number[]>{return Object.fromEntries([...state.instances].sort((a,b)=>a.pieceId.localeCompare(b.pieceId)).map((instance)=>{const values:number[]=[];const start=instance.particleStart*3;const stride=Math.max(3,Math.floor(instance.vertexCount/13)*3);for(let i=0;i<instance.vertexCount*3;i+=stride)values.push(Number(state.positions[start+i].toFixed(6)),Number(state.positions[start+i+1].toFixed(6)),Number(state.positions[start+i+2].toFixed(6)));return[instance.pieceId,values];}));}
function expectPoseClose(first:Record<string,number[]>,second:Record<string,number[]>,tolerance:number):void{expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());for(const key of Object.keys(first)){expect(second[key]).toHaveLength(first[key].length);for(let index=0;index<first[key].length;index+=1)expect(Math.abs(second[key][index]-first[key][index])).toBeLessThanOrEqual(tolerance);}}
function normalSpread(positions:Float32Array,instances:readonly {particleStart:number;topology:{triangles:Uint32Array}}[]):number{const normals=instances.map((instance)=>{const t=instance.topology.triangles;if(t.length<3)return[0,0,1]as const;const a=(instance.particleStart+t[0])*3,b=(instance.particleStart+t[1])*3,c=(instance.particleStart+t[2])*3;const ab=[positions[b]-positions[a],positions[b+1]-positions[a+1],positions[b+2]-positions[a+2]],ac=[positions[c]-positions[a],positions[c+1]-positions[a+1],positions[c+2]-positions[a+2]];const n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];const l=Math.hypot(...n)||1;return[n[0]/l,n[1]/l,n[2]/l]as const;});let spread=0;for(let i=0;i<normals.length;i++)for(let j=i+1;j<normals.length;j++){const dot=Math.max(-1,Math.min(1,Math.abs(normals[i][0]*normals[j][0]+normals[i][1]*normals[j][1]+normals[i][2]*normals[j][2])));spread=Math.max(spread,Math.acos(dot));}return spread;}
function maxDisplacement(before:Float32Array,after:Float32Array):number{let maximum=0;for(let i=0;i<before.length;i+=3)maximum=Math.max(maximum,Math.hypot(after[i]-before[i],after[i+1]-before[i+1],after[i+2]-before[i+2]));return maximum;}
function percentile(values:number[],p:number):number{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))]??0;}
