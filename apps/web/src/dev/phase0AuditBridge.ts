import type { BaselineFixtureId } from "../testFixtures/baselineGarments";

export interface Phase0AuditState {
  garmentId: string;
  templateId: string;
  activePieceId: string;
  pieceSelectionActive: boolean;
  selectedPieceIds: string[];
  selectedPointId: string | null;
  selectedEdgeId: string | null;
  selectedSeamId: string | null;
  seamCount: number;
  seams: Array<{ id: string; name: string; direction: string; active: boolean }>;
  simulateVersion: number;
  pieces: Array<{
    id: string;
    name: string;
    pointCount: number;
    dartCount: number;
    cutQuantity: number;
    cutOnFold: boolean;
    visible: boolean;
    locked: boolean;
    xMm: number;
    yMm: number;
    rotationDeg: number;
    roles: string[];
  }>;
}

export interface Phase0AssemblySummary {
  invalid: boolean;
  warningCount: number;
  warnings: string[];
  particleCount: number;
  instanceCount: number;
  triangleCount: number;
  structuralConstraintCount: number;
  stitchConstraintCount: number;
  anchorConstraintCount: number;
  instances: Array<{
    id: string;
    pieceId: string;
    bodySide: string;
    surface: string;
    vertexCount: number;
    triangleCount: number;
  }>;
}

export interface Phase0AuditBridge {
  fixtureIds: readonly BaselineFixtureId[];
  loadFixture(id: BaselineFixtureId): Phase0AuditState;
  state(): Phase0AuditState;
  assembly(): Phase0AssemblySummary;
  movePiece(pieceId: string, xMm: number, yMm: number): Phase0AuditState;
  resetSelection(): Phase0AuditState;
}

declare global {
  interface Window {
    __moldeonPhase0?: Phase0AuditBridge;
  }
}

export async function installPhase0AuditBridge(): Promise<void> {
  if (!import.meta.env.DEV || window.__moldeonPhase0) return;

  const [{ useEditorStore }, fixtures, engine, assemblyModule] = await Promise.all([
    import("../state/editorStore"),
    import("../testFixtures/baselineGarments"),
    import("../core/fallbackPatternEngine"),
    import("../garment3d/ResolvedGarmentAssembly"),
  ]);

  const state = (): Phase0AuditState => {
    const current = useEditorStore.getState();
    return {
      garmentId: current.garment.id,
      templateId: current.garment.templateId,
      activePieceId: current.activePieceId,
      pieceSelectionActive: current.pieceSelectionActive,
      selectedPieceIds: [...current.selectedPieceIds],
      selectedPointId: current.selectedPointId,
      selectedEdgeId: current.selectedEdgeId,
      selectedSeamId: current.selectedSeamId,
      seamCount: current.garment.seams?.length ?? 0,
      seams: (current.garment.seams ?? []).map((seam) => ({
        id: seam.id,
        name: seam.name ?? seam.id,
        direction: seam.direction,
        active: seam.active !== false,
      })),
      simulateVersion: current.simulateVersion,
      pieces: current.garment.pieces.map((piece) => {
        const workspace = current.garment.workspaceStates?.find(
          (candidate) => candidate.pieceId === piece.id,
        );
        const legacyTransform = current.garment.workspaceTransforms?.find(
          (candidate) => candidate.pieceId === piece.id,
        );
        const transform = workspace?.transform ?? legacyTransform ?? {
          pieceId: piece.id,
          xMm: 0,
          yMm: 0,
          rotationDeg: 0,
        };

        return {
          id: piece.id,
          name: piece.name,
          pointCount: piece.points.length,
          dartCount: piece.darts?.length ?? 0,
          cutQuantity: piece.cutQuantity ?? 1,
          cutOnFold: piece.cutOnFold === true,
          visible: workspace?.visible ?? true,
          locked: workspace?.locked ?? false,
          xMm: transform.xMm,
          yMm: transform.yMm,
          rotationDeg: transform.rotationDeg,
          roles: piece.segments?.map((segment) => segment.role) ?? [],
        };
      }),
    };
  };

  const assembly = (): Phase0AssemblySummary => {
    const current = useEditorStore.getState();
    const snapshots = current.garment.pieces.map(engine.createPatternSnapshot);
    const built = assemblyModule.buildResolvedGarmentAssembly(
      snapshots,
      current.garment,
    );

    return {
      invalid: built.invalid,
      warningCount: built.warnings.length,
      warnings: [...built.warnings],
      particleCount: built.positions.length / 3,
      instanceCount: built.instances.length,
      triangleCount: built.instances.reduce(
        (total, instance) => total + instance.topology.triangles.length / 3,
        0,
      ),
      structuralConstraintCount: built.structuralConstraints.length,
      stitchConstraintCount: built.stitchConstraints.length,
      anchorConstraintCount: built.anchorConstraints.length,
      instances: built.instances.map((instance) => ({
        id: instance.id,
        pieceId: instance.pieceId,
        bodySide: instance.placement.bodySide,
        surface: instance.placement.surface,
        vertexCount: instance.vertexCount,
        triangleCount: instance.topology.triangles.length / 3,
      })),
    };
  };

  window.__moldeonPhase0 = {
    fixtureIds: fixtures.BASELINE_FIXTURE_IDS,
    loadFixture(id) {
      useEditorStore.getState().loadGarment(fixtures.createBaselineFixture(id));
      return state();
    },
    state,
    assembly,
    movePiece(pieceId, xMm, yMm) {
      useEditorStore.getState().movePieceInWorkspace(pieceId, xMm, yMm);
      return state();
    },
    resetSelection() {
      useEditorStore.getState().clearSelection();
      return state();
    },
  };
}
