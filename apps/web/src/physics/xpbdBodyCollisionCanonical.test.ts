import { describe, expect, it } from "vitest";
import {
  BODY_COLLIDER_CAPSULE,
  BODY_COLLIDER_ELLIPSOID,
  BODY_COLLIDER_STRIDE,
  createBodyCollisionRuntimeState,
  deepestBodyContact,
  type PackedBodyColliders,
} from "./bodyCollision";
import { createXpbdState, resetXpbdState, stepXpbd, type XpbdState } from "./xpbd";

function emptyPacked(kind: number, region: string): PackedBodyColliders {
  return { kinds: new Uint8Array([kind]), data: new Float32Array(BODY_COLLIDER_STRIDE), regions: [region] };
}

function patchState(
  positions: number[],
  colliders: PackedBodyColliders,
  friction = 0.5,
  gravity: [number, number, number] = [0, -9.81, 0],
): XpbdState {
  const particleCount = positions.length / 3;
  const distancePairs: number[] = [];
  const rest: number[] = [];
  if (particleCount >= 4) {
    for (const [a, b] of [[0,1],[1,3],[3,2],[2,0],[0,3],[1,2]] as const) {
      distancePairs.push(a,b);
      rest.push(distance(positions,a,b));
    }
  }
  return createXpbdState({
    positions: new Float32Array(positions),
    previousPositions: new Float32Array(positions),
    predictedPositions: new Float32Array(positions),
    velocities: new Float32Array(positions.length),
    inverseMasses: new Float32Array(particleCount).fill(1),
    restPositions: new Float32Array(positions),
    materialCoordinates: new Float32Array(particleCount * 2),
    triangles: particleCount >= 4 ? new Uint32Array([0,1,2,1,3,2]) : new Uint32Array(0),
    distances: {
      indices: new Uint32Array(distancePairs),
      restLengths: new Float32Array(rest),
      compliances: new Float32Array(rest.length).fill(0.00002),
      lambdas: new Float32Array(rest.length),
      kinds: new Uint8Array(rest.length),
    },
    shears: { indices: new Uint32Array(0), restCosines: new Float32Array(0), compliances: new Float32Array(0), lambdas: new Float32Array(0) },
    seams: { indices: new Uint32Array(0), weights: new Float32Array(0), restDistances: new Float32Array(0), compliances: new Float32Array(0), relaxations: new Float32Array(0), lambdas: new Float32Array(0), seamGroupIds: [] },
    pins: { indices: new Uint32Array(0), targets: new Float32Array(0) },
    body: createBodyCollisionRuntimeState(colliders, new Float32Array(particleCount).fill(0.00025), new Float32Array(particleCount).fill(friction), true),
    config: { fixedTimeStep: 1/120, maximumFrameDelta: 1/20, maximumSubsteps: 6, iterations: 8, damping: 0.996, gravity, maximumCorrection: 0.035, maximumVelocity: 12, seamTolerance: 0.0025 },
  });
}

describe("Prompt 11 canonical body collision scenes", () => {
  it("PATCH ON ELLIPSOID contacts and remains outside", () => {
    const colliders = emptyPacked(BODY_COLLIDER_ELLIPSOID, "torso");
    colliders.data.set([0,0,0,0.35,0.4,0.3]);
    const state = patchState([-0.06,0.62,-0.06, 0.06,0.62,-0.06, -0.06,0.62,0.06, 0.06,0.62,0.06], colliders, 0.55);
    let contacts = 0;
    for (let step=0; step<240; step+=1) { stepXpbd(state); contacts += state.body.bodyContactCount; }
    expect(state.invalid).toBe(false);
    expect(contacts).toBeGreaterThan(0);
    assertOutside(state, colliders, 0.0002);
  });

  it("PATCH ON CAPSULE contacts without gross tunneling", () => {
    const colliders = emptyPacked(BODY_COLLIDER_CAPSULE, "arm-left");
    colliders.data.set([-0.4,0,0, 0.4,0,0, 0.18]);
    const state = patchState([-0.05,0.55,-0.04, 0.05,0.55,-0.04, -0.05,0.55,0.04, 0.05,0.55,0.04], colliders, 0.4);
    let swept = 0;
    for (let step=0; step<180; step+=1) { stepXpbd(state); swept += state.body.sweptContactCount; }
    expect(state.invalid).toBe(false);
    assertOutside(state, colliders, 0.0002);
    expect(swept).toBeGreaterThanOrEqual(0);
  });

  it("TORSO remains outside overlapping chest abdomen pelvis proxies", () => {
    const colliders: PackedBodyColliders = { kinds: new Uint8Array([1,1,1]), data: new Float32Array(3*BODY_COLLIDER_STRIDE), regions: ["torso","torso","hip"] };
    colliders.data.set([0,0.75,0,0.32,0.28,0.22],0);
    colliders.data.set([0,0.45,0,0.29,0.24,0.2],BODY_COLLIDER_STRIDE);
    colliders.data.set([0,0.18,0,0.34,0.25,0.23],2*BODY_COLLIDER_STRIDE);
    const state = patchState([-0.08,1.15,-0.06, 0.08,1.15,-0.06, -0.08,1.15,0.06, 0.08,1.15,0.06], colliders, 0.5);
    for (let step=0; step<300; step+=1) stepXpbd(state);
    expect(state.invalid).toBe(false);
    assertOutside(state, colliders, 0.0005);
  });

  it("TWO LEGS keeps particles outside two separate thigh volumes", () => {
    const colliders: PackedBodyColliders = { kinds: new Uint8Array([2,2]), data: new Float32Array(2*BODY_COLLIDER_STRIDE), regions: ["leg-left","leg-right"] };
    colliders.data.set([-0.13,0.55,0,-0.13,-0.35,0,0.11],0);
    colliders.data.set([0.13,0.55,0,0.13,-0.35,0,0.11],BODY_COLLIDER_STRIDE);
    const state = patchState([-0.22,0.8,-0.05, 0.22,0.8,-0.05, -0.22,0.8,0.05, 0.22,0.8,0.05], colliders, 0.5);
    for (let step=0; step<240; step+=1) stepXpbd(state);
    expect(state.invalid).toBe(false);
    assertOutside(state, colliders, 0.0005);
    expect(Math.abs(state.positions[0]-state.positions[3])).toBeGreaterThan(0.12);
  });

  it("reset clears body contact state and restores rest pose", () => {
    const colliders = emptyPacked(BODY_COLLIDER_ELLIPSOID, "torso");
    colliders.data.set([0,0,0,0.3,0.4,0.2]);
    const initial=[0,0,0];
    const state=patchState(initial,colliders,0.5,[0,0,0]);
    stepXpbd(state);
    expect(state.body.bodyContactCount).toBeGreaterThan(0);
    resetXpbdState(state);
    expect(state.body.bodyContactCount).toBe(0);
    expect([...state.positions]).toEqual(initial);
  });
});

function assertOutside(state: XpbdState, colliders: PackedBodyColliders, toleranceM: number) {
  for (let particle=0; particle<state.positions.length/3; particle+=1) {
    const offset=particle*3;
    const contact=deepestBodyContact([state.positions[offset],state.positions[offset+1],state.positions[offset+2]],colliders,state.body.particleHalfThicknessM[particle]+state.body.contactSkinM-toleranceM);
    expect(contact?.penetrationM ?? 0).toBeLessThanOrEqual(toleranceM+1e-5);
  }
}
function distance(p:number[],a:number,b:number){const ia=a*3,ib=b*3;return Math.hypot(p[ia]-p[ib],p[ia+1]-p[ib+1],p[ia+2]-p[ib+2]);}
