import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { AvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { BodySurfaceFrame } from "../avatar/BodySurfaceQuery";
import type { HumanBodyMesh } from "../avatar/HumanBodyModel";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import type { ResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import {
  adjustMeshToBodySurface,
  applyAuthoredArrangementToAssemblyState,
  arrangementVisualState,
  auditMeshBodyClearance,
  captureMeshArrangement,
  constrainMeshOutsideBody,
  createAxisDragPlane,
  createBodyBarrierState,
  createCameraDragPlane,
  intersectPointerRayWithDragPlane,
  placeMeshCentroid,
  resolveDeterministicStagingLayout,
  resolveArrangementTransform,
  updateSurfaceCandidate,
} from "./ArrangementWorkspace";

const placement = {
  id: "panel:1",
  pieceId: "panel",
  region: "custom" as const,
  surface: "custom" as const,
  bodySide: "center" as const,
  rotationDeg: 0,
  offsetXMm: 0,
  offsetYMm: 0,
  offsetZMm: 0,
  scale: 1,
  positionMm: [100, 1_000, -200] as [number, number, number],
  orientationDeg: [10, 20, 30] as [number, number, number],
  presentationMode: "authored" as const,
};

describe("canonical 3D arrangement workspace", () => {
  it("uses millimetres without autoscale and round-trips one rigid transform", () => {
    const avatar = {} as AvatarParametricModel;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.001));
    const transform = resolveArrangementTransform(placement, avatar);
    placeMeshCentroid(mesh, transform);
    const captured = captureMeshArrangement(placement.id, mesh);

    expect(mesh.scale.toArray()).toEqual([1, 1, 1]);
    expect(captured.positionMm[0]).toBeCloseTo(100, 5);
    expect(captured.positionMm[1]).toBeCloseTo(1_000, 5);
    expect(captured.positionMm[2]).toBeCloseTo(-200, 5);
    expect(captured.orientationDeg).toEqual(expect.arrayContaining([
      expect.closeTo(10, 5),
      expect.closeTo(20, 5),
      expect.closeTo(30, 5),
    ]));
  });

  it("packs unassigned panels beside the current body deterministically without overlap", () => {
    const body = stagingBody();
    const panels = [
      { instanceId: "panel-d", sizeM: [0.28, 0.46, 0] as [number, number, number] },
      { instanceId: "panel-b", sizeM: [0.24, 0.52, 0] as [number, number, number] },
      { instanceId: "panel-a", sizeM: [0.31, 0.4, 0] as [number, number, number] },
      { instanceId: "panel-c", sizeM: [0.2, 0.34, 0] as [number, number, number] },
    ];
    const layout = resolveDeterministicStagingLayout(panels, body);
    const shuffled = resolveDeterministicStagingLayout([...panels].reverse(), body);

    expect(layout.size).toBe(panels.length);
    for (const panel of panels) {
      expect(layout.get(panel.instanceId)).toEqual(shuffled.get(panel.instanceId));
      const transform = layout.get(panel.instanceId)!;
      const [x, y, z] = transform.positionM;
      const outsideLeft = x + panel.sizeM[0] * 0.5 < body.bounds.min[0];
      const outsideRight = x - panel.sizeM[0] * 0.5 > body.bounds.max[0];
      expect(outsideLeft || outsideRight).toBe(true);
      expect(y).toBeGreaterThan(body.bounds.min[1]);
      expect(y).toBeLessThan(body.bounds.max[1]);
      expect(z).toBeGreaterThan(body.bounds.max[2]);
      expect(transform.orientationDeg).toEqual([0, 0, 0]);
    }

    const boxes = panels.map((panel) => {
      const [x, y] = layout.get(panel.instanceId)!.positionM;
      return {
        minX: x - panel.sizeM[0] * 0.5,
        maxX: x + panel.sizeM[0] * 0.5,
        minY: y - panel.sizeM[1] * 0.5,
        maxY: y + panel.sizeM[1] * 0.5,
      };
    });
    for (let first = 0; first < boxes.length; first += 1) {
      for (let second = first + 1; second < boxes.length; second += 1) {
        const separated = boxes[first].maxX <= boxes[second].minX
          || boxes[second].maxX <= boxes[first].minX
          || boxes[first].maxY <= boxes[second].minY
          || boxes[second].maxY <= boxes[first].minY;
        expect(separated).toBe(true);
      }
    }
  });

  it("keeps an oversized staging panel at full size in a finite body-relative slot", () => {
    const body = stagingBody();
    const panel = { instanceId: "oversized", sizeM: [0.9, 2.2, 0] as [number, number, number] };
    const transform = resolveDeterministicStagingLayout([panel], body).get(panel.instanceId)!;

    expect(transform.positionM.every(Number.isFinite)).toBe(true);
    expect(transform.positionM[1]).toBeCloseTo(0.875, 6);
    expect(transform.positionM[0] + panel.sizeM[0] * 0.5).toBeLessThan(body.bounds.min[0]);
  });

  it("preserves the exact grab point on a stable camera-parallel free-drag plane", () => {
    const grabPoint = new THREE.Vector3(0.18, 0.42, 0.7);
    const plane = createCameraDragPlane(grabPoint, new THREE.Vector3(0, 0, -1));
    const initialRay = new THREE.Ray(new THREE.Vector3(0.18, 0.42, 2), new THREE.Vector3(0, 0, -1));
    const movedRay = new THREE.Ray(new THREE.Vector3(0.41, 0.17, 2), new THREE.Vector3(0, 0, -1));
    const initial = intersectPointerRayWithDragPlane(initialRay, plane);
    const moved = intersectPointerRayWithDragPlane(movedRay, plane);

    expect(initial?.toArray()).toEqual(expect.arrayContaining([
      expect.closeTo(0.18, 8),
      expect.closeTo(0.42, 8),
      expect.closeTo(0.7, 8),
    ]));
    expect(moved?.z).toBeCloseTo(0.7, 8);
    expect(moved!.clone().sub(initial!).toArray()).toEqual(expect.arrayContaining([
      expect.closeTo(0.23, 8),
      expect.closeTo(-0.25, 8),
      expect.closeTo(0, 8),
    ]));
  });

  it("projects axis drag onto a stable plane containing the requested world axis", () => {
    const point = new THREE.Vector3(0.1, 0.2, 0.3);
    const plane = createAxisDragPlane(point, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1));
    expect(Math.abs(plane.normal.dot(new THREE.Vector3(1, 0, 0)))).toBeLessThan(1e-8);
    expect(Math.abs(plane.distanceToPoint(point))).toBeLessThan(1e-8);
  });

  it("blocks a rigid panel from crossing a body surface while preserving tangential movement", () => {
    const body = planarBody();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12, 1, 1));
    mesh.position.set(0, 0, 0.08);
    mesh.updateMatrixWorld(true);
    const barrier = createBodyBarrierState(mesh, 20);
    mesh.position.set(0.25, 0.1, -0.08);
    mesh.updateMatrixWorld(true);
    const result = constrainMeshOutsideBody(mesh, body, barrier, { clearanceMm: 8 });
    const audit = auditMeshBodyClearance(mesh, body, 1, 64);
    expect(result.corrected).toBe(true);
    expect(mesh.position.x).toBeGreaterThan(0.2);
    expect(audit.penetratingSamples).toBe(0);
    expect(minimumWorldZ(mesh)).toBeGreaterThan(0);
  });

  it("keeps a body candidate through hysteresis and rejects an implausible triangle jump", () => {
    const grab = new THREE.Vector3(0, 0, 0);
    const near = frameAt([0.1, 0, 0], 1);
    const moderate = frameAt([0.18, 0, 0], 2);
    const jumped = frameAt([0.18, 0.3, 0], 3);

    const entered = updateSurfaceCandidate(undefined, near, grab);
    expect(entered?.attachment.triangleIndex).toBe(1);
    const retained = updateSurfaceCandidate(entered, null, new THREE.Vector3(0.2, 0, 0));
    expect(retained?.attachment.triangleIndex).toBe(1);
    const updated = updateSurfaceCandidate(entered, moderate, new THREE.Vector3(0.18, 0, 0));
    expect(updated?.attachment.triangleIndex).toBe(2);
    const guarded = updateSurfaceCandidate(updated, jumped, new THREE.Vector3(0.18, 0, 0));
    expect(guarded?.attachment.triangleIndex).toBe(2);
    const exited = updateSurfaceCandidate(guarded, null, new THREE.Vector3(0.5, 0, 0));
    expect(exited).toBeUndefined();
  });

  it("adjusts a panel with positive local clearance and preserves edge metric", () => {
    const body = planarBody();
    const geometry = new THREE.PlaneGeometry(0.1, 0.1, 1, 1);
    const mesh = new THREE.Mesh(geometry);
    const reference = new Float32Array((geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array);
    mesh.rotation.set(0.35, 0.2, 0.1);
    mesh.position.set(0, 0, 0.08);
    mesh.updateMatrixWorld(true);

    const result = adjustMeshToBodySurface(mesh, body, {
      version: 1,
      topologySignature: body.topologySignature,
      triangleIndex: 0,
      barycentric: [0.25, 0.25, 0.5],
      normalOffsetMm: 12,
    }, reference);

    expect(result.metricDistortionMax).toBeLessThanOrEqual(0.008);
    expect(result.minimumClearanceMm).toBeGreaterThanOrEqual(6);
    expect(mesh.scale.toArray()).toEqual([1, 1, 1]);
    expect(minimumWorldZ(mesh)).toBeGreaterThan(0);
  });

  it("flipping panel face does not invert the body-outward placement direction", () => {
    const body = planarBody();
    const geometry = new THREE.PlaneGeometry(0.1, 0.1, 1, 1);
    const mesh = new THREE.Mesh(geometry);
    const reference = new Float32Array((geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array);
    mesh.rotateY(Math.PI);
    mesh.updateMatrixWorld(true);

    adjustMeshToBodySurface(mesh, body, {
      version: 1,
      topologySignature: body.topologySignature,
      triangleIndex: 0,
      barycentric: [0.25, 0.25, 0.5],
      normalOffsetMm: 12,
    }, reference);

    expect(minimumWorldZ(mesh)).toBeGreaterThan(0);
    expect(captureMeshArrangement("panel", mesh).positionMm[2]).toBeGreaterThan(0);
  });

  it("derives presentation state rather than persisting simulation lifecycle", () => {
    expect(arrangementVisualState({ ...placement, presentationMode: "staging" }, false)).toBe("POSICIONAR");
    expect(arrangementVisualState(placement, false)).toBe("AJUSTADO");
    expect(arrangementVisualState(placement, true)).toBe("SIMULADO");
  });

  it("applies the authored pose to STEP 0 as a metric-preserving rigid transform", () => {
    const positions = new Float32Array([0, 0, 0, 0.1, 0, 0, 0.1, 0.2, 0, 0, 0.2, 0]);
    const state = {
      positions: new Float32Array(positions),
      initialPositions: new Float32Array(positions),
      previousPositions: new Float32Array(positions),
      instances: [{
        id: placement.id,
        particleStart: 0,
        vertexCount: 4,
        topology: { positions2DMm: new Float32Array([0, 0, 100, 0, 100, 200, 0, 200]) },
      }],
    } as unknown as GarmentAssemblyState;
    const input = {
      garmentProjection: { pieces: [{ previewPlacements: [placement] }] },
    } as unknown as ResolvedAssemblyInput;

    applyAuthoredArrangementToAssemblyState(state, input, {} as AvatarParametricModel);
    const distance = Math.hypot(
      state.positions[3] - state.positions[0],
      state.positions[4] - state.positions[1],
      state.positions[5] - state.positions[2],
    );
    const centroid = [0, 0, 0];
    for (let index = 0; index < 4; index += 1) {
      centroid[0] += state.positions[index * 3] / 4;
      centroid[1] += state.positions[index * 3 + 1] / 4;
      centroid[2] += state.positions[index * 3 + 2] / 4;
    }
    expect(distance).toBeCloseTo(0.1, 6);
    expect(centroid).toEqual(expect.arrayContaining([
      expect.closeTo(0.1, 6),
      expect.closeTo(1, 6),
      expect.closeTo(-0.2, 6),
    ]));
  });
});

function frameAt(position: [number, number, number], triangleIndex: number): BodySurfaceFrame {
  return {
    attachment: {
      version: 1,
      topologySignature: "body",
      triangleIndex,
      barycentric: [1, 0, 0],
      normalOffsetMm: 12,
    },
    position,
    outwardNormal: [0, 0, 1],
    tangent: [1, 0, 0],
    axis: [0, 1, 0],
  };
}

function planarBody(): HumanBodyMesh {
  return {
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    regionIds: ["chest-front", "chest-front", "chest-front"],
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    topologySignature: "body",
    sourceAssetId: "canonical-female.glb",
  };
}

function stagingBody(): HumanBodyMesh {
  return {
    ...planarBody(),
    bounds: { min: [-0.35, 0, -0.2], max: [0.35, 1.75, 0.25] },
  };
}

function minimumWorldZ(mesh: THREE.Mesh): number {
  mesh.updateMatrixWorld(true);
  const positions = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
    minimum = Math.min(minimum, point.z);
  }
  return minimum;
}
