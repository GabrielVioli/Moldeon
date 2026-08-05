import type {
  BaselineFixtureId,
} from "../testFixtures/baselineGarments";

export interface Phase0AuditState {
  garmentId: string;
  templateId: string;
  activePieceId: string;
  pieceSelectionActive: boolean;
  selectedPieceIds: string[];
  selectedPointId: string | null;
  selectedEdgeId: string | null;
  seamCount: number;
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

export interface Phase0AuditBridge {
  fixtureIds: readonly BaselineFixtureId[];
  loadFixture(id: BaselineFixtureId): Phase0AuditState;
  state(): Phase0AuditState;
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

  const [{ useEditorStore }, fixtures] = await Promise.all([
    import("../state/editorStore"),
    import("../testFixtures/baselineGarments"),
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
      seamCount: current.garment.seams?.length ?? 0,
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

  window.__moldeonPhase0 = {
    fixtureIds: fixtures.BASELINE_FIXTURE_IDS,
    loadFixture(id) {
      useEditorStore.getState().loadGarment(fixtures.createBaselineFixture(id));
      return state();
    },
    state,
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
