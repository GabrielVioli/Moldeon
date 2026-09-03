import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { AvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { BodySurfaceFrame } from "../avatar/BodySurfaceQuery";
import type { HumanBodyMesh } from "../avatar/HumanBodyModel";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import type { ResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import {
  adjustMeshToBodySurface,
  applyFrozenRigidRotation,
  applyFrozenRigidTranslation,
  axisParameterOnDragPlane,
  applyAuthoredArrangementToAssemblyState,
  arrangementVisualState,
  auditMeshBodyClearance,
  captureMeshArrangement,
  constrainMeshOutsideBody,
  constrainRigidMeshGroupOutsideBody,
  createAxisDragPlane,
  createBodyBarrierState,
  createCameraDragPlane,
  closestRayAxisParameter,
  intersectPointerRayWithDragPlane,
  placeMeshCentroid,
  perspectiveWorldUnitsPerPixel,
  resolveDeterministicStagingLayout,
  resolveArrangementTransform,
  signedRotationAngle,
  unwrapRotationAngle,
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

  it("keeps an authored rigid transform authoritative over a conform attachment", () => {
    const transform = resolveArrangementTransform({
      ...placement,
      surfaceAttachment: {
        version: 1,
        topologySignature: "body",
        triangleIndex: 0,
        barycentric: [0.25, 0.25, 0.5],
        normalOffsetMm: 12,
      },
    }, { humanBody: { visualMesh: planarBody() } } as AvatarParametricModel);

    expect(transform.positionM).toEqual([0.1, 1, -0.2]);
    expect(transform.orientationDeg).toEqual([10, 20, 30]);
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

  it("solves axis translation continuously from the frozen ray-axis relationship", () => {
    const origin = new THREE.Vector3(0, 0, 0);
    const axis = new THREE.Vector3(1, 0, 0);
    const rayAt = (x: number) => new THREE.Ray(
      new THREE.Vector3(0, 0, 5),
      new THREE.Vector3(x, 0, -5).normalize(),
    );
    const start = closestRayAxisParameter(rayAt(0.2), origin, axis)!;
    const forward = closestRayAxisParameter(rayAt(0.8), origin, axis)!;
    const reverse = closestRayAxisParameter(rayAt(-0.1), origin, axis)!;

    expect(start).toBeCloseTo(0.2, 6);
    expect(forward - start).toBeCloseTo(0.6, 6);
    expect(reverse - start).toBeCloseTo(-0.3, 6);
    expect(closestRayAxisParameter(
      new THREE.Ray(new THREE.Vector3(0, 0, 0), axis.clone()),
      origin,
      axis,
    )).toBeNull();
  });

  it("uses one frozen geometric plane when ray and axis are nearly parallel", () => {
    const origin = new THREE.Vector3(0, 0, 0);
    const axis = new THREE.Vector3(0, 0, 1);
    const plane = createAxisDragPlane(origin, axis, new THREE.Vector3(0, 0, -1));
    const start = axisParameterOnDragPlane(
      new THREE.Ray(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, -0.2, -1).normalize()),
      plane,
      origin,
      axis,
    );
    const moved = axisParameterOnDragPlane(
      new THREE.Ray(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, -0.4, -1).normalize()),
      plane,
      origin,
      axis,
    );
    expect(start).not.toBeNull();
    expect(moved).not.toBeNull();
    expect(Number.isFinite(moved! - start!)).toBe(true);
  });

  it("derives the parallel-axis fallback scale from camera projection instead of a fixed metre step", () => {
    const near = perspectiveWorldUnitsPerPixel(1, 36, 800);
    const far = perspectiveWorldUnitsPerPixel(2, 36, 800);
    const tallerViewport = perspectiveWorldUnitsPerPixel(1, 36, 1_600);
    expect(far).toBeCloseTo(near * 2, 10);
    expect(tallerViewport).toBeCloseTo(near * 0.5, 10);
    expect(near).toBeGreaterThan(0);
  });

  it("unwraps rotation continuously across the minus-pi/pi boundary", () => {
    const axis = new THREE.Vector3(0, 0, 1);
    const start = new THREE.Vector3(1, 0, 0);
    const beforeBoundary = signedRotationAngle(
      start,
      new THREE.Vector3(Math.cos(Math.PI - 0.02), Math.sin(Math.PI - 0.02), 0),
      axis,
    );
    const afterBoundary = signedRotationAngle(
      start,
      new THREE.Vector3(Math.cos(-Math.PI + 0.02), Math.sin(-Math.PI + 0.02), 0),
      axis,
    );
    const continuous = unwrapRotationAngle(beforeBoundary, afterBoundary, beforeBoundary);
    expect(continuous).toBeCloseTo(Math.PI + 0.02, 6);
  });

  it("derives multiselect translation and rotation from one frozen group snapshot", () => {
    const first = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.01));
    const second = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.01));
    const firstStart = new THREE.Vector3(-0.4, 0.8, 0.2);
    const secondStart = new THREE.Vector3(0.4, 0.8, 0.2);
    const identity = new THREE.Quaternion();
    const translation = new THREE.Vector3(0.3, -0.2, 0.1);
    applyFrozenRigidTranslation(first, firstStart, identity, translation);
    applyFrozenRigidTranslation(second, secondStart, identity, translation);
    expect(first.position.distanceTo(second.position)).toBeCloseTo(0.8, 8);

    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    const pivot = new THREE.Vector3(0, 0.8, 0.2);
    applyFrozenRigidRotation(first, firstStart, identity, pivot, rotation);
    applyFrozenRigidRotation(second, secondStart, identity, pivot, rotation);
    expect(first.position.distanceTo(second.position)).toBeCloseTo(0.8, 8);
    expect(first.position.x).toBeCloseTo(0, 8);
    expect(second.position.x).toBeCloseTo(0, 8);
    expect(first.quaternion.angleTo(second.quaternion)).toBeCloseTo(0, 8);
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

  it("keeps X/Y/Z axis parameters continuous in portrait, landscape and oblique views", () => {
    for (const aspect of [390 / 844, 844 / 390]) {
      const camera = new THREE.PerspectiveCamera(36, aspect, 0.01, 100);
      camera.position.set(2, 1.5, 5);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
        const parameters = [-0.2, -0.1, 0, 0.1, 0.2].map((expected) => {
          const ndc = axis.clone().multiplyScalar(expected).project(camera);
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
          return closestRayAxisParameter(raycaster.ray, new THREE.Vector3(), axis)!;
        });
        parameters.forEach((value, index) => expect(value).toBeCloseTo(-0.2 + index * 0.1, 5));
        for (let index = 1; index < parameters.length; index += 1) {
          expect(parameters[index] - parameters[index - 1]).toBeCloseTo(0.1, 5);
        }
      }
    }
  });

  it("applies frozen no-body translation only on the selected X/Y/Z axis", () => {
    for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1));
      const start = new THREE.Vector3(0.2, 0.4, 0.6);
      applyFrozenRigidTranslation(mesh, start, new THREE.Quaternion(), axis.clone().multiplyScalar(0.17));
      const actual = mesh.position.clone().sub(start);
      expect(actual.distanceTo(axis.clone().multiplyScalar(0.17))).toBeLessThan(1e-9);
    }
  });

  it("does not replace a first crossing with a stronger correction from a competing surface", () => {
    const body = competingSurfaceBody();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      -0.2, -0.2, 0,
      -0.18, -0.2, 0,
      0.145, -0.2, 0.16,
    ], 3));
    geometry.setIndex([0, 1, 2]);
    const mesh = new THREE.Mesh(geometry);
    mesh.position.z = 0.02;
    mesh.updateMatrixWorld(true);
    const barrier = createBodyBarrierState(mesh, 20);

    mesh.position.z = -0.01;
    mesh.updateMatrixWorld(true);
    constrainMeshOutsideBody(mesh, body, barrier, { clearanceMm: 8 });

    expect(Math.abs(mesh.position.x)).toBeLessThan(0.001);
    expect(mesh.position.z).toBeGreaterThanOrEqual(0.0079);
    mesh.position.set(0, 0, -0.012);
    mesh.updateMatrixWorld(true);
    const retained = constrainMeshOutsideBody(mesh, body, barrier, { clearanceMm: 8 });
    expect(Math.abs(mesh.position.x)).toBeLessThan(0.001);
    expect(mesh.position.z).toBeGreaterThanOrEqual(0.0079);
    expect(retained.contactSource).toBe("persistent");
  });

  it("approaches, leaves and re-enters a body contact continuously without tangential drift", () => {
    const body = planarBody();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08, 1, 1));
    mesh.position.set(0.15, -0.1, 0.03);
    mesh.updateMatrixWorld(true);
    const barrier = createBodyBarrierState(mesh, 20);
    const rawZ = [0.02, 0.012, 0.006, 0, -0.01, 0.006, 0.012, 0.025, 0.006];
    const finalZ: number[] = [];
    for (const z of rawZ) {
      mesh.position.set(0.15, -0.1, z);
      mesh.updateMatrixWorld(true);
      const result = constrainMeshOutsideBody(mesh, body, barrier, { clearanceMm: 8 });
      finalZ.push(mesh.position.z);
      expect(result.correctionTangentialMm).toBeLessThan(1e-7);
      expect(mesh.position.x).toBeCloseTo(0.15, 8);
      expect(mesh.position.y).toBeCloseTo(-0.1, 8);
    }
    finalZ.forEach((z, index) => expect(z).toBeCloseTo(Math.max(rawZ[index], 0.008), 5));
  });

  it("crosses adjacent triangles without a correction jump", () => {
    const body = quadBody();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.04, 1, 1));
    mesh.position.set(-0.15, -0.1, 0.012);
    mesh.updateMatrixWorld(true);
    const barrier = createBodyBarrierState(mesh, 20);
    for (const x of [-0.12, -0.06, 0, 0.06, 0.12]) {
      mesh.position.set(x, -0.1, 0.006);
      mesh.updateMatrixWorld(true);
      const result = constrainMeshOutsideBody(mesh, body, barrier, { clearanceMm: 8 });
      expect(mesh.position.x).toBeCloseTo(x, 6);
      expect(mesh.position.z).toBeCloseTo(0.008, 5);
      expect(result.correctionTangentialMm).toBeLessThan(1e-7);
    }
  });

  it("blocks X-axis crossing without creating Y/Z motion", () => {
    const body = xPlaneBody();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08, 1, 1));
    mesh.rotateY(Math.PI / 2);
    mesh.position.set(0.03, 0.12, -0.15);
    mesh.updateMatrixWorld(true);
    const barrier = createBodyBarrierState(mesh, 20);
    mesh.position.x = -0.01;
    mesh.updateMatrixWorld(true);
    constrainMeshOutsideBody(mesh, body, barrier, { clearanceMm: 8 });
    expect(mesh.position.x).toBeCloseTo(0.008, 5);
    expect(mesh.position.y).toBeCloseTo(0.12, 8);
    expect(mesh.position.z).toBeCloseTo(-0.15, 8);
  });

  it.each([2, 4])("keeps a %i-panel body-barrier selection rigid", (count) => {
    const body = planarBody();
    const meshes = Array.from({ length: count }, (_, index) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.04, 1, 1));
      mesh.position.set((index - (count - 1) * 0.5) * 0.12, -0.2, 0.03);
      mesh.updateMatrixWorld(true);
      return mesh;
    });
    const members = meshes.map((mesh, index) => ({ key: `panel-${index}`, mesh, state: createBodyBarrierState(mesh, 12) }));
    const initialDistances = meshes.slice(1).map((mesh) => mesh.position.distanceTo(meshes[0].position));
    for (const mesh of meshes) {
      mesh.position.z = -0.01;
      mesh.updateMatrixWorld(true);
    }
    constrainRigidMeshGroupOutsideBody(members, body, {}, { clearanceMm: 8 });
    meshes.forEach((mesh) => expect(mesh.position.z).toBeCloseTo(0.008, 5));
    meshes.slice(1).forEach((mesh, index) => {
      expect(mesh.position.distanceTo(meshes[0].position)).toBeCloseTo(initialDistances[index], 8);
    });
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
    mesh.rotation.set(0, 0, 0.35);
    mesh.position.set(0.25, 0.1, 0.02);
    mesh.updateMatrixWorld(true);
    const authoredPosition = mesh.position.clone();
    const authoredOrientation = mesh.quaternion.clone();

    const result = adjustMeshToBodySurface(mesh, body, {
      version: 1,
      topologySignature: body.topologySignature,
      triangleIndex: 0,
      barycentric: [0.25, 0.25, 0.5],
      normalOffsetMm: 12,
    }, reference);

    expect(result.metricDistortionMax).toBeLessThanOrEqual(0.008);
    expect(result.minimumClearanceMm).toBeGreaterThanOrEqual(6);
    expect(result.anchorTangentialDisplacementMm).toBeLessThan(1e-4);
    expect(mesh.position.x).toBeCloseTo(authoredPosition.x, 8);
    expect(mesh.position.y).toBeCloseTo(authoredPosition.y, 8);
    expect(result.anchorNormalDisplacementMm).toBeCloseTo(-8, 3);
    expect(mesh.quaternion.angleTo(authoredOrientation)).toBeLessThan(1e-7);
    expect(mesh.scale.toArray()).toEqual([1, 1, 1]);
    expect(minimumWorldZ(mesh)).toBeGreaterThan(0);
  });

  it("rejects conform far from the body without changing geometry or placement", () => {
    const body = planarBody();
    const geometry = new THREE.PlaneGeometry(0.1, 0.1, 1, 1);
    const mesh = new THREE.Mesh(geometry);
    mesh.position.set(-0.32, 0.18, 0.25);
    mesh.rotation.set(0.1, -0.2, 0.3);
    mesh.updateMatrixWorld(true);
    const beforePositions = Array.from((geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array);
    const beforePosition = mesh.position.clone();
    const beforeOrientation = mesh.quaternion.clone();

    const result = adjustMeshToBodySurface(mesh, body, {
      version: 1,
      topologySignature: body.topologySignature,
      triangleIndex: 0,
      barycentric: [0.25, 0.25, 0.5],
      normalOffsetMm: 12,
    }, new Float32Array(beforePositions));

    expect(result.conformed).toBe(false);
    expect(result.reason).toBe("too-far");
    expect(Array.from((geometry.getAttribute("position") as THREE.BufferAttribute).array)).toEqual(beforePositions);
    expect(mesh.position.distanceTo(beforePosition)).toBeLessThan(1e-10);
    expect(mesh.quaternion.angleTo(beforeOrientation)).toBeLessThan(1e-7);
  });

  it("flipping panel face does not invert the body-outward placement direction", () => {
    const body = planarBody();
    const geometry = new THREE.PlaneGeometry(0.1, 0.1, 1, 1);
    const mesh = new THREE.Mesh(geometry);
    const reference = new Float32Array((geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array);
    mesh.rotateY(Math.PI);
    mesh.position.z = 0.02;
    mesh.updateMatrixWorld(true);
    const authoredOrientation = mesh.quaternion.clone();

    adjustMeshToBodySurface(mesh, body, {
      version: 1,
      topologySignature: body.topologySignature,
      triangleIndex: 0,
      barycentric: [0.25, 0.25, 0.5],
      normalOffsetMm: 12,
    }, reference);

    expect(minimumWorldZ(mesh)).toBeGreaterThan(0);
    expect(captureMeshArrangement("panel", mesh).positionMm[2]).toBeGreaterThan(0);
    expect(mesh.quaternion.angleTo(authoredOrientation)).toBeLessThan(1e-7);
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

function competingSurfaceBody(): HumanBodyMesh {
  return {
    positions: new Float32Array([
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
      0.2, -1, -1, 0.2, 1, -1, 0.2, 0, 1,
    ]),
    normals: new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
      1, 0, 0, 1, 0, 0, 1, 0, 0,
    ]),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    regionIds: ["chest-front", "chest-front", "chest-front", "upper-arm-left", "upper-arm-left", "upper-arm-left"],
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    topologySignature: "competing-surfaces",
    sourceAssetId: "canonical-female.glb",
  };
}

function quadBody(): HumanBodyMesh {
  return {
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    regionIds: ["chest-front", "chest-front", "chest-front", "chest-front"],
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    topologySignature: "quad",
    sourceAssetId: "canonical-female.glb",
  };
}

function xPlaneBody(): HumanBodyMesh {
  return {
    positions: new Float32Array([0, -1, -1, 0, 1, -1, 0, 0, 1]),
    normals: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
    indices: new Uint32Array([0, 1, 2]),
    regionIds: ["upper-arm-left", "upper-arm-left", "upper-arm-left"],
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    topologySignature: "x-plane",
    sourceAssetId: "canonical-female.glb",
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
