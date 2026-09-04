import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  approvedAvatarForBody,
  AVATAR_NOT_CONFIGURED_MESSAGE,
} from "../avatar/ApprovedAvatarAsset";
import { loadApprovedAvatar } from "../avatar/ApprovedAvatarLoader";
import { buildAvatarParametricModel, type AvatarParametricModel } from "../avatar/AvatarParametricModel";
import { createAvatarVisual } from "./AvatarVisual";
import { createAvatarCollisionDebugVisual } from "./AvatarCollisionDebugVisual";
import { resolveAvatarFloorPosition } from "./AvatarGroundPlane";
import {
  IDENTITY_BODY_TRANSFORM,
  type SimulationBodyTransform,
} from "../physics/bodyCollision";
import { packHumanBodyMesh, type PackedBodyMesh } from "../physics/exactBodySurface";
import {
  applyGarmentBodyRegistration,
  resolveGarmentBodyRegistration,
  type GarmentRegistrationDiagnostic,
  type GarmentRegistrationStatus,
} from "../physics/GarmentBodyRegistration";
import type { BodyType, EdgeRange, Seam } from "../domain/pattern";
import {
  buildGarmentAssemblyMeshes,
  adoptGarmentAssemblyMesh,
  canReuseGarmentAssemblyMesh,
  captureGarmentMeshDiagnostics,
  type GarmentAssemblyMeshData,
} from "../garment3d/GarmentThreeBridge";
import type { ResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { serializePatternDocumentV3 } from "../domain/patternDocumentV3";
import { AssemblyWorkerClient } from "../garment3d/AssemblyWorkerClient";
import { buildGlobalStitchConstraints, measureIntrinsicDistortion, type GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import { refreshMeshFromAssembly } from "../garment3d/GarmentThreeBridge";
import { buildXpbdInitialization } from "../physics/GarmentXpbdAdapter";
import { XpbdWorkerClient } from "../physics/XpbdWorkerClient";
import type {
  XpbdAutoPauseSteps,
  XpbdSimulationCadence,
  XpbdWorkerDiagnostics,
} from "../physics/xpbdProtocol";
import { closestBodySurfacePoint, prepareBodySurfaceQuery, raycastBodySurface, resolveBodySurfaceAttachment, type BodySurfaceFrame } from "../avatar/BodySurfaceQuery";
import {
  adjustMeshToBodySurface,
  applyFrozenRigidRotation,
  applyFrozenRigidTranslation,
  axisParameterOnDragPlane,
  applyAuthoredArrangementToAssemblyState,
  auditMeshBodyClearance,
  captureMeshArrangement,
  closestRayAxisParameter,
  constrainMeshOutsideBody,
  constrainRigidMeshGroupOutsideBody,
  createAxisDragPlane,
  createBodyBarrierState,
  createCameraDragPlane,
  intersectPointerRayWithDragPlane,
  placeMeshCentroid,
  perspectiveWorldUnitsPerPixel,
  resolveDeterministicStagingLayout,
  resolveArrangementTransform,
  restoreMeshMaterialGeometry,
  signedRotationAngle,
  unwrapRotationAngle,
  updateSurfaceCandidate,
  type ArrangementCommit,
  type BodyBarrierResult,
  type BodyBarrierState,
  type RigidBodyBarrierGroupState,
} from "./ArrangementWorkspace";
import { SewingViewportOverlay, type SewingOverlaySelection } from "./SewingViewportOverlay";
import { connectedSewingInstanceIds } from "./SewingInteraction";
import {
  auditSewingStep0Seams,
  measureCurrentSewingStep0MaterialDistortion,
  measureCurrentSewingStep0Residual,
  meshWorldMaterialAnchor as sewingStep0MeshWorldMaterialAnchor,
  meshWorldVertex as sewingStep0MeshWorldVertex,
  resolveSewingStep0Target,
  solvePlacementAnchoredSewingStep0,
  syncMeshGeometryToAssemblyState,
  type SewingStep0RunResult,
} from "./SewingStep0";
import {
  applyWorkspaceAssemblySeed,
  assemblyPositionSignature,
  captureAssemblyTransitionDiagnostic,
  captureWorkspaceAssemblySeed,
  type WorkspaceAssemblyCapture,
} from "./AssemblyModeTransition";

export type RenderBackend = "webgpu" | "webgl2";
export type ThreeViewportMode = "assembly" | "fitting";
export type ArrangementTool = "move" | "rotate";
export type ArrangementAxis = "free" | "x" | "y" | "z";

export interface SewingViewportState extends SewingOverlaySelection {
  active: boolean;
  showThreads: boolean;
  selectedSeamId: string | null;
  proposal: Seam | null;
}

export function shouldExtendArrangementSelection(input: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  pointerType: string;
  touchMultiSelect: boolean;
}): boolean {
  return input.ctrlKey || input.metaKey || input.shiftKey
    || (input.pointerType === "touch" && input.touchMultiSelect);
}

export function arrangementGizmoTargetPixels(width: number, height: number, coarsePointer: boolean): number {
  if (!coarsePointer || Math.min(width, height) > 900) return 86;
  return width > height ? 64 : 70;
}
export type SimulationLifecycleState = "paused" | "running";
export interface SimulationDevSettings {
  gravityScale: 0 | 0.25 | 1;
  cadence: XpbdSimulationCadence;
  autoPauseSteps: XpbdAutoPauseSteps;
  bodyCollisionEnabled: boolean;
  floorCollisionEnabled: boolean;
  showBodyColliders: boolean;
  showProceduralAvatar: boolean;
  showRegistrationAxes: boolean;
}
export interface SimulationDevTelemetry extends XpbdWorkerDiagnostics {
  approximateFps: number;
  bodyRegistrationStatus: GarmentRegistrationStatus;
}
type ViewportRenderer = THREE.WebGLRenderer | WebGPURenderer;

interface PerformanceProfile {
  antialias: boolean;
  maxPixelRatio: number;
  shadows: boolean;
}

interface ArrangementDragTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

interface ArrangementDragState {
  pointerId: number;
  activeInstanceId: string;
  tool: ArrangementTool;
  dragPlane: THREE.Plane;
  translationStartPoint: THREE.Vector3;
  axisOrigin: THREE.Vector3;
  axisStartParameter?: number;
  axisSolveMode?: "closest" | "plane" | "screen";
  axisAlignment: number;
  axisScreenStart?: THREE.Vector2;
  axisWorldUnitsPerPixel?: number;
  initialTransforms: Map<string, ArrangementDragTransform>;
  rotationPivot: THREE.Vector3;
  rotationAxis: THREE.Vector3;
  rotationPlane?: THREE.Plane;
  rotationStartVector?: THREE.Vector3;
  rotationSolveMode?: "plane" | "screen";
  rotationScreenStart?: THREE.Vector2;
  rotationScreenTangent?: THREE.Vector2;
  rotationPixelsPerRad?: number;
  rotationLastRawAngle: number;
  rotationAccumulatedAngle: number;
  axis: ArrangementAxis;
  barriers: Map<string, BodyBarrierState>;
  barrierGroupState: RigidBodyBarrierGroupState;
  surfaceAttachments: Map<string, ArrangementCommit["surfaceAttachment"]>;
  surfaceCandidate?: BodySurfaceFrame;
  lastPointerClient: THREE.Vector2;
  previousFinalPosition: THREE.Vector3;
  moved: boolean;
}

interface ArrangementHandleHit {
  point: THREE.Vector3;
  axis: Exclude<ArrangementAxis, "free">;
  tool: ArrangementTool;
}

export class ThreeViewport {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
  private readonly controls: OrbitControls;
  private readonly garmentGroup = new THREE.Group();
  private readonly avatarGroup = new THREE.Group();
  private readonly proceduralAvatarGroup = new THREE.Group();
  private readonly bodyColliderDebugGroup = new THREE.Group();
  private readonly registrationAxesGroup = new THREE.Group();
  private readonly arrangementCandidateMarker = createArrangementCandidateMarker();
  private readonly arrangementGizmo = createArrangementGizmo();
  private readonly sewingOverlay = new SewingViewportOverlay();
  private readonly floor: THREE.Mesh;
  private readonly resizeObserver: ResizeObserver;
  private readonly profile: PerformanceProfile;
  private readonly renderer: ViewportRenderer;
  private garmentMeshes: GarmentAssemblyMeshData[] = [];
  private readonly simulation: XpbdWorkerClient;
  private readonly assembly = new AssemblyWorkerClient();
  private assemblyState: GarmentAssemblyState | null = null;
  private pendingAssemblyRevision: string | null = null;
  private assemblyRevision: string | null = null;
  private assemblyGeneration = 0;
  private simulationEpoch = 0;
  private avatarSignature: string | null = null;
  private avatarLoadController: AbortController | null = null;
  private hasFramedScene = false;
  private lastFramedAssemblyRevision: string | null = null;
  private frameId: number | null = null;
  private lastFrameAt = 0;
  private disposed = false;
  private simulationRunning = false;
  private resumeAfterVisibility = false;
  private framesReceived = 0;
  private framesApplied = 0;
  private framesDiscarded = 0;
  private baseGravity: [number, number, number] = [0, -9.81, 0];
  private devSettings: SimulationDevSettings = { gravityScale: 1, cadence: 1, autoPauseSteps: 0, bodyCollisionEnabled: true, floorCollisionEnabled: true, showBodyColliders: false, showProceduralAvatar: true, showRegistrationAxes: false };
  private bodyRegistrationStatus: GarmentRegistrationStatus = "body-placement-required";
  private currentAvatarModel: AvatarParametricModel | null = null;
  private currentBodyTransform: SimulationBodyTransform = IDENTITY_BODY_TRANSFORM;
  private wireframeEnabled = false;
  private approximateFps = 0;
  private lastAppliedFrameAt = 0;
  private viewportMode: ThreeViewportMode = "fitting";
  private currentInput: ResolvedAssemblyInput | null = null;
  private workspaceSimulationCapture: WorkspaceAssemblyCapture | null = null;
  private readonly selectedInstanceIds = new Set<string>();
  private arrangementCommitHandler?: (commits: ArrangementCommit[]) => void;
  private arrangementSelectionHandler?: (instanceIds: string[]) => void;
  private arrangementInteractionHandler?: (active: boolean) => void;
  private arrangementAxisHandler?: (axis: ArrangementAxis) => void;
  private arrangementTool: ArrangementTool = "move";
  private arrangementAxis: ArrangementAxis = "free";
  private arrangementTouchMultiSelect = false;
  private dragState: ArrangementDragState | null = null;
  private hoveredArrangementHandle: Pick<ArrangementHandleHit, "tool" | "axis"> | null = null;
  private hoveredArrangementInstanceId: string | null = null;
  private sewingState: SewingViewportState = {
    active: false,
    showThreads: true,
    selectedSeamId: null,
    first: [],
    second: [],
    proposal: null,
  };
  private sewingEdgeSelectHandler?: (range: EdgeRange, panelInstanceId: string, hitT: number) => void;
  private sewingSeamSelectHandler?: (seamId: string) => void;
  private readonly arrangementPointerMoveMs: number[] = [];
  private readonly arrangementFrameMs: number[] = [];
  private readonly arrangementReleaseMs: number[] = [];
  private readonly arrangementLongTasksMs: number[] = [];
  private arrangementInteractionLastFrameAt = 0;
  private arrangementReleaseStartedAt = 0;
  private arrangementInteractionWindowUntil = 0;
  private performanceObserver: PerformanceObserver | null = null;

  private constructor(
    private readonly host: HTMLElement,
    renderer: ViewportRenderer,
    readonly backend: RenderBackend,
    profile: PerformanceProfile,
    private readonly onSimulationStateChange?: (state: SimulationLifecycleState) => void,
    private readonly onSimulationDiagnosticsChange?: (diagnostics: SimulationDevTelemetry) => void,
  ) {
    this.renderer = renderer;
    this.profile = profile;
    this.floor = createFloor(profile.shadows);
    this.host.dataset.simulationWorker = "created";
    this.simulation = new XpbdWorkerClient({
      onFrame: (frame) => {
        this.framesReceived += 1;
        this.writeFrameCounters();
        this.host.dataset.simulationWorkerFrame = JSON.stringify({
          revision: frame.revision,
          generation: frame.generation,
          epoch: frame.epoch,
          sequence: frame.sequence,
          positionsLength: frame.positions.length,
          stepCount: frame.diagnostics.stepCount,
        });
        this.requestRender();
      },
      onReady: (revision, generation, epoch, diagnostics) => {
        this.host.dataset.simulationWorkerReady = JSON.stringify({ revision, generation, epoch });
        if (revision !== this.assemblyRevision || generation !== this.assemblyGeneration || epoch !== this.simulationEpoch) return;
        this.writeSimulationDiagnostics(diagnostics);
      },
      onState: (generation, running, disposed, snapshot) => {
        this.simulationRunning = running && !disposed;
        this.simulationEpoch = snapshot.epoch;
        this.host.dataset.simulationWorkerState = disposed
          ? "disposed"
          : `${running ? "running" : "paused"}:${generation}:${snapshot.epoch}`;
        this.host.dataset.simulationStatus = disposed ? "disposed" : running ? "running" : "paused";
        if (!disposed) this.onSimulationStateChange?.(running ? "running" : "paused");
        this.traceLifecycle("worker-state", snapshot);
        if (running) this.requestRender();
      },
      onDiscardedFrame: (revision, generation, epoch, reason) => {
        this.framesDiscarded += 1;
        this.writeFrameCounters();
        this.host.dataset.simulationDiscardedFrame = JSON.stringify({ revision, generation, epoch, reason });
        this.traceLifecycle("frame-discarded", { revision, generation, epoch, reason });
      },
      onError: (message, recoverable) => {
        console.error("Worker XPBD:", message);
        this.host.dataset.simulationStatus = recoverable ? "recoverable-error" : "error";
      },
    });
    this.scene.background = new THREE.Color(0xe9e6df);
    this.camera.position.set(2.1, 1.25, 3.2);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.maxPixelRatio));
    this.renderer.shadowMap.enabled = profile.shadows;
    this.renderer.domElement.className = "three-canvas";
    this.renderer.domElement.style.touchAction = "none";
    this.host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.45;
    this.controls.maxDistance = 12;
    this.controls.screenSpacePanning = true;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.controls.addEventListener("change", this.requestRender);
    this.renderer.domElement.addEventListener("pointerdown", this.handleArrangementPointerDown, { capture: true });
    this.renderer.domElement.addEventListener("pointermove", this.handleArrangementPointerMove, { capture: true });
    this.renderer.domElement.addEventListener("pointerup", this.handleArrangementPointerUp, { capture: true });
    this.renderer.domElement.addEventListener("pointercancel", this.handleArrangementPointerUp, { capture: true });
    this.renderer.domElement.addEventListener("pointerleave", this.handleArrangementPointerLeave, { capture: true });
    this.renderer.domElement.addEventListener("contextmenu", this.handleViewportContextMenu);

    this.avatarGroup.name = "avatar-root";
    this.garmentGroup.name = "garment-root";
    this.arrangementCandidateMarker.name = "arrangement-surface-candidate";
    this.scene.add(createLights());
    this.proceduralAvatarGroup.name = "avatar-procedural-dev-root";
    this.bodyColliderDebugGroup.name = "body-collider-debug-root";
    this.registrationAxesGroup.name = "registration-axes-dev-root";
    this.scene.add(this.avatarGroup);
    this.scene.add(this.proceduralAvatarGroup);
    this.scene.add(this.bodyColliderDebugGroup);
    this.scene.add(this.registrationAxesGroup);
    this.scene.add(this.garmentGroup);
    this.scene.add(this.arrangementCandidateMarker);
    this.scene.add(this.arrangementGizmo);
    this.scene.add(this.sewingOverlay.group);
    this.scene.add(this.floor);
    this.installArrangementPerformanceObserver();

    this.resizeObserver = new ResizeObserver(() => {
      this.refresh();
    });
    this.resizeObserver.observe(this.host);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    if (import.meta.env.DEV) this.installDevViewportBridge();
  }

  static async create(
    host: HTMLElement,
    signal?: AbortSignal,
    onSimulationStateChange?: (state: SimulationLifecycleState) => void,
    onSimulationDiagnosticsChange?: (diagnostics: SimulationDevTelemetry) => void,
  ): Promise<ThreeViewport> {
    if (signal?.aborted) throw new DOMException("Inicialização do viewport cancelada.", "AbortError");
    const profile = getPerformanceProfile();
    const rendererResult = await createRenderer(profile, signal);
    const viewport = new ThreeViewport(
      host,
      rendererResult.renderer,
      rendererResult.backend,
      profile,
      onSimulationStateChange,
      onSimulationDiagnosticsChange,
    );
    const abort = () => viewport.dispose();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted || viewport.disposed) throw new DOMException("Inicialização do viewport cancelada.", "AbortError");
      viewport.refresh();
      return viewport;
    } catch (error) {
      viewport.dispose();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  setArrangementInteractionHandlers(
    onCommit?: (commits: ArrangementCommit[]) => void,
    onSelectionChange?: (instanceIds: string[]) => void,
    onInteractionChange?: (active: boolean) => void,
    onAxisChange?: (axis: ArrangementAxis) => void,
  ): void {
    this.arrangementCommitHandler = onCommit;
    this.arrangementSelectionHandler = onSelectionChange;
    this.arrangementInteractionHandler = onInteractionChange;
    this.arrangementAxisHandler = onAxisChange;
  }

  setArrangementTool(tool: ArrangementTool): void {
    if (this.arrangementTool === tool) return;
    this.arrangementTool = tool;
    if (tool === "rotate" && this.arrangementAxis === "free") this.arrangementAxis = "z";
    this.host.dataset.arrangementTool = tool;
    this.host.dataset.arrangementAxis = this.arrangementAxis;
    this.hoveredArrangementHandle = null;
    this.hideArrangementCandidate();
    this.setArrangementPointerFeedback(this.hoveredArrangementInstanceId ? "panel" : "idle");
    this.updateArrangementGizmo();
  }

  setSewingState(
    state: SewingViewportState,
    onEdgeSelect?: (range: EdgeRange, panelInstanceId: string, hitT: number) => void,
    onSeamSelect?: (seamId: string) => void,
  ): void {
    this.sewingState = {
      active: state.active,
      showThreads: state.showThreads,
      selectedSeamId: state.selectedSeamId,
      first: state.first.map((range) => ({ ...range })),
      second: state.second.map((range) => ({ ...range })),
      proposal: state.proposal ? structuredClone(state.proposal) : null,
    };
    this.sewingEdgeSelectHandler = onEdgeSelect;
    this.sewingSeamSelectHandler = onSeamSelect;
    this.refreshSewingOverlay();
    if (!state.active && this.viewportMode === "assembly") this.setArrangementPointerFeedback("idle");
    this.requestRender();
  }

  setArrangementAxis(axis: ArrangementAxis): void {
    this.arrangementAxis = this.arrangementTool === "rotate" && axis === "free" ? "z" : axis;
    this.host.dataset.arrangementAxis = this.arrangementAxis;
    this.updateArrangementGizmo();
    this.requestRender();
  }

  setArrangementTouchMultiSelect(enabled: boolean): void {
    this.arrangementTouchMultiSelect = enabled;
    this.host.dataset.arrangementTouchMultiSelect = String(enabled);
    if (enabled) this.setArrangementPointerFeedback("panel");
    this.requestRender();
  }

  updateWorkspaceArrangement(
    input: ResolvedAssemblyInput,
    options: { transformOnly?: boolean } = {},
  ): void {
    this.currentInput = input;
    if (this.viewportMode !== "assembly") return;
    if (options.transformOnly) {
      this.host.dataset.arrangementRevision = input.arrangementRevision;
      this.host.dataset.arrangementXpbdInitializations = "0";
      this.host.dataset.arrangementCommitPath = "transform-only";
      this.finishArrangementReleaseLatency();
      this.requestRender();
      return;
    }
    delete this.host.dataset.arrangementCommitPath;
    const avatarModel = buildAvatarParametricModel(
      input.document.measurements.values,
      input.document.body.type,
      {
        profile: input.document.measurements.profile,
        origins: measurementOriginsFromDocument(input.document.measurements),
      },
    );
    this.currentAvatarModel = avatarModel;
    const surfaceWarmupStartedAt = performance.now();
    prepareBodySurfaceQuery(avatarModel.humanBody.visualMesh);
    this.host.dataset.arrangementSurfaceWarmupMs = (performance.now() - surfaceWarmupStartedAt).toFixed(2);
    this.avatarGroup.visible = false;
    this.configureDevBodyVisuals(avatarModel, undefined, IDENTITY_BODY_TRANSFORM);
    this.proceduralAvatarGroup.visible = true;
    this.applyWorkspaceArrangement(input, avatarModel);
    this.requestRender();
  }

  updateSewingRelationships(input: ResolvedAssemblyInput): void {
    this.currentInput = input;
    this.host.dataset.sewingRevision = input.sewingRevision;
    if (this.viewportMode !== "assembly" || !this.assemblyState) {
      this.requestRender();
      return;
    }

    const warnings: string[] = [];
    const dartConstraints = this.assemblyState.stitchConstraints.filter((constraint) =>
      constraint.seamGroupId.startsWith("dart:"),
    );
    const sewingConstraints = buildGlobalStitchConstraints(
      this.assemblyState.instances,
      input.garmentProjection.seams ?? [],
      warnings,
    );
    this.assemblyState.stitchConstraints = [...sewingConstraints, ...dartConstraints];
    this.host.dataset.sewingIncrementalUpdates = String(
      Number(this.host.dataset.sewingIncrementalUpdates ?? "0") + 1,
    );
    this.host.dataset.sewingIncrementalWarnings = JSON.stringify(warnings);
    this.host.dataset.sewingActiveConstraintCount = String(sewingConstraints.length);
    this.refreshSewingOverlay();
    this.requestRender();
  }

  async runSewingStep0(
    selectedSeamId: string | null = this.sewingState.selectedSeamId,
  ): Promise<SewingStep0RunResult> {
    const input = this.currentInput;
    const state = this.assemblyState;
    const avatar = this.currentAvatarModel;
    if (this.viewportMode !== "assembly" || !input || !state || !avatar) {
      return { status: "failed", affectedPanels: 0, warning: "Montagem 3D ainda não está pronta." };
    }
    const target = resolveSewingStep0Target(
      state.stitchConstraints,
      selectedSeamId,
      [...this.selectedInstanceIds],
    );
    if (!target) {
      const selectedGroup = selectedSeamId
        ? input.seamGroups.find((group) => group.id === selectedSeamId && group.active)
        : undefined;
      if (selectedGroup) {
        this.host.dataset.sewingStep0Status = "missing-physical-bindings";
        this.host.dataset.sewingStep0Diagnostics = JSON.stringify({
          rejectionReason: "missing-physical-bindings",
          seamGroupId: selectedGroup.id,
          physicalBindingCount: selectedGroup.physicalBindings?.length ?? 0,
        });
        return {
          status: "failed",
          affectedPanels: 0,
          warning: "A costura selecionada ainda não possui correspondências físicas válidas entre PanelInstances.",
        };
      }
      return { status: "no-seams", affectedPanels: 0 };
    }

    const targetIds = new Set(target.instanceIds);
    const missingPlacement = input.panelInstances.some((instance) =>
      targetIds.has(instance.id)
      && (instance.placementStatus !== "confirmed" || !instance.arrangementAnchor),
    );
    if (missingPlacement) {
      return { status: "needs-placement", affectedPanels: target.instanceIds.length };
    }

    const body = avatar.humanBody.visualMesh;
    prepareBodySurfaceQuery(body);
    const snapshots = new Map<string, {
      item: GarmentAssemblyMeshData;
      positions: Float32Array;
      position: THREE.Vector3;
      quaternion: THREE.Quaternion;
      scale: THREE.Vector3;
      materialAnchorVertex: number;
      materialAnchorWorld: THREE.Vector3;
      surface: BodySurfaceFrame;
      bodyAudit: ReturnType<typeof auditMeshBodyClearance>;
    }>();
    for (const instanceId of target.instanceIds) {
      const item = this.garmentMeshes.find((candidate) => candidate.key === instanceId);
      if (!item) return { status: "failed", affectedPanels: target.instanceIds.length };
      const materialAnchor = sewingStep0MeshWorldMaterialAnchor(item.mesh);
      const surface = closestBodySurfacePoint(
        body,
        [materialAnchor.position.x, materialAnchor.position.y, materialAnchor.position.z],
        0,
        0.24,
      );
      if (!surface) return { status: "too-far", affectedPanels: target.instanceIds.length };
      const position = item.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      item.mesh.updateMatrixWorld(true);
      snapshots.set(instanceId, {
        item,
        positions: new Float32Array(position.array as Float32Array),
        position: item.mesh.position.clone(),
        quaternion: item.mesh.quaternion.clone(),
        scale: item.mesh.scale.clone(),
        materialAnchorVertex: materialAnchor.vertexIndex,
        materialAnchorWorld: materialAnchor.position,
        surface,
        bodyAudit: auditMeshBodyClearance(item.mesh, body, 0.5, 112),
      });
    }

    const restoreSnapshots = (): void => {
      for (const snapshot of snapshots.values()) {
        restoreMeshMaterialGeometry(snapshot.item.mesh, snapshot.positions);
        snapshot.item.mesh.position.copy(snapshot.position);
        snapshot.item.mesh.quaternion.copy(snapshot.quaternion);
        snapshot.item.mesh.scale.copy(snapshot.scale);
        snapshot.item.mesh.updateMatrixWorld(true);
      }
      this.refreshSewingOverlay();
      this.requestRender();
    };

    // Costurar/Montar remains geometric-only. This operation never delegates
    // placement to the old global candidate solver and never wakes XPBD.
    this.simulation.pause();
    const geometryRevision = input.geometryRevision;
    const sewingRevision = input.sewingRevision;
    const arrangementRevision = input.arrangementRevision;
    const startedAt = performance.now();
    const materialBefore = measureCurrentSewingStep0MaterialDistortion(state, this.garmentMeshes, target) ?? 0;
    this.host.dataset.sewingStep0Status = "solving-local";
    this.host.dataset.sewingStep0Target = JSON.stringify(target.instanceIds);

    // Give React one paint so the busy label is visible even though the local
    // bounded solve is normally far faster than the old Worker solve.
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    const current = this.currentInput;
    if (!current
      || current.geometryRevision !== geometryRevision
      || current.sewingRevision !== sewingRevision
      || current.arrangementRevision !== arrangementRevision
      || this.viewportMode !== "assembly") {
      this.host.dataset.sewingStep0Status = "stale";
      return { status: "stale", affectedPanels: target.instanceIds.length };
    }

    try {
      const proposal = solvePlacementAnchoredSewingStep0(
        state,
        this.garmentMeshes,
        target,
        {
          iterations: 72,
          maximumVertexDisplacementM: 0.065,
          maximumCentroidDisplacementM: 0.018,
          seamRelaxation: 0.58,
          body,
          bodyClearanceM: 0.0005,
          bodyQueryDistanceM: 0.24,
        },
      );
      if (!proposal || proposal.seamConstraintCount === 0) {
        this.host.dataset.sewingStep0Status = "failed";
        return {
          status: "failed",
          affectedPanels: target.instanceIds.length,
          warning: "As costuras ativas não produziram correspondências físicas utilizáveis.",
        };
      }

      // A proposal that cannot even improve the current sewing residual is not
      // allowed to touch the viewport. This is an atomic safety gate.
      const proposalSeamAudit = auditSewingStep0Seams(proposal.beforeResidual, proposal.afterResidual);
      const proposalImproves = proposal.beforeResidual.meanM <= 0.0015
        || proposal.afterResidual.meanM <= proposal.beforeResidual.meanM * 0.985
        || proposal.afterResidual.meanM <= proposal.beforeResidual.meanM - 0.0005;
      if (!proposalImproves || !proposalSeamAudit.accepted || proposal.metricDistortionMax > 0.02) {
        this.host.dataset.sewingStep0Status = "rejected-local-solve";
        const rejectionReason = !proposalImproves
          ? "global-residual-not-improved"
          : !proposalSeamAudit.accepted
            ? "per-seam-acceptance-failed"
            : "canonical-material-metric-exceeded";
        this.host.dataset.sewingStep0Diagnostics = JSON.stringify({
          rejectionReason,
          proposalSeamAudit,
          proposal,
          materialBefore,
        }, (_key, value) => value instanceof Map ? Object.fromEntries(value) : value);
        return {
          status: "failed",
          affectedPanels: target.instanceIds.length,
          warning: `Não encontrei uma aproximação segura (${rejectionReason}). A roupa permaneceu inalterada.`,
        };
      }

      for (const [instanceId, local] of proposal.positionsByInstanceId) {
        const snapshot = snapshots.get(instanceId);
        if (!snapshot) continue;
        const attribute = snapshot.item.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
        if (attribute.count * 3 !== local.length) {
          restoreSnapshots();
          return { status: "failed", affectedPanels: target.instanceIds.length, warning: "Topologia mudou durante o STEP-0." };
        }
        (attribute.array as Float32Array).set(local);
        attribute.needsUpdate = true;
        snapshot.item.mesh.geometry.computeVertexNormals();
        snapshot.item.mesh.geometry.computeBoundingBox();
        snapshot.item.mesh.geometry.computeBoundingSphere();
      }

      let conformedPanels = 0;
      const bodyAudits: Record<string, unknown> = {};
      let unsafeReason: string | null = null;
      let maximumCentroidDisplacementM = 0;
      for (const instanceId of target.instanceIds) {
        const snapshot = snapshots.get(instanceId)!;
        const item = snapshot.item;

        const finalAnchor = sewingStep0MeshWorldVertex(item.mesh, snapshot.materialAnchorVertex);
        const anchorDisplacement = finalAnchor?.distanceTo(snapshot.materialAnchorWorld) ?? Number.POSITIVE_INFINITY;
        maximumCentroidDisplacementM = Math.max(maximumCentroidDisplacementM, anchorDisplacement);
        const finalSurface = finalAnchor
          ? closestBodySurfacePoint(body, [finalAnchor.x, finalAnchor.y, finalAnchor.z], 0, 0.24)
          : null;
        const finalAudit = auditMeshBodyClearance(item.mesh, body, 0.5, 112);
        const normalDot = finalSurface
          ? new THREE.Vector3(...snapshot.surface.outwardNormal)
            .normalize()
            .dot(new THREE.Vector3(...finalSurface.outwardNormal).normalize())
          : -1;
        const penetrationWorsened = finalAudit.penetratingSamples > snapshot.bodyAudit.penetratingSamples
          || finalAudit.minimumSignedClearanceMm < snapshot.bodyAudit.minimumSignedClearanceMm - 2;
        if (!finalSurface) unsafeReason ??= `${instanceId}: saiu da vizinhança corporal escolhida.`;
        else if (normalDot < 0.15) unsafeReason ??= `${instanceId}: tentou trocar de lado do corpo.`;
        else if (anchorDisplacement > 0.06) unsafeReason ??= `${instanceId}: tentou deslocar a âncora material mais de 60 mm.`;
        else if (penetrationWorsened) unsafeReason ??= `${instanceId}: piorou a penetração no corpo.`;
        bodyAudits[instanceId] = {
          solveTimeBarrier: true,
          before: snapshot.bodyAudit,
          after: finalAudit,
          materialAnchorDisplacementMm: anchorDisplacement * 1_000,
          surfaceNormalDot: normalDot,
        };
      }

      const finalResidual = measureCurrentSewingStep0Residual(state, this.garmentMeshes, target);
      const materialAfter = measureCurrentSewingStep0MaterialDistortion(state, this.garmentMeshes, target);
      if (!finalResidual || materialAfter === null) unsafeReason ??= "Não foi possível auditar a geometria final.";
      const residualImproves = finalResidual
        ? proposal.beforeResidual.meanM <= 0.0015
          || finalResidual.meanM <= proposal.beforeResidual.meanM * 0.99
          || finalResidual.meanM <= proposal.beforeResidual.meanM - 0.00035
        : false;
      const maximumResidualSafe = finalResidual
        ? finalResidual.maximumM <= Math.max(
          proposal.beforeResidual.maximumM + 0.003,
          proposal.beforeResidual.maximumM * 1.08,
        )
        : false;
      const materialSafe = materialAfter !== null
        && materialAfter <= Math.max(0.03, materialBefore + 0.015);
      const finalSeamAudit = finalResidual
        ? auditSewingStep0Seams(proposal.beforeResidual, finalResidual)
        : null;
      if (!residualImproves) unsafeReason ??= "O ajuste não aproximou as costuras de forma mensurável.";
      else if (!maximumResidualSafe) unsafeReason ??= "Uma das costuras piorou enquanto outra era aproximada.";
      else if (!finalSeamAudit?.accepted) unsafeReason ??= "Uma SeamGroup não convergiu com segurança junto das demais.";
      else if (!materialSafe) unsafeReason ??= "O ajuste exigiria deformar demais o material.";

      if (unsafeReason) {
        restoreSnapshots();
        this.host.dataset.sewingStep0Status = "rolled-back";
        this.host.dataset.sewingStep0Diagnostics = JSON.stringify({
          rollback: unsafeReason,
          proposal,
          finalResidual,
          proposalSeamAudit,
          finalSeamAudit,
          materialBefore,
          materialAfter,
          bodyAudits,
        }, (_key, value) => value instanceof Map ? Object.fromEntries(value) : value);
        return {
          status: "failed",
          affectedPanels: target.instanceIds.length,
          warning: `STEP-0 cancelado sem alterar a roupa: ${unsafeReason}`,
        };
      }

      for (const instanceId of target.instanceIds) {
        const item = snapshots.get(instanceId)?.item;
        if (item) syncMeshGeometryToAssemblyState(state, item);
      }
      const intrinsic = measureIntrinsicDistortion(state);
      this.refreshSewingOverlay();
      this.host.dataset.sewingStep0Status = "applied-local";
      this.host.dataset.sewingStep0Ms = (performance.now() - startedAt).toFixed(2);
      this.host.dataset.sewingStep0Diagnostics = JSON.stringify({
        affectedPanels: target.instanceIds.length,
        conformedPanels,
        maximumCentroidDisplacementMm: maximumCentroidDisplacementM * 1_000,
        maximumVertexDisplacementMm: proposal.maximumVertexDisplacementM * 1_000,
        proposalResidual: {
          before: proposal.beforeResidual,
          afterLocal: proposal.afterResidual,
          afterBody: finalResidual,
        },
        metricDistortionMax: intrinsic.maxRelativeDistortion,
        materialBefore,
        materialAfter,
        bodyAudits,
        iterations: proposal.iterations,
        constraintCount: proposal.seamConstraintCount,
        bodyBarrierCorrections: proposal.bodyBarrierCorrections,
        bodyHemisphereRejects: proposal.bodyHemisphereRejects,
        minimumBodyClearanceMm: proposal.minimumBodyClearanceM === null
          ? null
          : proposal.minimumBodyClearanceM * 1_000,
        phaseTimingsMs: proposal.phaseTimingsMs,
        proposalSeamAudit,
        finalSeamAudit,
      });
      this.host.dataset.simulationStatus = "disabled-in-montar";
      this.requestRender();
      const residualMm = (finalResidual?.maximumM ?? 0) * 1_000;
      return {
        status: "applied",
        affectedPanels: target.instanceIds.length,
        conformedPanels,
        maximumCentroidDisplacementMm: maximumCentroidDisplacementM * 1_000,
        metricDistortionMax: intrinsic.maxRelativeDistortion,
        seamResidualMaxMm: residualMm,
        ...(residualMm > 20 ? { warning: `Ainda há uma costura com ${residualMm.toFixed(1)} mm de abertura.` } : {}),
      };
    } catch (error) {
      restoreSnapshots();
      console.error("STEP-0 geométrico local:", error);
      this.host.dataset.sewingStep0Status = "failed";
      return {
        status: "failed",
        affectedPanels: target.instanceIds.length,
        warning: error instanceof Error ? error.message : "Falha no STEP-0 geométrico local.",
      };
    }
  }

  rotateArrangementSelection(axis: Exclude<ArrangementAxis, "free">, deltaDeg: number): void {
    if (this.viewportMode !== "assembly" || this.selectedInstanceIds.size === 0) return;
    const body = this.currentAvatarModel?.humanBody.visualMesh;
    const worldAxis = arrangementAxisVector(axis);
    const pivot = this.selectionCentroid();
    const attachmentById = new Map<string, ArrangementCommit["surfaceAttachment"]>();
    for (const item of this.garmentMeshes) {
      if (!this.selectedInstanceIds.has(item.key) || item.mesh.userData.arrangementPinned === true) continue;
      const barrier = body ? createBodyBarrierState(item.mesh, 24) : null;
      rotateMeshAroundPivot(item.mesh, pivot, worldAxis, THREE.MathUtils.degToRad(deltaDeg));
      if (body && barrier) {
        const result = constrainMeshOutsideBody(item.mesh, body, barrier, { clearanceMm: 8 });
        if (result.surfaceAttachment) attachmentById.set(item.key, result.surfaceAttachment);
      }
    }
    this.commitSelectedArrangement(attachmentById, true);
    this.updateArrangementGizmo();
    if (this.sewingState.showThreads) this.sewingOverlay.refreshThreads();
    this.requestRender();
  }

  flipArrangementSelection(): void {
    if (this.viewportMode !== "assembly" || this.selectedInstanceIds.size === 0) return;
    const body = this.currentAvatarModel?.humanBody.visualMesh;
    const attachmentById = new Map<string, ArrangementCommit["surfaceAttachment"]>();
    for (const item of this.garmentMeshes) {
      if (!this.selectedInstanceIds.has(item.key) || item.mesh.userData.arrangementPinned === true) continue;
      const pivot = meshWorldCentroid(item.mesh);
      const faceAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(item.mesh.quaternion).normalize();
      const barrier = body ? createBodyBarrierState(item.mesh, 24) : null;
      rotateMeshAroundPivot(item.mesh, pivot, faceAxis, Math.PI);
      item.mesh.userData.arrangementFaceFlipped = item.mesh.userData.arrangementFaceFlipped !== true;
      if (body && barrier) {
        const result = constrainMeshOutsideBody(item.mesh, body, barrier, { clearanceMm: 8 });
        if (result.surfaceAttachment) attachmentById.set(item.key, result.surfaceAttachment);
      }
    }
    this.commitSelectedArrangement(attachmentById, true);
    this.updateArrangementGizmo();
    if (this.sewingState.showThreads) this.sewingOverlay.refreshThreads();
    this.requestRender();
  }

  focusArrangementSelection(): void {
    const selected = this.garmentMeshes.filter((item) => this.selectedInstanceIds.has(item.key));
    if (selected.length === 0) return;
    const box = new THREE.Box3();
    for (const item of selected) box.expandByObject(item.mesh);
    this.frameBox(box, 0.35);
    this.requestRender();
  }

  adjustArrangementSelectionToBody(): { adjusted: number; tooFar: number; failed: number } {
    const body = this.currentAvatarModel?.humanBody.visualMesh;
    const outcome = { adjusted: 0, tooFar: 0, failed: 0 };
    if (this.viewportMode !== "assembly" || !body || this.selectedInstanceIds.size === 0) return outcome;
    const commits: ArrangementCommit[] = [];
    const diagnostics: Record<string, unknown> = {};
    for (const item of this.garmentMeshes) {
      if (!this.selectedInstanceIds.has(item.key) || item.mesh.userData.arrangementPinned === true) continue;
      const persistedAttachment = this.surfaceAttachmentForInstance(item.key);
      const persistedFrame = persistedAttachment ? resolveBodySurfaceAttachment(body, persistedAttachment) : null;
      const centroid = meshWorldCentroid(item.mesh);
      const persistedIsLocal = persistedFrame
        ? new THREE.Vector3(...persistedFrame.position).distanceTo(centroid) <= 0.24
        : false;
      const surface = persistedIsLocal
        ? persistedFrame
        : closestBodySurfacePoint(body, [centroid.x, centroid.y, centroid.z], 12, 0.24);
      if (!surface) {
        outcome.tooFar += 1;
        diagnostics[item.key] = { conformed: false, reason: "too-far" };
        continue;
      }
      const result = adjustMeshToBodySurface(item.mesh, body, surface.attachment, item.flat, {
        clearanceMm: Math.max(12, surface.attachment.normalOffsetMm),
        captureDistanceMm: 240,
        maximumVertexProjectionDistanceMm: 240,
      });
      diagnostics[item.key] = result;
      if (!result.conformed) {
        if (result.reason === "too-far") outcome.tooFar += 1;
        else outcome.failed += 1;
        continue;
      }
      outcome.adjusted += 1;
      commits.push(captureMeshArrangement(item.key, item.mesh, result.surfaceAttachment));
    }
    this.host.dataset.arrangementConformOperations = String(
      Number(this.host.dataset.arrangementConformOperations ?? "0") + 1,
    );
    this.host.dataset.arrangementConformDiagnostics = JSON.stringify(diagnostics);
    this.host.dataset.arrangementConformOutcome = JSON.stringify(outcome);
    if (commits.length > 0) {
      this.arrangementCommitHandler?.(commits);
      this.updateArrangementGizmo();
      if (this.sewingState.showThreads) this.sewingOverlay.refreshThreads();
      this.requestRender();
    }
    return outcome;
  }

  toggleArrangementPin(): boolean {
    if (this.selectedInstanceIds.size === 0) return false;
    const items = this.garmentMeshes.filter((item) => this.selectedInstanceIds.has(item.key));
    const next = !items.every((item) => item.mesh.userData.arrangementPinned === true);
    for (const item of items) item.mesh.userData.arrangementPinned = next;
    this.host.dataset.arrangementPinnedIds = this.garmentMeshes
      .filter((item) => item.mesh.userData.arrangementPinned === true)
      .map((item) => item.key)
      .join(",");
    return next;
  }

  updateGarment(input: ResolvedAssemblyInput, mode: ThreeViewportMode = "fitting"): string[] {
    const enteringAssembly = mode === "assembly" && this.viewportMode !== "assembly";
    const enteringFittingFromAssembly = mode === "fitting" && this.viewportMode === "assembly";
    const capturedWorkspace = enteringFittingFromAssembly && this.assemblyState
      ? captureWorkspaceAssemblySeed(
          this.assemblyState,
          this.garmentMeshes,
          this.currentInput ?? input,
          this.host.dataset.assemblyStrategy ?? "workspace-worker-solve",
        )
      : null;
    if (enteringAssembly) this.workspaceSimulationCapture = null;
    if (capturedWorkspace) this.workspaceSimulationCapture = capturedWorkspace;
    const workspaceCapture = mode === "fitting" ? this.workspaceSimulationCapture : null;
    this.viewportMode = mode;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    if (mode === "assembly") {
      this.setArrangementPointerFeedback("idle");
    } else {
      this.hoveredArrangementHandle = null;
      this.hoveredArrangementInstanceId = null;
      this.renderer.domElement.style.cursor = "default";
      delete this.host.dataset.arrangementPointerMode;
      delete this.host.dataset.arrangementHoveredHandle;
      delete this.host.dataset.arrangementHoveredInstanceId;
    }
    this.currentInput = input;
    this.host.dataset.viewportMode = mode;
    this.host.dataset.arrangementTool = this.arrangementTool;
    this.avatarGroup.visible = mode !== "assembly";
    if (mode === "fitting" && !import.meta.env.DEV) this.clearDevBodyVisuals();
    const garment = input.garmentProjection;
    const avatarModel = buildAvatarParametricModel(
      input.document.measurements.values,
      input.document.body.type,
      {
        profile: input.document.measurements.profile,
        origins: measurementOriginsFromDocument(input.document.measurements),
      },
    );
    this.currentAvatarModel = avatarModel;
    if (mode === "assembly") {
      const surfaceWarmupStartedAt = performance.now();
      prepareBodySurfaceQuery(avatarModel.humanBody.visualMesh);
      this.host.dataset.arrangementSurfaceWarmupMs = (performance.now() - surfaceWarmupStartedAt).toFixed(2);
    }
    const avatarConfiguration = mode === "assembly"
      ? { changed: this.avatarGroup.visible }
      : this.configureApprovedAvatar(input.document.body.type);
    const settings = input.document.simulationSettings;
    this.baseGravity = settings.gravityMmS2.map((value) => value * 0.001) as [number, number, number];
    const resumeAfterRebuild = this.simulationRunning;

    const revision = mode === "assembly" ? input.geometryRevision : input.simulationRevision;
    const assemblyDocument = mode === "assembly" ? input.assemblyDocument : input.simulationDocument;
    this.pendingAssemblyRevision = revision;
    this.assemblyRevision = revision;
    this.assemblyState = null;
    this.simulation.pause();
    this.host.dataset.assemblyStatus = "solving";
    this.host.dataset.assemblyRevision = revision;
    this.host.dataset.simulationStatus = "assembling";

    if (import.meta.env.DEV) {
      this.host.dataset.currentPatternDocumentV3 = serializePatternDocumentV3(input.document);
      this.installDevDocumentExport(input.document);
    }

    void this.assembly.solve({
      document: assemblyDocument,
      revision,
      mode: mode === "assembly" ? "workspace" : "simulation",
    }).then((response) => {
      if (this.disposed || this.pendingAssemblyRevision !== response.revision || response.revision !== revision) return;
      const state = response.state;
      const simulationSolveDiagnostic = mode === "fitting"
        ? captureAssemblyTransitionDiagnostic(
            state,
            input,
            "simulation-worker-solve",
            response.revision,
            response.diagnostics.assembly.strategy,
          )
        : null;
      const workspaceTransfer = mode === "fitting" && workspaceCapture
        ? applyWorkspaceAssemblySeed(state, workspaceCapture.seed, input)
        : null;
      if (mode === "fitting" && !workspaceTransfer?.applied) {
        applyAuthoredArrangementToAssemblyState(state, input, avatarModel);
      }
      const registration = mode === "fitting"
        ? resolveGarmentBodyRegistration(state, avatarModel)
        : null;
      if (registration && !workspaceTransfer?.applied) applyGarmentBodyRegistration(state, registration);
      const visibleInstanceIds = new Set(state.instances.map((instance) => instance.id));
      const nextMeshes = buildGarmentAssemblyMeshes(state, garment, {
        castShadow: this.profile.shadows,
        receiveShadow: this.profile.shadows,
        visibleInstanceIds,
      });
      this.reconcileGarmentMeshes(nextMeshes);
      this.applyWireframe();
      this.assemblyState = state;
      this.assemblyRevision = response.revision;
      this.pendingAssemblyRevision = null;
      this.host.dataset.simulationGeometryRevision = response.revision;
      this.host.dataset.assemblyStatus = response.diagnostics.assembly.invalid ? "invalid" : "ready";
      this.host.dataset.coarseAssemblyDiagnostics = JSON.stringify(response.diagnostics);
      this.host.dataset.assemblyStrategy = response.diagnostics.assembly.strategy;
      this.host.dataset.assemblyWarnings = JSON.stringify(response.warnings);

      if (mode === "assembly") {
        this.simulation.pause();
        this.configureDevBodyVisuals(avatarModel, undefined, IDENTITY_BODY_TRANSFORM);
        this.proceduralAvatarGroup.visible = true;
        this.applyWorkspaceArrangement(input, avatarModel);
        // The worker may have started before a seam-only edit. Compile the
        // latest relationships after authored transforms, without rebuilding
        // topology or meshes.
        this.updateSewingRelationships(this.currentInput ?? input);
        this.bodyRegistrationStatus = "body-placement-required";
        this.host.dataset.simulationStatus = "disabled-in-montar";
        this.host.dataset.arrangementAssemblySolves = String(
          Number(this.host.dataset.arrangementAssemblySolves ?? "0") + 1,
        );
        this.host.dataset.garmentInstanceCount = String(this.garmentMeshes.length);
        this.host.dataset.garmentInstanceIds = this.garmentMeshes.map((item) => item.key).join(",");
        if (!this.hasFramedScene
          || enteringAssembly
          || this.lastFramedAssemblyRevision !== input.arrangementRevision) {
          this.frameDressedScene();
          this.hasFramedScene = true;
          this.lastFramedAssemblyRevision = input.arrangementRevision;
        }
        this.requestRender();
        return;
      }

      if (!registration) return;
      this.bodyRegistrationStatus = workspaceTransfer?.applied ? "registered" : registration.status;
      this.host.dataset.bodyRegistrationAuthority = workspaceTransfer?.applied
        ? "workspace-canonical-world"
        : "legacy-semantic-registration";
      this.currentBodyTransform = IDENTITY_BODY_TRANSFORM;
      const exactBodyMesh = this.bodyRegistrationStatus === "registered"
        ? packHumanBodyMesh(avatarModel.humanBody.visualMesh)
        : undefined;
      this.host.dataset.bodyRegistration = JSON.stringify(registration);
      this.host.dataset.garmentRegistration = JSON.stringify(registration);
      if (workspaceCapture && simulationSolveDiagnostic) {
        const transferredDiagnostic = captureAssemblyTransitionDiagnostic(
          state,
          input,
          "workspace-seed-transfer",
          response.revision,
          workspaceTransfer?.applied ? "workspace-seed-transfer" : response.diagnostics.assembly.strategy,
        );
        this.host.dataset.assemblyModeTransition = JSON.stringify({
          workspace: workspaceCapture.diagnostic,
          simulationSolve: simulationSolveDiagnostic,
          transfer: workspaceTransfer,
          simulationInitial: transferredDiagnostic,
          simulationWorkerRebuiltGeometry:
            simulationSolveDiagnostic.positionSignature !== workspaceCapture.diagnostic.positionSignature,
          workspaceGeometryPreserved:
            workspaceTransfer?.applied === true
            && transferredDiagnostic.positionSignature === workspaceCapture.diagnostic.positionSignature,
          legacyRegistrationApplied: !workspaceTransfer?.applied,
          legacyRegistrationProposal: registration,
        });
      } else {
        delete this.host.dataset.assemblyModeTransition;
      }
      this.host.dataset.avatarMeasurementOrigins = JSON.stringify(avatarModel.measurementOrigins ?? {});
      this.host.dataset.avatarResolvedMeasurements = JSON.stringify(avatarModel.measurements);
      this.host.dataset.physicalFloorY = String(this.floor.position.y);
      this.host.dataset.visualFloorY = String(this.floor.position.y);
      this.host.dataset.bodyColliderCount = String(exactBodyMesh?.indices.length ? exactBodyMesh.indices.length / 3 : 0);
      this.host.dataset.bodyCollisionPrimitive = exactBodyMesh ? "exact-human-surface" : "none";
      this.host.dataset.bodyVisualCollisionTopologyParity = String(
        exactBodyMesh?.topologySignature === avatarModel.humanBody.visualMesh.topologySignature,
      );
      if (import.meta.env.DEV) this.configureDevBodyVisuals(avatarModel, exactBodyMesh, IDENTITY_BODY_TRANSFORM);
      if (import.meta.env.DEV) this.configureRegistrationAxes(state, registration);
      const initialization = buildXpbdInitialization(state, garment, response.revision, {
        exactBodyMesh,
        bodyCollisionEnabled: this.bodyRegistrationStatus === "registered" && this.devSettings.bodyCollisionEnabled,
        config: {
          gravity: this.scaledGravity(),
          maximumSubsteps: settings.substeps,
          iterations: settings.iterations,
          floorCollisionEnabled: this.devSettings.floorCollisionEnabled,
          floorY: this.floor.position.y,
        },
      });
      this.host.dataset.simulationTopologyDiagnostics = JSON.stringify(initialization.topologyDiagnostics);
      if (import.meta.env.DEV) {
        this.host.dataset.initialSeamResidualAudit = JSON.stringify({
          assembly: {
            strategy: response.diagnostics.assembly.strategy,
            components: response.diagnostics.assembly.components,
            metrics: response.diagnostics.assembly.metrics,
          },
          adapter: initialization.seamResidualAudit,
        });
      }
      this.host.dataset.spatialAssemblyDiagnostics = JSON.stringify({
        revision: response.revision,
        strategy: response.diagnostics.assembly.strategy,
        intrinsicDistortion: measureIntrinsicDistortion(state),
        initialPositionSignature: assemblyPositionSignature(state.positions),
        coarseVertexCount: response.diagnostics.coarseVertexCount,
        coarseTriangleCount: response.diagnostics.coarseTriangleCount,
        hingeCount: response.diagnostics.hingeCount,
        reductionRatio: response.diagnostics.reductionRatio,
        fineBindingBuildMs: response.diagnostics.fineBindingBuildMs,
        fineTransferMs: response.diagnostics.fineTransferMs,
        assemblySolveMs: response.diagnostics.assembly.assemblySolveMs,
        assemblyConfidence: response.diagnostics.assembly.components.map((component) => ({
          componentId: component.componentId,
          state: component.constraintState,
          confidence: component.assemblyConfidence,
          reason: component.ambiguityReason ?? null,
          selectedSeed: component.selectedSeed,
          metrics: {
            metricDistortionMean: component.metricDistortionMean,
            metricDistortionMax: component.metricDistortionMax,
            areaDistortionMean: component.areaDistortionMean,
            areaDistortionMax: component.areaDistortionMax,
            structuralSeamMeanMm: component.structuralSeamMeanMm,
            structuralSeamMaxMm: component.structuralSeamMaxMm,
            overlapScore: component.overlapScore,
            nonPlanarityRad: component.nonPlanarityRad,
          },
          candidates: component.candidateDiagnostics,
        })),
        instances: state.instances.map((instance) => ({
          id: instance.id,
          pieceId: instance.pieceId,
          vertexCount: instance.vertexCount,
          placement: instance.placement,
          arrangement: instance.arrangement,
        })),
        seamGraph: summarizeAssemblySeamGraph(state),
      });

      const identity = this.simulation.updateGeometry(initialization);
      this.assemblyGeneration = identity.generation;
      this.simulationEpoch = identity.epoch;
      this.applyWorkerDevSettings();
      this.host.dataset.simulationGeneration = String(this.assemblyGeneration);
      this.host.dataset.simulationEpoch = String(this.simulationEpoch);
      if (resumeAfterRebuild) {
        this.simulationEpoch = this.simulation.resume();
        this.host.dataset.simulationEpoch = String(this.simulationEpoch);
      }
      this.host.dataset.simulationStatus = resumeAfterRebuild ? "running" : "ready";
      this.host.dataset.garmentInstanceCount = String(this.garmentMeshes.length);
      this.host.dataset.garmentInstanceIds = this.garmentMeshes.map((item) => item.key).join(",");
      this.host.dataset.garmentGeometrySignatures = this.garmentMeshes
        .map((item) => `${item.key}:${item.geometrySignature}`)
        .join(",");
      if (import.meta.env.DEV) {
        this.host.dataset.garmentMeshDiagnostics = JSON.stringify(captureGarmentMeshDiagnostics(this.garmentMeshes));
      }
      this.host.dataset.frameTarget = "garment-assembly";
      if (!this.hasFramedScene || avatarConfiguration.changed) {
        this.frameDressedScene();
        this.hasFramedScene = true;
      }
      this.requestRender();
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (this.disposed || this.pendingAssemblyRevision !== revision) return;
      this.pendingAssemblyRevision = null;
      this.host.dataset.assemblyStatus = "error";
      this.host.dataset.simulationStatus = "assembly-error";
      this.host.dataset.assemblyError = error instanceof Error ? error.message : String(error);
      console.error("Assembly Worker:", error);
    });

    return import.meta.env.DEV ? [] : avatarConfiguration.warning ? [avatarConfiguration.warning] : [];
  }

  dress(): void {
    this.resumeSimulation();
  }

  pauseSimulation(): void {
    this.traceLifecycle("ui-command", { command: "pause", uiState: this.host.dataset.simulationUiState ?? "unknown" });
    this.simulationEpoch = this.simulation.pause();
    this.host.dataset.simulationEpoch = String(this.simulationEpoch);
  }

  resumeSimulation(): void {
    this.traceLifecycle("ui-command", { command: "resume", uiState: this.host.dataset.simulationUiState ?? "unknown" });
    this.host.dataset.simulationResumeRequested = this.assemblyRevision ?? "without-geometry";
    this.simulationEpoch = this.simulation.resume();
    this.host.dataset.simulationEpoch = String(this.simulationEpoch);
    this.requestRender();
  }

  stepSimulation(): void {
    this.traceLifecycle("ui-command", { command: "step", uiState: this.host.dataset.simulationUiState ?? "unknown" });
    this.simulationEpoch = this.simulation.step();
    this.host.dataset.simulationEpoch = String(this.simulationEpoch);
    this.requestRender();
  }

  resetSimulation(): void {
    this.traceLifecycle("ui-command", { command: "reset", uiState: this.host.dataset.simulationUiState ?? "unknown" });
    this.approximateFps = 0;
    this.lastAppliedFrameAt = 0;
    this.simulationEpoch = this.simulation.reset();
    this.host.dataset.simulationEpoch = String(this.simulationEpoch);
    this.requestRender();
  }

  setSimulationDevSettings(settings: SimulationDevSettings): void {
    this.devSettings = settings;
    this.host.dataset.simulationDevSettings = JSON.stringify(settings);
    this.applyWorkerDevSettings();
    if (import.meta.env.DEV) this.applyDevBodyVisibility();
  }

  setWireframe(enabled: boolean): void {
    this.wireframeEnabled = enabled;
    this.applyWireframe();
    this.requestRender();
  }

  frameGarment(): void {
    this.frameDressedScene();
    this.requestRender();
  }

  refresh(): void {
    if (this.disposed) return;
    this.resize();
    this.frameDressedScene();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hideArrangementCandidate();
    this.resizeObserver.disconnect();
    this.performanceObserver?.disconnect();
    this.performanceObserver = null;
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    if (this.frameId !== null) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.controls.removeEventListener("change", this.requestRender);
    this.renderer.domElement.removeEventListener("pointerdown", this.handleArrangementPointerDown, { capture: true });
    this.renderer.domElement.removeEventListener("pointermove", this.handleArrangementPointerMove, { capture: true });
    this.renderer.domElement.removeEventListener("pointerup", this.handleArrangementPointerUp, { capture: true });
    this.renderer.domElement.removeEventListener("pointercancel", this.handleArrangementPointerUp, { capture: true });
    this.renderer.domElement.removeEventListener("pointerleave", this.handleArrangementPointerLeave, { capture: true });
    this.renderer.domElement.removeEventListener("contextmenu", this.handleViewportContextMenu);
    this.controls.dispose();
    this.avatarLoadController?.abort();
    this.avatarLoadController = null;
    this.assembly.dispose();
    this.simulation.dispose();
    this.pendingAssemblyRevision = null;
    this.assemblyState = null;
    this.assemblyRevision = null;
    this.assemblyGeneration = 0;
    this.simulationEpoch = 0;
    if (import.meta.env.DEV) {
      delete (window as Window & { __MOLDEON_ASSEMBLY_DEV__?: unknown }).__MOLDEON_ASSEMBLY_DEV__;
      delete (window as Window & { __MOLDEON_VIEWPORT_DEV__?: unknown }).__MOLDEON_VIEWPORT_DEV__;
    }
    this.clearGarment();
    this.sewingOverlay.dispose();
    this.clearAvatar();
    this.clearDevBodyVisuals();
    disposeObject(this.registrationAxesGroup);
    this.registrationAxesGroup.clear();
    disposeObject(this.scene);
    this.scene.clear();
    if (this.renderer instanceof THREE.WebGLRenderer) {
      this.renderer.renderLists.dispose();
      this.renderer.forceContextLoss();
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
    delete this.host.dataset.avatarVisible;
    delete this.host.dataset.avatarStatus;
    delete this.host.dataset.avatarAssetId;
    delete this.host.dataset.avatarInspection;
    delete this.host.dataset.garmentInstanceCount;
    delete this.host.dataset.garmentMeshDiagnostics;
    delete this.host.dataset.simulationStatus;
    delete this.host.dataset.simulationDiagnostics;
    delete this.host.dataset.simulationDevSettings;
    delete this.host.dataset.initialSeamResidualAudit;
    delete this.host.dataset.bodyRegistration;
    delete this.host.dataset.avatarMeasurementOrigins;
    delete this.host.dataset.avatarResolvedMeasurements;
    delete this.host.dataset.avatarFloorPosition;
    delete this.host.dataset.bodyColliderCount;
  }

  private frameDressedScene(): void {
    this.avatarGroup.updateMatrixWorld(true);
    this.proceduralAvatarGroup.updateMatrixWorld(true);
    this.garmentGroup.updateMatrixWorld(true);
    const box = new THREE.Box3();
    if (this.avatarGroup.visible && this.avatarGroup.children.length > 0) box.expandByObject(this.avatarGroup);
    if (this.proceduralAvatarGroup.visible && this.proceduralAvatarGroup.children.length > 0) {
      box.expandByObject(this.proceduralAvatarGroup);
    }
    if (this.garmentGroup.visible && this.garmentGroup.children.length > 0) box.expandByObject(this.garmentGroup);
    this.frameBox(box, this.camera.aspect < 0.8 ? 0.42 : 0.28);
  }

  private frameBox(box: THREE.Box3, paddingRatio: number): void {
    if (box.isEmpty()) return;
    const hasVisualAvatar = this.avatarGroup.children.length > 0
      || (this.proceduralAvatarGroup.visible && this.proceduralAvatarGroup.children.length > 0);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const verticalRadius = Math.max(size.y * (0.5 + paddingRatio), hasVisualAvatar ? 0.75 : 0.12);
    const horizontalRadius = Math.max(size.x, size.z) * (0.52 + paddingRatio);
    const radius = Math.max(verticalRadius, horizontalRadius, hasVisualAvatar ? 0.55 : 0.16);
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const aspectAllowance = this.camera.aspect < 0.8 ? 1.2 : 1;
    const distance = Math.max(hasVisualAvatar ? 1.25 : 0.5, radius / Math.tan(halfFov) * aspectAllowance);
    const direction = new THREE.Vector3(1.15, 0.3, 1.7).normalize();
    this.controls.target.copy(center).add(new THREE.Vector3(0, size.y * 0.02, 0));
    this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
    this.camera.near = Math.max(0.01, distance / 120);
    this.camera.far = Math.max(20, distance * 20);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private clearGarment(): void {
    for (const item of this.garmentMeshes) {
      this.garmentGroup.remove(item.mesh);
      disposeMesh(item.mesh);
    }
    this.garmentMeshes = [];
  }

  private reconcileGarmentMeshes(nextMeshes: GarmentAssemblyMeshData[]): void {
    const previousByKey = new Map(this.garmentMeshes.map((item) => [item.key, item]));
    const reconciled: GarmentAssemblyMeshData[] = [];

    for (const next of nextMeshes) {
      const previous = previousByKey.get(next.key);
      previousByKey.delete(next.key);
      const canReuse = previous !== undefined && canReuseGarmentAssemblyMesh(previous, next);

      if (!canReuse || !previous) {
        if (previous) {
          this.garmentGroup.remove(previous.mesh);
          disposeMesh(previous.mesh);
        }
        this.garmentGroup.add(next.mesh);
        reconciled.push(next);
        continue;
      }

      adoptGarmentAssemblyMesh(previous.mesh, next.mesh);
      disposeMaterial(previous.mesh.material);
      previous.mesh.material = next.mesh.material;
      next.mesh.geometry.dispose();
      reconciled.push({
        ...next,
        mesh: previous.mesh,
      });
    }

    for (const stale of previousByKey.values()) {
      this.garmentGroup.remove(stale.mesh);
      disposeMesh(stale.mesh);
    }
    this.garmentMeshes = reconciled;
  }

  private installDevDocumentExport(document: ResolvedAssemblyInput["document"]): void {
    if (!import.meta.env.DEV) return;
    const target = window as Window & {
      __MOLDEON_ASSEMBLY_DEV__?: {
        exportCurrentV3TestFixture: () => string;
      };
    };
    target.__MOLDEON_ASSEMBLY_DEV__ = {
      exportCurrentV3TestFixture: () => serializePatternDocumentV3(document),
    };
  }

  private clearAvatar(): void {
    disposeObject(this.avatarGroup);
    this.avatarGroup.clear();
  }

  private clearDevBodyVisuals(): void {
    disposeObject(this.proceduralAvatarGroup);
    disposeObject(this.bodyColliderDebugGroup);
    this.proceduralAvatarGroup.clear();
    this.bodyColliderDebugGroup.clear();
  }

  private configureDevBodyVisuals(
    avatarModel: AvatarParametricModel,
    exactBodyMesh: PackedBodyMesh | undefined,
    transform: SimulationBodyTransform,
  ): void {
    this.clearDevBodyVisuals();
    const visual = createAvatarVisual(avatarModel, { radialSegments: 18, castShadow: false, receiveShadow: false });
    visual.position.set(...transform.translation);
    visual.quaternion.set(...transform.rotation);
    const floorPosition = resolveAvatarFloorPosition(avatarModel, transform);
    this.floor.position.set(...floorPosition);
    this.host.dataset.avatarFloorPosition = JSON.stringify(floorPosition);
    this.proceduralAvatarGroup.add(visual);
    if (exactBodyMesh) this.bodyColliderDebugGroup.add(createAvatarCollisionDebugVisual(exactBodyMesh));
    this.proceduralAvatarGroup.visible = this.devSettings.showProceduralAvatar;
    this.bodyColliderDebugGroup.visible = this.devSettings.showBodyColliders;
    this.host.dataset.proceduralAvatarVisible = String(this.proceduralAvatarGroup.visible);
    this.host.dataset.bodyCollidersVisible = String(this.bodyColliderDebugGroup.visible);
  }

  private applyDevBodyVisibility(): void {
    this.proceduralAvatarGroup.visible = this.devSettings.showProceduralAvatar;
    this.bodyColliderDebugGroup.visible = this.devSettings.showBodyColliders;
    this.registrationAxesGroup.visible = this.devSettings.showRegistrationAxes;
    this.host.dataset.proceduralAvatarVisible = String(this.proceduralAvatarGroup.visible);
    this.host.dataset.bodyCollidersVisible = String(this.bodyColliderDebugGroup.visible);
    this.requestRender();
  }

  private applyWorkspaceArrangement(
    input: ResolvedAssemblyInput,
    avatar: AvatarParametricModel,
  ): void {
    const placements = new Map(
      input.garmentProjection.pieces.flatMap((piece) =>
        (piece.previewPlacements ?? []).map((placement) => [placement.id, placement] as const),
      ),
    );
    const states: Record<string, "POSICIONAR" | "AJUSTADO"> = {};
    const body = avatar.humanBody.visualMesh;
    const stagingPanels: Array<{ instanceId: string; sizeM: [number, number, number] }> = [];
    for (const item of this.garmentMeshes) {
      const placement = placements.get(item.key);
      if (!placement) continue;
      restoreMeshMaterialGeometry(item.mesh, item.flat);
      if (placement.presentationMode === "staging") {
        item.mesh.geometry.computeBoundingBox();
        const size = item.mesh.geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3();
        stagingPanels.push({ instanceId: item.key, sizeM: [size.x, size.y, size.z] });
      }
    }
    const stagingTransforms = resolveDeterministicStagingLayout(stagingPanels, body);
    for (const item of this.garmentMeshes) {
      const placement = placements.get(item.key);
      if (!placement) continue;
      const transform = placement.presentationMode === "staging"
        ? stagingTransforms.get(item.key)
        : resolveArrangementTransform(placement, avatar);
      if (!transform) continue;
      placeMeshCentroid(item.mesh, transform);
      if (placement.presentationMode === "authored" && placement.surfaceAttachment) {
        const result = adjustMeshToBodySurface(item.mesh, body, placement.surfaceAttachment, item.flat, {
          clearanceMm: Math.max(12, placement.surfaceAttachment.normalOffsetMm),
        });
        item.mesh.userData.arrangementConform = result;
      }
      const materials = Array.isArray(item.mesh.material) ? item.mesh.material : [item.mesh.material];
      for (const material of materials) {
        material.side = THREE.DoubleSide;
        material.needsUpdate = true;
      }
      item.mesh.userData.panelInstanceId = item.key;
      item.mesh.userData.arrangementState = placement.presentationMode === "staging"
        ? "POSICIONAR"
        : "AJUSTADO";
      states[item.key] = item.mesh.userData.arrangementState;
    }
    this.host.dataset.arrangementStates = JSON.stringify(states);
    this.host.dataset.arrangementRevision = input.arrangementRevision;
    this.host.dataset.arrangementXpbdInitializations = "0";
    this.applyArrangementSelectionVisuals();
  }

  private readonly handleArrangementPointerDown = (event: PointerEvent): void => {
    if (this.viewportMode !== "assembly" || this.disposed || !event.isPrimary) return;
    if (this.sewingState.active && event.button === 0) {
      const edge = this.raycastSewingEdge(event);
      if (edge) {
        this.sewingEdgeSelectHandler?.(edge.range, edge.panelInstanceId, edge.t);
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (!this.sewingState.active && this.sewingState.showThreads && event.button === 0) {
      const thread = this.raycastSewingThread(event);
      if (thread) {
        this.sewingSeamSelectHandler?.(thread.seamId);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
    if (event.button === 2) {
      this.hoveredArrangementHandle = null;
      this.hoveredArrangementInstanceId = null;
      this.setArrangementPointerFeedback("pan");
      return;
    }
    if (event.button === 1) {
      this.hoveredArrangementHandle = null;
      this.hoveredArrangementInstanceId = null;
      this.setArrangementPointerFeedback("zoom");
      return;
    }
    if (event.button !== 0) return;
    const gizmoHit = this.raycastArrangementGizmo(event);
    const garmentHit = gizmoHit ? null : this.raycastGarment(event);
    if (!gizmoHit && !garmentHit) {
      this.hoveredArrangementHandle = null;
      this.hoveredArrangementInstanceId = null;
      this.setArrangementPointerFeedback("orbit");
      return;
    }

    let active = this.garmentMeshes.find((candidate) =>
      this.selectedInstanceIds.has(candidate.key) && candidate.mesh.userData.arrangementPinned !== true,
    );
    if (garmentHit) {
      const item = this.garmentMeshes.find((candidate) => candidate.mesh === garmentHit.object);
      if (!item) return;
      const extendSelection = shouldExtendArrangementSelection({
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        pointerType: event.pointerType,
        touchMultiSelect: this.arrangementTouchMultiSelect,
      });
      // A confirmed seam makes its active physical connected component a
      // rigid arrangement selection. We reuse the already-stable multi-select
      // drag path instead of inventing a sewing movement solver: one authored
      // translation/rotation is applied to every connected PanelInstanceV3.
      const sewnComponentIds = new Set(connectedSewingInstanceIds(
        this.assemblyState?.stitchConstraints ?? [],
        item.key,
      ));
      if (extendSelection) {
        const removeComponent = [...sewnComponentIds].every((instanceId) =>
          this.selectedInstanceIds.has(instanceId),
        );
        for (const instanceId of sewnComponentIds) {
          if (removeComponent) this.selectedInstanceIds.delete(instanceId);
          else this.selectedInstanceIds.add(instanceId);
        }
      } else {
        const selectionAlreadyMatchesComponent = this.selectedInstanceIds.size === sewnComponentIds.size
          && [...sewnComponentIds].every((instanceId) => this.selectedInstanceIds.has(instanceId));
        if (!selectionAlreadyMatchesComponent) {
          this.selectedInstanceIds.clear();
          for (const instanceId of sewnComponentIds) this.selectedInstanceIds.add(instanceId);
        }
      }
      active = this.selectedInstanceIds.has(item.key) && item.mesh.userData.arrangementPinned !== true
        ? item
        : this.garmentMeshes.find((candidate) =>
            this.selectedInstanceIds.has(candidate.key) && candidate.mesh.userData.arrangementPinned !== true,
          );
      this.applyArrangementSelectionVisuals();
      this.arrangementSelectionHandler?.([...this.selectedInstanceIds]);
      if (extendSelection || this.arrangementTool === "rotate") {
        this.updateArrangementHover(event);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
    if (!active || active.mesh.userData.arrangementPinned === true || !this.selectedInstanceIds.has(active.key)) return;

    const effectiveAxis: ArrangementAxis = gizmoHit?.axis ?? "free";
    if (gizmoHit) {
      this.setArrangementAxis(effectiveAxis);
      this.arrangementAxisHandler?.(effectiveAxis);
    }
    const hitPoint = gizmoHit?.point ?? garmentHit!.point;
    const initialRay = this.pointerRay(event);
    const cameraDirection = this.camera.getWorldDirection(new THREE.Vector3());
    const worldAxis = effectiveAxis === "free" ? new THREE.Vector3(0, 0, 1) : arrangementAxisVector(effectiveAxis);
    const initialTransforms = new Map<string, ArrangementDragTransform>();
    const barriers = new Map<string, BodyBarrierState>();
    const body = this.currentAvatarModel?.humanBody.visualMesh;
    for (const candidate of this.garmentMeshes) {
      if (!this.selectedInstanceIds.has(candidate.key) || candidate.mesh.userData.arrangementPinned === true) continue;
      initialTransforms.set(candidate.key, {
        position: candidate.mesh.position.clone(),
        quaternion: candidate.mesh.quaternion.clone(),
      });
      if (body) barriers.set(candidate.key, createBodyBarrierState(candidate.mesh, 20));
    }
    if (initialTransforms.size === 0) return;
    const rotationPivot = this.selectionCentroid(new Set(initialTransforms.keys()));
    const dragPlane = effectiveAxis !== "free"
      ? createAxisDragPlane(rotationPivot, worldAxis, cameraDirection)
      : createCameraDragPlane(hitPoint, cameraDirection);
    const translationStartPoint = intersectPointerRayWithDragPlane(initialRay, dragPlane) ?? hitPoint.clone();
    const axisAlignment = Math.abs(initialRay.direction.dot(worldAxis));
    let axisSolveMode: ArrangementDragState["axisSolveMode"];
    let axisStartParameter: number | undefined;
    if (this.arrangementTool === "move" && effectiveAxis !== "free") {
      axisSolveMode = axisAlignment < 0.965 ? "closest" : "screen";
      axisStartParameter = axisSolveMode === "closest"
        ? closestRayAxisParameter(initialRay, rotationPivot, worldAxis) ?? undefined
        : 0;
      if (axisStartParameter === undefined) {
        axisSolveMode = "plane";
        axisStartParameter = axisParameterOnDragPlane(initialRay, dragPlane, rotationPivot, worldAxis) ?? undefined;
      }
      if (axisStartParameter === undefined) {
        axisSolveMode = "screen";
        axisStartParameter = 0;
      }
    }
    const axisDepth = Math.max(0.08, rotationPivot.clone().sub(this.camera.position).dot(cameraDirection));
    const axisWorldUnitsPerPixel = perspectiveWorldUnitsPerPixel(
      axisDepth,
      this.camera.fov,
      this.renderer.domElement.clientHeight,
    );
    const rotationPlane = this.arrangementTool === "rotate"
      ? new THREE.Plane().setFromNormalAndCoplanarPoint(worldAxis, rotationPivot)
      : undefined;
    const rotationStartPoint = rotationPlane
      ? initialRay.intersectPlane(rotationPlane, new THREE.Vector3())
      : null;
    const rotationStartVector = rotationStartPoint ? rotationStartPoint.clone().sub(rotationPivot) : undefined;
    if (rotationStartVector) {
      rotationStartVector.addScaledVector(worldAxis, -rotationStartVector.dot(worldAxis));
      if (rotationStartVector.lengthSq() > 1e-10) rotationStartVector.normalize();
    }
    const rotationSolveMode = this.arrangementTool === "rotate"
      && Math.abs(initialRay.direction.dot(worldAxis)) >= 0.12
      && rotationStartVector
      && rotationStartVector.lengthSq() > 1e-8
        ? "plane"
        : this.arrangementTool === "rotate" ? "screen" : undefined;
    const screenRotation = this.arrangementTool === "rotate"
      ? this.createScreenRotationSolver(rotationPivot, hitPoint, worldAxis, event)
      : null;
    if (this.arrangementTool === "rotate" && rotationSolveMode === "screen" && !screenRotation) return;
    this.dragState = {
      pointerId: event.pointerId,
      activeInstanceId: active.key,
      tool: this.arrangementTool,
      dragPlane,
      translationStartPoint,
      axisOrigin: rotationPivot.clone(),
      axisStartParameter,
      axisSolveMode,
      axisAlignment,
      axisScreenStart: new THREE.Vector2(event.clientX, event.clientY),
      axisWorldUnitsPerPixel,
      initialTransforms,
      rotationPivot,
      rotationAxis: worldAxis,
      rotationPlane,
      rotationStartVector: rotationStartVector && rotationStartVector.lengthSq() > 1e-8 ? rotationStartVector : undefined,
      rotationSolveMode,
      rotationScreenStart: screenRotation?.start,
      rotationScreenTangent: screenRotation?.tangent,
      rotationPixelsPerRad: screenRotation?.pixelsPerRad,
      rotationLastRawAngle: 0,
      rotationAccumulatedAngle: 0,
      axis: effectiveAxis,
      barriers,
      barrierGroupState: {},
      surfaceAttachments: new Map(),
      lastPointerClient: new THREE.Vector2(event.clientX, event.clientY),
      previousFinalPosition: active.mesh.position.clone(),
      moved: false,
    };
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.arrangementInteractionHandler?.(true);
    this.host.dataset.arrangementInteractionActive = "true";
    this.host.dataset.arrangementActiveHandle = gizmoHit
      ? `${gizmoHit.tool}:${gizmoHit.axis}`
      : "move:free";
    this.setArrangementPointerFeedback(this.arrangementTool === "rotate" ? "rotate-active" : "move-active");
    this.arrangementInteractionLastFrameAt = performance.now();
    this.arrangementInteractionWindowUntil = Number.POSITIVE_INFINITY;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private readonly handleArrangementPointerMove = (event: PointerEvent): void => {
    const startedAt = performance.now();
    const drag = this.dragState;
    if (!drag || drag.pointerId !== event.pointerId) {
      if (this.sewingState.active && this.viewportMode === "assembly" && event.buttons === 0) {
        const edge = this.raycastSewingEdge(event);
        this.sewingOverlay.setHovered(edge?.segmentIndex ?? null);
        this.renderer.domElement.style.cursor = edge ? "pointer" : "grab";
        this.requestRender();
        return;
      }
      if (this.viewportMode === "assembly" && event.buttons === 0 && this.sewingState.showThreads) {
        const thread = this.raycastSewingThread(event);
        if (thread) {
          this.renderer.domElement.style.cursor = "pointer";
          return;
        }
      }
      if (this.viewportMode === "assembly" && event.buttons === 0) this.updateArrangementHover(event);
      return;
    }
    const active = this.garmentMeshes.find((item) => item.key === drag.activeInstanceId);
    if (!active || active.mesh.userData.arrangementPinned === true) return;
    const body = this.currentAvatarModel?.humanBody.visualMesh;
    drag.surfaceAttachments.clear();

    if (drag.tool === "rotate") {
      let angle: number | null = null;
      if (drag.rotationSolveMode === "plane" && drag.rotationPlane && drag.rotationStartVector) {
        const currentPoint = this.pointerRay(event).intersectPlane(drag.rotationPlane, new THREE.Vector3());
        if (!currentPoint) return;
        const currentVector = currentPoint.sub(drag.rotationPivot);
        currentVector.addScaledVector(drag.rotationAxis, -currentVector.dot(drag.rotationAxis));
        if (currentVector.lengthSq() > 1e-10) {
          currentVector.normalize();
          const raw = signedRotationAngle(drag.rotationStartVector, currentVector, drag.rotationAxis);
          drag.rotationAccumulatedAngle = unwrapRotationAngle(
            drag.rotationLastRawAngle,
            raw,
            drag.rotationAccumulatedAngle,
          );
          drag.rotationLastRawAngle = raw;
          angle = drag.rotationAccumulatedAngle;
        }
      } else if (drag.rotationScreenStart && drag.rotationScreenTangent && drag.rotationPixelsPerRad) {
        const pointerDelta = new THREE.Vector2(event.clientX, event.clientY).sub(drag.rotationScreenStart);
        angle = pointerDelta.dot(drag.rotationScreenTangent) / drag.rotationPixelsPerRad;
      }
      if (angle === null || !Number.isFinite(angle)) return;
      const rotation = new THREE.Quaternion().setFromAxisAngle(drag.rotationAxis, angle);
      for (const item of this.garmentMeshes) {
        const initial = drag.initialTransforms.get(item.key);
        if (!initial) continue;
        applyFrozenRigidRotation(
          item.mesh,
          initial.position,
          initial.quaternion,
          drag.rotationPivot,
          rotation,
        );
      }
      if (body) this.constrainDraggedSelectionRigidly(body, drag);
      drag.moved = drag.moved || Math.abs(angle) >= 0.005;
      this.hideArrangementCandidate();
      this.updateArrangementGizmo();
      if (this.sewingState.showThreads) this.sewingOverlay.refreshThreads();
      this.markArrangementTransientFrame();
      this.recordArrangementPointerMove(performance.now() - startedAt);
      this.requestRender();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const ray = this.pointerRay(event);
    const delta = new THREE.Vector3();
    let pointerWorldPoint = drag.translationStartPoint;
    let currentAxisParameter: number | null = null;
    if (drag.axis !== "free") {
      const axis = arrangementAxisVector(drag.axis);
      const parameter = drag.axisSolveMode === "closest"
        ? closestRayAxisParameter(ray, drag.axisOrigin, axis)
        : drag.axisSolveMode === "plane"
          ? axisParameterOnDragPlane(ray, drag.dragPlane, drag.axisOrigin, axis)
          : drag.axisScreenStart && drag.axisWorldUnitsPerPixel
            ? (drag.axisStartParameter ?? 0) + (drag.axisScreenStart.y - event.clientY) * drag.axisWorldUnitsPerPixel
            : null;
      if (parameter === null || parameter === undefined || drag.axisStartParameter === undefined) return;
      currentAxisParameter = parameter;
      delta.copy(axis).multiplyScalar(parameter - drag.axisStartParameter);
    } else {
      const planePoint = intersectPointerRayWithDragPlane(ray, drag.dragPlane);
      if (!planePoint) return;
      pointerWorldPoint = planePoint;
      delta.copy(planePoint).sub(drag.translationStartPoint);
    }
    for (const item of this.garmentMeshes) {
      const initial = drag.initialTransforms.get(item.key);
      if (!initial) continue;
      applyFrozenRigidTranslation(item.mesh, initial.position, initial.quaternion, delta);
    }
    const rawDesiredPosition = active.mesh.position.clone();
    const barrierDiagnostic = body ? this.constrainDraggedSelectionRigidly(body, drag) : null;
    const finalPosition = active.mesh.position.clone();

    if (import.meta.env.DEV && drag.axis !== "free") {
      const pointer = new THREE.Vector2(event.clientX, event.clientY);
      const frameDisplacement = finalPosition.clone().sub(drag.previousFinalPosition);
      this.host.dataset.arrangementAxisDragDiagnostic = JSON.stringify({
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        clientX: event.clientX,
        clientY: event.clientY,
        pointerDeltaPx: pointer.clone().sub(drag.lastPointerClient).toArray(),
        axis: drag.axis,
        axisSolveMode: drag.axisSolveMode,
        axisAlignment: drag.axisAlignment,
        axisStartParameter: drag.axisStartParameter,
        currentParameter: currentAxisParameter,
        rawAxisDelta: currentAxisParameter !== null && drag.axisStartParameter !== undefined
          ? currentAxisParameter - drag.axisStartParameter
          : null,
        rawDesiredWorldPosition: rawDesiredPosition.toArray(),
        pointerAuthoredDeltaWorld: delta.toArray(),
        barrier: barrierDiagnostic ? {
          instanceId: barrierDiagnostic.instanceId,
          corrected: barrierDiagnostic.result.corrected,
          maximumCorrectionMm: barrierDiagnostic.result.maximumCorrectionMm,
          correctionWorld: barrierDiagnostic.result.correctionWorld,
          correctionNormalMm: barrierDiagnostic.result.correctionNormalMm,
          correctionTangentialMm: barrierDiagnostic.result.correctionTangentialMm,
          triangleIndex: barrierDiagnostic.result.surfaceAttachment?.triangleIndex,
          outwardNormal: barrierDiagnostic.result.contactOutwardNormal,
          responsibleSample: barrierDiagnostic.result.responsibleSample,
          contactSource: barrierDiagnostic.result.contactSource,
        } : null,
        finalWorldPosition: finalPosition.toArray(),
        frameDisplacementWorld: frameDisplacement.toArray(),
        rawToFinalWorld: finalPosition.clone().sub(rawDesiredPosition).toArray(),
      });
      drag.lastPointerClient.copy(pointer);
      drag.previousFinalPosition.copy(finalPosition);
    }

    if (body && drag.axis === "free" && drag.initialTransforms.size === 1) {
      const barrierAttachment = drag.surfaceAttachments.get(drag.activeInstanceId);
      const queried = barrierAttachment
        ? resolveBodySurfaceAttachment(body, barrierAttachment)
        : raycastBodySurface(
            body,
            [ray.origin.x, ray.origin.y, ray.origin.z],
            [ray.direction.x, ray.direction.y, ray.direction.z],
            12,
          );
      drag.surfaceCandidate = updateSurfaceCandidate(drag.surfaceCandidate, queried, pointerWorldPoint);
      this.showArrangementCandidate(drag.surfaceCandidate);
    }
    drag.moved = drag.moved || delta.lengthSq() > 1e-8;
    this.updateArrangementGizmo();
    if (this.sewingState.showThreads) this.sewingOverlay.refreshThreads();
    this.markArrangementTransientFrame();
    this.recordArrangementPointerMove(performance.now() - startedAt);
    this.requestRender();
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private readonly handleArrangementPointerUp = (event: PointerEvent): void => {
    const drag = this.dragState;
    if (!drag || drag.pointerId !== event.pointerId) {
      if (this.viewportMode === "assembly") {
        this.host.dataset.arrangementInteractionActive = "false";
        this.updateArrangementHover(event);
      }
      return;
    }
    const releaseStartedAt = performance.now();
    this.dragState = null;
    this.arrangementReleaseStartedAt = releaseStartedAt;
    this.arrangementInteractionWindowUntil = releaseStartedAt + 250;
    this.controls.enabled = true;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
    this.hideArrangementCandidate();
    if (drag.moved) {
      const attachments = new Map(drag.surfaceAttachments);
      if (drag.tool === "move" && drag.surfaceCandidate && !attachments.has(drag.activeInstanceId)) {
        attachments.set(drag.activeInstanceId, {
          ...drag.surfaceCandidate.attachment,
          barycentric: [...drag.surfaceCandidate.attachment.barycentric],
          normalOffsetMm: Math.max(8, drag.surfaceCandidate.attachment.normalOffsetMm),
        });
      }
      this.commitSelectedArrangement(attachments, drag.tool === "rotate");
    } else {
      for (const item of this.garmentMeshes) {
        const initial = drag.initialTransforms.get(item.key);
        if (!initial) continue;
        applyFrozenRigidTranslation(item.mesh, initial.position, initial.quaternion, new THREE.Vector3());
      }
      this.finishArrangementReleaseLatency();
    }
    delete this.host.dataset.arrangementActiveHandle;
    this.updateArrangementGizmo();
    if (this.sewingState.showThreads) this.sewingOverlay.refreshThreads();
    this.arrangementInteractionHandler?.(false);
    this.host.dataset.arrangementInteractionActive = "false";
    this.updateArrangementHover(event);
    this.requestRender();
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private constrainDraggedSelectionRigidly(
    body: AvatarParametricModel["humanBody"]["visualMesh"],
    drag: ArrangementDragState,
  ): { instanceId: string; result: BodyBarrierResult } | null {
    const members = this.garmentMeshes.flatMap((item) => {
      const state = drag.barriers.get(item.key);
      if (!drag.initialTransforms.has(item.key) || !state) return [];
      return [{
        key: item.key,
        mesh: item.mesh,
        state,
        priority: item.key === drag.activeInstanceId ? 0 : 1,
      }];
    });
    const constrained = constrainRigidMeshGroupOutsideBody(members, body, drag.barrierGroupState, { clearanceMm: 8 });
    if (!constrained) return null;
    if (constrained.result.surfaceAttachment && members.length === 1) {
      drag.surfaceAttachments.set(constrained.key, constrained.result.surfaceAttachment);
    }
    return { instanceId: constrained.key, result: constrained.result };
  }

  private raycastArrangementGizmo(event: PointerEvent): ArrangementHandleHit | null {
    if (!this.arrangementGizmo.visible) return null;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(this.pointerNdc(event), this.camera);
    const hit = raycaster.intersectObjects(this.arrangementGizmo.children, true)
      .find((candidate) => candidate.object.visible
        && candidate.object.userData.arrangementTool === this.arrangementTool
        && candidate.object.userData.arrangementAxis);
    if (!hit) return null;
    return {
      point: hit.point.clone(),
      axis: hit.object.userData.arrangementAxis as Exclude<ArrangementAxis, "free">,
      tool: hit.object.userData.arrangementTool as ArrangementTool,
    };
  }

  private raycastGarment(event: PointerEvent): THREE.Intersection | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(this.pointerNdc(event), this.camera);
    return raycaster.intersectObjects(this.garmentMeshes.map((item) => item.mesh), false)[0] ?? null;
  }

  private createScreenRotationSolver(
    pivot: THREE.Vector3,
    handlePoint: THREE.Vector3,
    axis: THREE.Vector3,
    event: PointerEvent,
  ): { start: THREE.Vector2; tangent: THREE.Vector2; pixelsPerRad: number } | null {
    const radial = handlePoint.clone().sub(pivot);
    radial.addScaledVector(axis, -radial.dot(axis));
    if (radial.lengthSq() <= 1e-8) {
      radial.crossVectors(axis, this.camera.getWorldDirection(new THREE.Vector3()));
      if (radial.lengthSq() <= 1e-8) radial.crossVectors(axis, this.camera.up);
      if (radial.lengthSq() <= 1e-8) return null;
      radial.normalize().multiplyScalar(0.2 * this.arrangementGizmo.scale.x);
    }
    const sampleAngle = 0.12;
    const startWorld = pivot.clone().add(radial);
    const rotatedWorld = pivot.clone().add(
      radial.clone().applyAxisAngle(axis.clone().normalize(), sampleAngle),
    );
    const startScreen = new THREE.Vector2(...this.worldToCanvasPoint(startWorld));
    const rotatedScreen = new THREE.Vector2(...this.worldToCanvasPoint(rotatedWorld));
    let tangent = rotatedScreen.sub(startScreen);
    let pixelsPerRad = tangent.length() / sampleAngle;
    if (!Number.isFinite(pixelsPerRad) || pixelsPerRad < 6) {
      const pivotScreen = new THREE.Vector2(...this.worldToCanvasPoint(pivot));
      const axisScreen = new THREE.Vector2(...this.worldToCanvasPoint(pivot.clone().add(axis)))
        .sub(pivotScreen);
      if (axisScreen.lengthSq() <= 4) return null;
      axisScreen.normalize();
      tangent = new THREE.Vector2(-axisScreen.y, axisScreen.x);
      pixelsPerRad = Math.max(24, startScreen.distanceTo(pivotScreen));
    } else {
      tangent.normalize();
    }
    return {
      start: new THREE.Vector2(event.clientX, event.clientY),
      tangent,
      pixelsPerRad,
    };
  }

  private updateArrangementHover(event: PointerEvent): void {
    if (this.viewportMode !== "assembly" || this.dragState) return;
    const handle = this.raycastArrangementGizmo(event);
    const garment = handle ? null : this.raycastGarment(event);
    const instanceId = garment
      ? this.garmentMeshes.find((item) => item.mesh === garment.object)?.key ?? null
      : null;
    const nextHandle = handle ? { tool: handle.tool, axis: handle.axis } : null;
    const handleChanged = this.hoveredArrangementHandle?.tool !== nextHandle?.tool
      || this.hoveredArrangementHandle?.axis !== nextHandle?.axis;
    const garmentChanged = this.hoveredArrangementInstanceId !== instanceId;
    this.hoveredArrangementHandle = nextHandle;
    this.hoveredArrangementInstanceId = instanceId;
    if (handle) this.setArrangementPointerFeedback(handle.tool === "rotate" ? "rotate-handle" : "move-handle");
    else if (garment) this.setArrangementPointerFeedback("panel");
    else this.setArrangementPointerFeedback("idle");
    if (handleChanged || garmentChanged) {
      this.updateArrangementGizmo();
      this.requestRender();
    }
  }

  private setArrangementPointerFeedback(
    mode: "idle" | "panel" | "move-handle" | "rotate-handle" | "move-active" | "rotate-active" | "orbit" | "pan" | "zoom",
  ): void {
    const cursor = mode === "panel" || mode === "move-handle"
      ? "grab"
      : mode === "rotate-handle"
        ? "crosshair"
        : mode === "pan"
          ? "move"
          : mode === "zoom"
            ? "ns-resize"
            : mode === "idle" ? "default" : "grabbing";
    this.renderer.domElement.style.cursor = cursor;
    this.host.dataset.arrangementPointerMode = mode;
    if (this.hoveredArrangementHandle) {
      this.host.dataset.arrangementHoveredHandle = `${this.hoveredArrangementHandle.tool}:${this.hoveredArrangementHandle.axis}`;
    } else {
      delete this.host.dataset.arrangementHoveredHandle;
    }
    if (this.hoveredArrangementInstanceId) {
      this.host.dataset.arrangementHoveredInstanceId = this.hoveredArrangementInstanceId;
    } else {
      delete this.host.dataset.arrangementHoveredInstanceId;
    }
  }

  private readonly handleArrangementPointerLeave = (): void => {
    if (this.dragState) return;
    this.hoveredArrangementHandle = null;
    this.hoveredArrangementInstanceId = null;
    this.setArrangementPointerFeedback("idle");
    this.updateArrangementGizmo();
    this.requestRender();
  };

  private readonly handleViewportContextMenu = (event: MouseEvent): void => {
    if (this.viewportMode === "assembly") event.preventDefault();
  };

  private pointerRay(event: PointerEvent): THREE.Ray {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(this.pointerNdc(event), this.camera);
    return raycaster.ray;
  }

  private raycastSewingEdge(event: PointerEvent): ReturnType<SewingViewportOverlay["edgeAtIntersection"]> {
    const raycaster = new THREE.Raycaster();
    const depth = this.camera.position.distanceTo(this.controls.target);
    raycaster.params.Line = {
      threshold: perspectiveWorldUnitsPerPixel(depth, this.camera.fov, this.renderer.domElement.clientHeight) * 22,
    };
    raycaster.setFromCamera(this.pointerNdc(event), this.camera);
    const hit = raycaster.intersectObject(this.sewingOverlay.edgeLines, false)[0];
    return hit ? this.sewingOverlay.edgeAtIntersection(hit) : null;
  }

  private raycastSewingThread(event: PointerEvent): ReturnType<SewingViewportOverlay["threadAtIntersection"]> {
    const raycaster = new THREE.Raycaster();
    const depth = this.camera.position.distanceTo(this.controls.target);
    raycaster.params.Line = {
      threshold: perspectiveWorldUnitsPerPixel(depth, this.camera.fov, this.renderer.domElement.clientHeight) * 14,
    };
    raycaster.setFromCamera(this.pointerNdc(event), this.camera);
    const hit = raycaster.intersectObject(this.sewingOverlay.threadLines, false)[0];
    return hit ? this.sewingOverlay.threadAtIntersection(hit) : null;
  }

  private refreshSewingOverlay(): void {
    const proposalWarnings: string[] = [];
    const inactiveWarnings: string[] = [];
    const proposalConstraints = this.assemblyState && this.sewingState.proposal
      ? buildGlobalStitchConstraints(this.assemblyState.instances, [this.sewingState.proposal], proposalWarnings)
      : [];
    const inactiveSeams = (this.currentInput?.garmentProjection.seams ?? [])
      .filter((seam) => seam.active === false)
      .map((seam) => ({ ...seam, active: true }));
    const inactiveConstraints = this.assemblyState && inactiveSeams.length > 0
      ? buildGlobalStitchConstraints(this.assemblyState.instances, inactiveSeams, inactiveWarnings)
      : [];
    this.sewingOverlay.rebuild(
      this.garmentMeshes,
      this.assemblyState,
      this.sewingState,
      proposalConstraints,
      inactiveConstraints,
    );
    const assemblyVisible = this.viewportMode === "assembly";
    this.sewingOverlay.setVisibility(
      assemblyVisible && this.sewingState.active,
      assemblyVisible && this.sewingState.showThreads,
    );
    this.host.dataset.sewingPhysicalThreadCount = String(
      (this.assemblyState?.stitchConstraints.filter((constraint) => !constraint.seamGroupId.startsWith("dart:")).length ?? 0)
      + proposalConstraints.length,
    );
    this.host.dataset.sewingInactiveVisualConstraintCount = String(inactiveConstraints.length);
    this.host.dataset.sewingThreadCount = String(this.sewingOverlay.visualThreadCount);
    this.host.dataset.sewingDirectionNotchCount = String(this.sewingOverlay.directionNotchCount);
    this.host.dataset.sewingProposalWarnings = JSON.stringify(proposalWarnings);
    this.host.dataset.sewingInactiveWarnings = JSON.stringify(inactiveWarnings);
  }

  private pointerNdc(event: PointerEvent): THREE.Vector2 {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1,
      -((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2 + 1,
    );
  }

  private commitSelectedArrangement(
    surfaceAttachments: ReadonlyMap<string, ArrangementCommit["surfaceAttachment"]> = new Map(),
    preserveExistingSurface = false,
  ): void {
    const commits = this.garmentMeshes
      .filter((item) => this.selectedInstanceIds.has(item.key))
      .map((item) => captureMeshArrangement(
        item.key,
        item.mesh,
        surfaceAttachments.get(item.key)
          ?? (preserveExistingSurface ? this.surfaceAttachmentForInstance(item.key) : undefined),
      ));
    if (commits.length === 0) return;
    this.host.dataset.arrangementGestureCommits = String(
      Number(this.host.dataset.arrangementGestureCommits ?? "0") + 1,
    );
    this.arrangementCommitHandler?.(commits);
  }

  private surfaceAttachmentForInstance(instanceId: string): ArrangementCommit["surfaceAttachment"] | undefined {
    const attachment = this.currentInput?.panelInstances.find((instance) => instance.id === instanceId)?.arrangementAnchor?.surfaceAttachment;
    return attachment ? structuredClone(attachment) : undefined;
  }

  private markArrangementTransientFrame(): void {
    this.host.dataset.arrangementTransientFrames = String(
      Number(this.host.dataset.arrangementTransientFrames ?? "0") + 1,
    );
  }

  private showArrangementCandidate(candidate: BodySurfaceFrame | undefined): void {
    if (!candidate) {
      this.hideArrangementCandidate();
      return;
    }
    this.arrangementCandidateMarker.position.set(...candidate.position);
    this.arrangementCandidateMarker.visible = true;
    this.host.dataset.arrangementSurfaceCandidate = JSON.stringify({
      triangleIndex: candidate.attachment.triangleIndex,
      barycentric: candidate.attachment.barycentric,
    });
  }

  private hideArrangementCandidate(): void {
    this.arrangementCandidateMarker.visible = false;
    delete this.host.dataset.arrangementSurfaceCandidate;
  }

  private applyArrangementSelectionVisuals(): void {
    for (const item of this.garmentMeshes) {
      const selected = this.selectedInstanceIds.has(item.key);
      item.mesh.userData.arrangementSelected = selected;
      const materials = Array.isArray(item.mesh.material) ? item.mesh.material : [item.mesh.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        if (material.userData.arrangementBaseEmissive === undefined) {
          material.userData.arrangementBaseEmissive = material.emissive.getHex();
        }
        material.emissive.setHex(selected ? 0x5f4200 : material.userData.arrangementBaseEmissive as number);
        material.emissiveIntensity = selected ? 0.35 : 1;
      }
    }
    this.updateArrangementGizmo();
    this.requestRender();
  }

  private installDevViewportBridge(): void {
    const target = window as Window & {
      __MOLDEON_VIEWPORT_DEV__?: {
        cameraView(view: "front" | "side" | "back"): void;
        instanceScreenPosition(instanceId: string): [number, number] | null;
        bodyScreenPosition(): [number, number] | null;
        arrangementAudit(): Record<string, unknown>;
        arrangementMetrics(): Record<string, unknown>;
      };
    };
    target.__MOLDEON_VIEWPORT_DEV__ = {
      cameraView: (view) => this.setCanonicalCameraView(view),
      instanceScreenPosition: (instanceId) => {
        const item = this.garmentMeshes.find((candidate) => candidate.key === instanceId);
        return item ? this.worldToCanvasPoint(meshWorldCentroid(item.mesh)) : null;
      },
      bodyScreenPosition: () => {
        const landmark = this.currentAvatarModel?.humanBody.landmarks["center-front-waist"];
        return landmark ? this.worldToCanvasPoint(new THREE.Vector3(...landmark.position)) : null;
      },
      arrangementAudit: () => {
        const body = this.currentAvatarModel?.humanBody.visualMesh;
        if (!body) return {};
        return Object.fromEntries(this.garmentMeshes.map((item) => [
          item.key,
          auditMeshBodyClearance(item.mesh, body, 1, 128),
        ]));
      },
      arrangementMetrics: () => this.arrangementPerformanceSnapshot(),
    };
  }

  private worldToCanvasPoint(world: THREE.Vector3): [number, number] {
    const projected = world.clone().project(this.camera);
    const bounds = this.renderer.domElement.getBoundingClientRect();
    return [
      bounds.left + (projected.x + 1) * 0.5 * bounds.width,
      bounds.top + (1 - projected.y) * 0.5 * bounds.height,
    ];
  }

  private selectionCentroid(instanceIds: ReadonlySet<string> = this.selectedInstanceIds): THREE.Vector3 {
    const center = new THREE.Vector3();
    let count = 0;
    for (const item of this.garmentMeshes) {
      if (!instanceIds.has(item.key)) continue;
      center.add(meshWorldCentroid(item.mesh));
      count += 1;
    }
    return count > 0 ? center.multiplyScalar(1 / count) : center;
  }

  private updateArrangementGizmo(): void {
    const visible = this.viewportMode === "assembly" && this.selectedInstanceIds.size > 0;
    this.arrangementGizmo.visible = visible;
    if (!visible) return;
    const center = this.selectionCentroid();
    this.arrangementGizmo.position.copy(center);
    const cameraDirection = this.camera.getWorldDirection(new THREE.Vector3());
    const depth = Math.max(0.08, center.clone().sub(this.camera.position).dot(cameraDirection));
    const viewportHeight = Math.max(1, this.renderer.domElement.clientHeight);
    const worldPerPixel = perspectiveWorldUnitsPerPixel(depth, this.camera.fov, viewportHeight);
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const targetPixels = arrangementGizmoTargetPixels(
      this.renderer.domElement.clientWidth,
      this.renderer.domElement.clientHeight,
      coarsePointer,
    );
    const scale = worldPerPixel * targetPixels / 0.285;
    this.host.dataset.arrangementGizmoTargetPx = String(targetPixels);
    this.arrangementGizmo.scale.setScalar(Math.max(0.01, scale));
    this.arrangementGizmo.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const tool = object.userData.arrangementTool as ArrangementTool | undefined;
      object.visible = tool === this.arrangementTool;
      const material = object.material;
      if (!(material instanceof THREE.MeshBasicMaterial) || object.userData.arrangementVisibleHandle !== true) return;
      const axis = object.userData.arrangementAxis as Exclude<ArrangementAxis, "free"> | undefined;
      const hoveredHandle = this.hoveredArrangementHandle;
      const drag = this.dragState;
      const hovered = Boolean(axis
        && hoveredHandle
        && hoveredHandle.tool === tool
        && hoveredHandle.axis === axis);
      const active = Boolean(axis
        && drag
        && drag.tool === tool
        && drag.axis === axis);
      const selectedAxis = axis === this.arrangementAxis;
      material.opacity = active ? 1 : hovered ? 0.96 : selectedAxis ? 0.88 : 0.68;
      const baseColor = object.userData.arrangementBaseColor as number | undefined;
      if (baseColor !== undefined) {
        material.color.setHex(baseColor);
        if (active || hovered) material.color.lerp(new THREE.Color(0xffffff), active ? 0.38 : 0.22);
      }
    });
    this.arrangementGizmo.updateMatrixWorld(true);
  }

  private installArrangementPerformanceObserver(): void {
    if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("longtask")) return;
    try {
      this.performanceObserver = new PerformanceObserver((list) => {
        if (!this.dragState && performance.now() > this.arrangementInteractionWindowUntil) return;
        for (const entry of list.getEntries()) this.pushArrangementSample(this.arrangementLongTasksMs, entry.duration);
        this.writeArrangementPerformanceMetrics();
      });
      this.performanceObserver.observe({ entryTypes: ["longtask"] });
    } catch {
      this.performanceObserver = null;
    }
  }

  private recordArrangementPointerMove(durationMs: number): void {
    this.pushArrangementSample(this.arrangementPointerMoveMs, durationMs);
    this.writeArrangementPerformanceMetrics();
  }

  private finishArrangementReleaseLatency(): void {
    if (this.arrangementReleaseStartedAt <= 0) return;
    const startedAt = this.arrangementReleaseStartedAt;
    window.requestAnimationFrame(() => {
      this.pushArrangementSample(this.arrangementReleaseMs, performance.now() - startedAt);
      this.arrangementReleaseStartedAt = 0;
      this.writeArrangementPerformanceMetrics();
    });
  }

  private pushArrangementSample(target: number[], value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    target.push(value);
    if (target.length > 512) target.splice(0, target.length - 512);
  }

  private arrangementPerformanceSnapshot(): Record<string, unknown> {
    return {
      pointerMoveMs: summarizePerformanceSamples(this.arrangementPointerMoveMs),
      frameMs: summarizePerformanceSamples(this.arrangementFrameMs),
      releaseToResponsiveMs: summarizePerformanceSamples(this.arrangementReleaseMs),
      longTaskMs: summarizePerformanceSamples(this.arrangementLongTasksMs),
      gestures: Number(this.host.dataset.arrangementGestureCommits ?? "0"),
      assemblySolves: Number(this.host.dataset.arrangementAssemblySolves ?? "0"),
      xpbdInitializations: Number(this.host.dataset.arrangementXpbdInitializations ?? "0"),
    };
  }

  private writeArrangementPerformanceMetrics(): void {
    this.host.dataset.arrangementPerformance = JSON.stringify(this.arrangementPerformanceSnapshot());
  }

  private setCanonicalCameraView(view: "front" | "side" | "back"): void {
    const distance = Math.max(0.45, this.camera.position.distanceTo(this.controls.target));
    const direction = view === "front"
      ? new THREE.Vector3(0, 0, 1)
      : view === "back"
        ? new THREE.Vector3(0, 0, -1)
        : new THREE.Vector3(1, 0, 0);
    this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.requestRender();
  }

  private configureRegistrationAxes(
    state: GarmentAssemblyState,
    registration: GarmentRegistrationDiagnostic,
  ): void {
    disposeObject(this.registrationAxesGroup);
    this.registrationAxesGroup.clear();
    const bodyOrigin = new THREE.Vector3(0, 0.012, 0);
    addFrameAxes(this.registrationAxesGroup, bodyOrigin, "body", 0.18);
    const garmentOrigin = garmentCentroid(state.positions);
    addFrameAxes(this.registrationAxesGroup, garmentOrigin, "garment", 0.12);
    this.registrationAxesGroup.userData.registration = registration;
    this.registrationAxesGroup.visible = this.devSettings.showRegistrationAxes;
  }

  private configureApprovedAvatar(
    bodyType: BodyType,
  ): { changed: boolean; warning?: string } {
    const descriptor = approvedAvatarForBody(bodyType);
    if (!descriptor) {
      const signature = `missing:${bodyType}`;
      const changed = signature !== this.avatarSignature;
      if (changed) {
        this.avatarLoadController?.abort();
        this.avatarLoadController = null;
        this.clearAvatar();
        this.avatarSignature = signature;
      }
      this.host.dataset.avatarVisible = "false";
      this.host.dataset.avatarStatus = "not-configured";
      return { changed, warning: AVATAR_NOT_CONFIGURED_MESSAGE };
    }

    const signature = `${descriptor.assetId}@${descriptor.version}`;
    if (signature === this.avatarSignature) return { changed: false };
    this.avatarLoadController?.abort();
    const controller = new AbortController();
    this.avatarLoadController = controller;
    this.clearAvatar();
    this.avatarSignature = signature;
    this.host.dataset.avatarVisible = "false";
    this.host.dataset.avatarStatus = "loading";

    void loadApprovedAvatar(descriptor, controller.signal)
      .then((loaded) => {
        if (this.disposed || controller.signal.aborted || this.avatarSignature !== signature) {
          disposeObject(loaded.root);
          loaded.root.clear();
          return;
        }
        this.avatarGroup.add(loaded.root);
        this.host.dataset.avatarVisible = "true";
        this.host.dataset.avatarStatus = "ready";
        this.host.dataset.avatarAssetId = descriptor.assetId;
        this.host.dataset.avatarInspection = JSON.stringify(loaded.inspection);
        this.frameDressedScene();
        this.requestRender();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || this.disposed) return;
        console.error("Falha ao carregar o manequim aprovado.", error);
        this.host.dataset.avatarVisible = "false";
        this.host.dataset.avatarStatus = "error";
      });

    return { changed: true, warning: "Carregando manequim humano aprovado…" };
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.host.dataset.viewportSize = `${width}x${height}`;
  }

  private readonly requestRender = (): void => {
    if (this.disposed || this.frameId !== null) return;
    this.frameId = window.requestAnimationFrame(this.render);
  };

  private readonly render = (time: number): void => {
    this.frameId = null;
    if (this.disposed) return;
    if (this.dragState || performance.now() <= this.arrangementInteractionWindowUntil) {
      if (this.arrangementInteractionLastFrameAt > 0) {
        this.pushArrangementSample(this.arrangementFrameMs, time - this.arrangementInteractionLastFrameAt);
      }
      this.arrangementInteractionLastFrameAt = time;
    }
    const deltaSeconds = this.lastFrameAt === 0 ? 1 / 60 : Math.min((time - this.lastFrameAt) / 1000, 0.05);
    this.lastFrameAt = time;
    const frame = this.simulation.consumeLatestFrame();
    if (frame) {
      if (frame.revision === this.assemblyRevision
        && frame.generation === this.assemblyGeneration
        && frame.epoch === this.simulationEpoch
        && this.assemblyState
        && frame.positions.length === this.assemblyState.positions.length
        && frameCanUpdateMeshes(frame.positions, this.assemblyState, this.garmentMeshes)) {
        this.assemblyState.positions.set(frame.positions);
        for (const mesh of this.garmentMeshes) refreshMeshFromAssembly(mesh, this.assemblyState);
        const appliedAt = performance.now();
        if (this.lastAppliedFrameAt > 0) {
          const instantaneousFps = 1000 / Math.max(1, appliedAt - this.lastAppliedFrameAt);
          this.approximateFps = this.approximateFps === 0
            ? instantaneousFps
            : this.approximateFps * 0.8 + instantaneousFps * 0.2;
        }
        this.lastAppliedFrameAt = appliedAt;
        this.framesApplied += 1;
        this.writeFrameCounters();
        this.writeSimulationDiagnostics(frame.diagnostics);
        if (import.meta.env.DEV) {
          this.host.dataset.garmentMeshDiagnostics = JSON.stringify(captureGarmentMeshDiagnostics(this.garmentMeshes));
        }
        this.host.dataset.simulationPositionSignature = assemblyPositionSignature(frame.positions);
        this.host.dataset.simulationWorkerReady = JSON.stringify({
          revision: frame.revision,
          generation: frame.generation,
          epoch: frame.epoch,
        });
        this.host.dataset.simulationAppliedFrame = JSON.stringify({
          revision: frame.revision,
          generation: frame.generation,
          epoch: frame.epoch,
          sequence: frame.sequence,
          positionsLength: frame.positions.length,
        });
      } else {
        this.host.dataset.simulationRejectedFrame = JSON.stringify({
          revision: frame.revision,
          generation: frame.generation,
          expectedRevision: this.assemblyRevision,
          expectedGeneration: this.assemblyGeneration,
          epoch: frame.epoch,
          expectedEpoch: this.simulationEpoch,
          positionsLength: frame.positions.length,
          expectedPositionsLength: this.assemblyState?.positions.length ?? 0,
        });
      }
      this.simulation.recycleFrame(frame);
    }
    this.controls.update(deltaSeconds);
    if (this.arrangementGizmo.visible) this.updateArrangementGizmo();
    if (this.sewingOverlay.group.visible) this.sewingOverlay.refreshPositions();
    this.renderer.render(this.scene, this.camera);
    if (this.simulationRunning) this.requestRender();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.resumeAfterVisibility = this.simulationRunning;
      if (this.simulationRunning) this.pauseSimulation();
      return;
    }
    if (this.resumeAfterVisibility) this.resumeSimulation();
    this.resumeAfterVisibility = false;
  };

  private writeSimulationDiagnostics(diagnostics: XpbdWorkerDiagnostics): void {
    this.host.dataset.simulationDiagnostics = JSON.stringify(diagnostics);
    this.onSimulationDiagnosticsChange?.({ ...diagnostics, approximateFps: this.approximateFps, bodyRegistrationStatus: this.bodyRegistrationStatus });
  }

  private scaledGravity(): [number, number, number] {
    return this.baseGravity.map((value) => value * this.devSettings.gravityScale) as [number, number, number];
  }

  private applyWorkerDevSettings(): void {
    this.simulation.configureDev({
      gravity: this.scaledGravity(),
      cadence: this.devSettings.cadence,
      autoPauseSteps: this.devSettings.autoPauseSteps,
      bodyCollisionEnabled: this.devSettings.bodyCollisionEnabled && this.bodyRegistrationStatus === "registered",
      floorCollisionEnabled: this.devSettings.floorCollisionEnabled,
    });
    this.applyDevBodyVisibility();
  }

  private applyWireframe(): void {
    for (const item of this.garmentMeshes) {
      const materials = Array.isArray(item.mesh.material) ? item.mesh.material : [item.mesh.material];
      for (const material of materials) {
        if ("wireframe" in material) {
          (material as THREE.MeshStandardMaterial).wireframe = this.wireframeEnabled;
          material.needsUpdate = true;
        }
      }
    }
    this.host.dataset.simulationWireframe = String(this.wireframeEnabled);
  }

  private writeFrameCounters(): void {
    this.host.dataset.simulationFrameCounters = JSON.stringify({
      received: this.framesReceived,
      applied: this.framesApplied,
      discarded: this.framesDiscarded,
    });
  }

  private traceLifecycle(event: string, detail: object): void {
    if (!import.meta.env.DEV) return;
    const trace = JSON.parse(this.host.dataset.simulationLifecycleTrace ?? "[]") as object[];
    trace.push({
      timestampMs: performance.now(),
      event,
      revision: this.assemblyRevision,
      generation: this.assemblyGeneration,
      simulationRunning: this.simulationRunning,
      framesReceived: this.framesReceived,
      framesApplied: this.framesApplied,
      framesDiscarded: this.framesDiscarded,
      ...detail,
    });
    if (trace.length > 200) trace.splice(0, trace.length - 200);
    this.host.dataset.simulationLifecycleTrace = JSON.stringify(trace);
  }
}

function summarizeAssemblySeamGraph(state: GarmentAssemblyState): {
  nodes: string[];
  edges: Array<{
    seamGroupId: string;
    firstInstanceId: string;
    secondInstanceId: string;
    sampleCount: number;
  }>;
} {
  const byKey = new Map<string, {
    seamGroupId: string;
    firstInstanceId: string;
    secondInstanceId: string;
    sampleCount: number;
  }>();
  for (const constraint of state.stitchConstraints) {
    if (!constraint.instanceA || !constraint.instanceB) continue;
    const instances = [constraint.instanceA, constraint.instanceB].sort();
    const key = `${constraint.seamGroupId}\u0000${instances[0]}\u0000${instances[1]}`;
    const current = byKey.get(key);
    if (current) current.sampleCount += 1;
    else byKey.set(key, {
      seamGroupId: constraint.seamGroupId,
      firstInstanceId: instances[0],
      secondInstanceId: instances[1],
      sampleCount: 1,
    });
  }
  return {
    nodes: state.instances.map((instance) => instance.id).sort(),
    edges: [...byKey.values()].sort((left, right) =>
      left.seamGroupId.localeCompare(right.seamGroupId)
      || left.firstInstanceId.localeCompare(right.firstInstanceId)
      || left.secondInstanceId.localeCompare(right.secondInstanceId)),
  };
}

function frameCanUpdateMeshes(
  positions: Float32Array,
  state: GarmentAssemblyState,
  meshes: readonly GarmentAssemblyMeshData[],
): boolean {
  for (const value of positions) if (!Number.isFinite(value)) return false;
  const instanceById = new Map(state.instances.map((instance) => [instance.id, instance]));
  for (const mesh of meshes) {
    const instance = instanceById.get(mesh.key);
    const positionAttribute = mesh.mesh.geometry.getAttribute("position");
    if (!instance
      || instance.particleStart < 0
      || instance.particleStart + instance.vertexCount > positions.length / 3
      || positionAttribute.count !== instance.vertexCount) return false;
    const index = mesh.mesh.geometry.index;
    if (index) {
      for (let offset = 0; offset < index.count; offset += 1) {
        if (index.getX(offset) >= instance.vertexCount) return false;
      }
    }
  }
  return true;
}

async function createRenderer(
  profile: PerformanceProfile,
  signal?: AbortSignal,
): Promise<{ renderer: ViewportRenderer; backend: RenderBackend }> {
  if ("gpu" in navigator) {
    let renderer: WebGPURenderer | null = null;
    try {
      const { WebGPURenderer } = await import("three/webgpu");
      if (signal?.aborted) throw new DOMException("Inicialização do viewport cancelada.", "AbortError");
      renderer = new WebGPURenderer({ antialias: profile.antialias, alpha: false });
      await renderer.init();
      return { renderer, backend: "webgpu" };
    } catch (error) {
      renderer?.dispose();
      if (signal?.aborted) throw error;
      console.info("WebGPU indisponível; usando WebGL 2.", error);
    }
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {
    alpha: false,
    antialias: profile.antialias,
    powerPreference: "high-performance",
  });
  if (!context) throw new Error("Este navegador não disponibiliza WebGPU nem WebGL 2.");
  return {
    renderer: new THREE.WebGLRenderer({ canvas, context, alpha: false, antialias: profile.antialias, powerPreference: "high-performance" }),
    backend: "webgl2",
  };
}

function getPerformanceProfile(): PerformanceProfile {
  const compact = window.matchMedia("(max-width: 760px)").matches;
  const lowPower = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4;
  if (compact || lowPower) {
    return { antialias: false, maxPixelRatio: 1.25, shadows: false };
  }
  return { antialias: true, maxPixelRatio: 1.75, shadows: true };
}

function createLights(): THREE.Group {
  const group = new THREE.Group();
  const ambient = new THREE.HemisphereLight(0xffffff, 0x4a4a50, 2.1);
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(3, 5, 4);
  key.castShadow = true;
  key.shadow.bias = -0.0001;
  key.shadow.normalBias = 0.002;
  const fill = new THREE.DirectionalLight(0xc8d2ff, 1.2);
  fill.position.set(-3, 2, 2);
  group.add(ambient, key, fill);
  return group;
}

function createFloor(shadows: boolean): THREE.Mesh {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.8, 48),
    new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = shadows;
  return floor;
}

function arrangementAxisVector(axis: Exclude<ArrangementAxis, "free">): THREE.Vector3 {
  return axis === "x" ? new THREE.Vector3(1, 0, 0) : axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
}

function rotateMeshAroundPivot(
  mesh: THREE.Mesh,
  pivot: THREE.Vector3,
  axis: THREE.Vector3,
  angleRad: number,
): void {
  const rotation = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), angleRad);
  const centroid = meshWorldCentroid(mesh);
  const nextCentroid = centroid.clone().sub(pivot).applyQuaternion(rotation).add(pivot);
  mesh.quaternion.premultiply(rotation);
  mesh.updateMatrixWorld(true);
  const movedCentroid = meshWorldCentroid(mesh);
  mesh.position.add(nextCentroid.sub(movedCentroid));
  mesh.updateMatrixWorld(true);
}

function createArrangementGizmo(): THREE.Group {
  const group = new THREE.Group();
  group.name = "arrangement-gizmo";
  group.visible = false;
  const colors = { x: 0xc65a57, y: 0x5d9f67, z: 0x5b78b8 } as const;
  const axes = ["x", "y", "z"] as const;
  for (const axis of axes) {
    const direction = arrangementAxisVector(axis);
    const moveMaterial = new THREE.MeshBasicMaterial({ color: colors[axis], transparent: true, opacity: 0.72, depthTest: false, depthWrite: false });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 10), moveMaterial);
    shaft.position.copy(direction).multiplyScalar(0.11);
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    shaft.userData.arrangementTool = "move";
    shaft.userData.arrangementAxis = axis;
    shaft.userData.arrangementVisibleHandle = true;
    shaft.userData.arrangementBaseColor = colors[axis];
    shaft.renderOrder = 20;
    group.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.07, 12), moveMaterial.clone());
    head.position.copy(direction).multiplyScalar(0.25);
    head.quaternion.copy(shaft.quaternion);
    head.userData.arrangementTool = "move";
    head.userData.arrangementAxis = axis;
    head.userData.arrangementVisibleHandle = true;
    head.userData.arrangementBaseColor = colors[axis];
    head.renderOrder = 20;
    group.add(head);

    const moveHitMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      colorWrite: false,
    });
    const moveHit = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.3, 8), moveHitMaterial);
    moveHit.position.copy(direction).multiplyScalar(0.18);
    moveHit.quaternion.copy(shaft.quaternion);
    moveHit.userData.arrangementTool = "move";
    moveHit.userData.arrangementAxis = axis;
    moveHit.userData.arrangementHitTarget = true;
    moveHit.renderOrder = 21;
    group.add(moveHit);

    const rotateMaterial = new THREE.MeshBasicMaterial({ color: colors[axis], transparent: true, opacity: 0.72, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.008, 8, 48), rotateMaterial);
    if (axis === "x") ring.rotation.y = Math.PI / 2;
    else if (axis === "y") ring.rotation.x = Math.PI / 2;
    ring.userData.arrangementTool = "rotate";
    ring.userData.arrangementAxis = axis;
    ring.userData.arrangementVisibleHandle = true;
    ring.userData.arrangementBaseColor = colors[axis];
    ring.renderOrder = 20;
    group.add(ring);

    const rotateHit = new THREE.Mesh(
      new THREE.TorusGeometry(0.19, 0.034, 8, 48),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        colorWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    rotateHit.rotation.copy(ring.rotation);
    rotateHit.userData.arrangementTool = "rotate";
    rotateHit.userData.arrangementAxis = axis;
    rotateHit.userData.arrangementHitTarget = true;
    rotateHit.renderOrder = 21;
    group.add(rotateHit);
  }
  return group;
}

function summarizePerformanceSamples(values: readonly number[]): { count: number; p50: number; p95: number; p99: number; max: number } {
  if (values.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const pick = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
  return { count: sorted.length, p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), max: sorted[sorted.length - 1] };
}

function createArrangementCandidateMarker(): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xd3a72c, transparent: true, opacity: 0.85, depthTest: false }),
  );
  marker.visible = false;
  marker.renderOrder = 20;
  return marker;
}

function addFrameAxes(
  group: THREE.Group,
  origin: THREE.Vector3,
  label: string,
  length: number,
): void {
  const arrows = [
    new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origin, length, 0xc64545),
    new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), origin, length, 0x3d9348),
    new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), origin, length, 0x376fb3),
  ];
  arrows.forEach((arrow, index) => {
    arrow.name = `${label}:${index === 0 ? "right" : index === 1 ? "up" : "front"}`;
    group.add(arrow);
  });
}

function garmentCentroid(positions: Float32Array): THREE.Vector3 {
  const center = new THREE.Vector3();
  const count = positions.length / 3;
  for (let offset = 0; offset < positions.length; offset += 3) {
    center.x += positions[offset];
    center.y += positions[offset + 1];
    center.z += positions[offset + 2];
  }
  return count > 0 ? center.multiplyScalar(1 / count) : center;
}

function measurementOriginsFromDocument(
  measurements: ResolvedAssemblyInput["document"]["measurements"],
): Record<string, "supplied" | "estimated" | "derived"> {
  return Object.fromEntries([
    ...(measurements.derivedKeys ?? []).map((key) => [key, "derived"] as const),
    ...measurements.estimatedKeys.map((key) => [key, "estimated"] as const),
    ...(measurements.suppliedKeys ?? []).map((key) => [key, "supplied"] as const),
  ]);
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    disposeMesh(object);
  });
}

function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  disposeMaterial(mesh.material);
}

function meshWorldCentroid(mesh: THREE.Mesh): THREE.Vector3 {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const center = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  return mesh.localToWorld(center);
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  const entries = Array.isArray(material) ? material : [material];
  const textures = new Set<THREE.Texture>();
  for (const entry of entries) {
    for (const value of Object.values(entry)) {
      if (value instanceof THREE.Texture && !textures.has(value)) {
        textures.add(value);
        value.dispose();
      }
    }
    entry.dispose();
  }
}
