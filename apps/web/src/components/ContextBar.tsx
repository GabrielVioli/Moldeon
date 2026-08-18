import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorTool } from "../editor/PatternCanvas";
import {
  edgeLength,
  isInternalPath,
  type InternalPathPurpose,
} from "../domain/pattern";
import { useEditorStore } from "../state/editorStore";
import { useInternalPathEditorStore } from "../state/internalPathEditorStore";
import { CutRegionPreview } from "./CutRegionPreview";
import { ModelingOperationsControls } from "./ModelingOperationsControls";
import "../modelingOperations.css";

const PURPOSES: Array<{ value: InternalPathPurpose; label: string }> = [
  { value: "reference", label: "Referência" },
  { value: "fold", label: "Dobra" },
  { value: "marking", label: "Marcação" },
  { value: "cut", label: "Corte" },
  { value: "cut-and-sew", label: "Corte e costura" },
  { value: "dart", label: "Pence" },
];

export function ContextBar({ tool, onDone }: { tool: EditorTool; onDone(): void }) {
  const garment = useEditorStore((state) => state.garment);
  const seam = useEditorStore((state) => state.seamProposal);
  const seamIssues = useEditorStore((state) => state.seamIssues);
  const seamDraft = useEditorStore((state) => state.seamDraft);
  const seamFirstEdge = useEditorStore((state) => state.seamFirstEdge);
  const nearbySeam = useEditorStore((state) => state.nearbySeamSuggestion);
  const selectedDartId = useEditorStore((state) => state.selectedDartId);
  const selectedEdgeId = useEditorStore((state) => state.selectedEdgeId);
  const measure = useEditorStore((state) => state.measureDraft);
  const selected = useEditorStore((state) => state.selectedPieceIds);
  const confirmSeam = useEditorStore((state) => state.confirmSeamProposal);
  const proposeSeam = useEditorStore((state) => state.proposeSeam);
  const finishSeamDraftSide = useEditorStore((state) => state.finishSeamDraftSide);
  const reviewSeamDraft = useEditorStore((state) => state.reviewSeamDraft);
  const updateDart = useEditorStore((state) => state.updateDart);
  const removeDart = useEditorStore((state) => state.removeDart);
  const invertDart = useEditorStore((state) => state.invertDart);
  const convertSegment = useEditorStore((state) => state.convertSelectedSegment);
  const splitSegment = useEditorStore((state) => state.splitSelectedSegment);
  const cancel = useEditorStore((state) => state.cancelIntent);
  const deleteSelected = useEditorStore((state) => state.deleteSelectedPieces);
  const rotateSelected = useEditorStore((state) => state.rotateSelectedPieces);

  const draftPathId = useInternalPathEditorStore((state) => state.draftPathId);
  const selectedPathId = useInternalPathEditorStore((state) => state.selectedPathId);
  const selectedPathSegmentId = useInternalPathEditorStore((state) => state.selectedSegmentId);
  const pathAnalysis = useInternalPathEditorStore((state) => state.analysis);
  const multiCutAnalysis = useInternalPathEditorStore((state) => state.multiCutAnalysis);
  const confirmPath = useInternalPathEditorStore((state) => state.confirmDraft);
  const cancelPath = useInternalPathEditorStore((state) => state.cancelDraft);
  const selectPath = useInternalPathEditorStore((state) => state.selectPath);
  const setPathPurpose = useInternalPathEditorStore((state) => state.setPurpose);
  const setPathSegmentKind = useInternalPathEditorStore((state) => state.setSelectedSegmentKind);
  const applyPath = useInternalPathEditorStore((state) => state.applySelectedPath);
  const togglePathVisibility = useInternalPathEditorStore((state) => state.toggleVisibility);
  const togglePathLocked = useInternalPathEditorStore((state) => state.toggleLocked);
  const deletePath = useInternalPathEditorStore((state) => state.deleteSelectedPath);

  const internalPaths = garment.pieces
    .flatMap((piece) => piece.internalLines ?? [])
    .filter(isInternalPath);
  const selectedPath = selectedPathId
    ? internalPaths.find((line) => line.id === selectedPathId)
    : undefined;
  const draftPath = draftPathId
    ? internalPaths.find((line) => line.id === draftPathId)
    : undefined;
  const selectedPathPiece = selectedPath
    ? garment.pieces.find((piece) => piece.id === selectedPath.pieceId)
    : undefined;
  const selectedPathSegment = selectedPath?.segments.find((segment) => segment.id === selectedPathSegmentId)
    ?? selectedPath?.segments[0];
  const lengthCm = measure ? Math.hypot(measure.end.xMm - measure.start.xMm, measure.end.yMm - measure.start.yMm) / 10 : 0;
  const selectedDart = selectedDartId ? garment.pieces.flatMap((piece) => piece.darts ?? []).find((candidate) => candidate.id === selectedDartId) : undefined;
  const selectedSegment = selectedEdgeId
    ? garment.pieces.flatMap((piece) => (piece.segments ?? []).map((segment) => ({ piece, segment }))).find(({ segment }) => segment.id === selectedEdgeId)
    : undefined;
  const effectiveCutAnalysis = multiCutAnalysis ?? pathAnalysis;
  const cutTargetCount = multiCutAnalysis?.targetPieceIds.length ?? 0;
  const hasContext = Boolean(seam || seamDraft || seamFirstEdge || nearbySeam || seamIssues.length > 0 || draftPath || selectedPath || measure || selectedDart || selectedSegment || (tool === "select" && selected.length > 0));
  const showModelingControls = tool === "select"
    && !draftPath
    && !selectedPath
    && !selectedDart
    && !selectedSegment
    && !seam
    && !seamDraft
    && !seamFirstEdge
    && !measure;
  const [dismissed, setDismissed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);

  const closePanel = useCallback(() => {
    const editor = useEditorStore.getState();
    const pathState = useInternalPathEditorStore.getState();
    closingRef.current = Boolean(
      editor.seamProposal
      || editor.seamDraft
      || editor.seamFirstEdge
      || editor.nearbySeamSuggestion
      || editor.measureDraft
      || pathState.draftPathId,
    );
    cancel();
    if (pathState.draftPathId) pathState.cancelDraft();
    setDismissed(true);
  }, [cancel]);
  const finishOperation = useCallback(() => {
    cancel();
    selectPath(null);
    onDone();
  }, [cancel, onDone, selectPath]);

  useEffect(() => {
    if (closingRef.current) {
      closingRef.current = false;
      return;
    }
    setDismissed(false);
  }, [tool, selected, selectedPathId, selectedDartId, selectedEdgeId, seam, seamDraft, seamFirstEdge, nearbySeam, measure, pathAnalysis]);

  useEffect(() => {
    if (!hasContext || dismissed) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closePanel();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (
        !draftPath
        && tool !== "seam"
        && !seamFirstEdge
        && !seam
        && event.target instanceof Element
        && event.target.closest(".canvas-stack")
        && !panelRef.current?.contains(event.target)
      ) closePanel();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [closePanel, dismissed, draftPath, hasContext, seam, seamDraft, seamFirstEdge, tool]);

  const confirmCurrentSeam = () => {
    if (!seam) return;
    confirmSeam({ name: "Costura", direction: seam.compatibility.recommendedDirection, treatment: seam.compatibility.recommendedTreatment });
    if (!useEditorStore.getState().seamProposal && useEditorStore.getState().seamIssues.length === 0) finishOperation();
  };

  if (dismissed) return null;

  if (!hasContext) {
    const hint = tool === "seam"
      ? "Clique nas bordas do lado A da costura."
      : tool === "cut"
        ? selected.length > 1
          ? "Clique e arraste uma linha atravessando as peças selecionadas. O Moldeon calcula as interseções ao soltar; Escape cancela."
          : "Clique e arraste de borda a borda, ou clique para criar nós internos. Enter confirma, Backspace volta e Escape cancela."
        : tool === "dart"
          ? "Desenhe os três pontos do V. Enter confirma e Escape cancela."
          : tool === "measure"
            ? "Clique em dois pontos para medir."
            : null;
    return hint ? <div ref={panelRef} className="context-bar"><span>{hint}</span><button type="button" onClick={finishOperation}>Cancelar</button></div> : null;
  }

  return (
    <div ref={panelRef} className="context-bar" role="region" aria-label="Concluir ação">
      {nearbySeam && !seam ? <>
        <span><strong>Bordas próximas</strong> · deseja costurá-las?</span>
        <button className="primary-button" onClick={() => proposeSeam(nearbySeam.first, nearbySeam.second)}>Costurar</button>
      </> : null}
      {seamDraft && !seam ? <>
        <span>
          <strong>{seamDraft.activeSide === "first" ? "Lado A" : "Lado B"}</strong>
          {" · "}{seamDraft[seamDraft.activeSide].length} borda(s) selecionada(s) em ordem.
          {seamDraft.activeSide === "first"
            ? " Selecione todas as bordas deste lado."
            : " Selecione todas as bordas correspondentes."}
        </span>
        {seamDraft.activeSide === "first" ? (
          <button className="primary-button" type="button" disabled={seamDraft.first.length === 0} onClick={finishSeamDraftSide}>Concluir lado A</button>
        ) : (
          <button className="primary-button" type="button" disabled={seamDraft.second.length === 0} onClick={reviewSeamDraft}>Revisar costura</button>
        )}
      </> : null}
      {seamIssues.length > 0 ? <span className="context-error" role="alert"><strong>Não foi possível concluir:</strong> {seamIssues.map((issue) => issue.message).join(" ")}</span> : null}
      {seam ? <>
        <span><strong>Revisar costura</strong> · {(seam.compatibility.firstLengthMm / 10).toFixed(1)} cm × {(seam.compatibility.secondLengthMm / 10).toFixed(1)} cm · diferença {seam.compatibility.differenceMm.toFixed(1)} mm{seam.compatibility.compatible ? "" : " (confirme apenas se for intencional)"}</span>
        <button type="button" onClick={() => proposeSeam(seam.secondRanges ?? [seam.second], seam.firstRanges ?? [seam.first])}>Inverter lado</button>
        <button type="button" className="primary-button" onClick={confirmCurrentSeam}>Confirmar costura</button>
      </> : null}

      {draftPath ? <>
        <span><strong>{draftPath.purpose === "dart" ? "Desenhando pence" : "Desenhando caminho"}</strong> · {Math.max(1, draftPath.nodes.length - 1)} nó(s) fixos</span>
        <span className="context-shortcuts">Enter confirma · Backspace volta · Escape cancela</span>
        <button type="button" className="primary-button" disabled={draftPath.nodes.length < (draftPath.purpose === "dart" ? 4 : 3)} onClick={() => confirmPath()}>Concluir caminho</button>
        <button type="button" onClick={() => { cancelPath(); onDone(); }}>Cancelar desenho</button>
      </> : null}

      {selectedPath && !draftPath ? <>
        <span><strong>Caminho interno</strong> · {selectedPath.nodes.length} nós · {selectedPath.segments.length} segmento(s)</span>
        <label>Finalidade
          <select aria-label="Finalidade do caminho interno" value={selectedPath.purpose} onChange={(event) => setPathPurpose(event.currentTarget.value as InternalPathPurpose)}>
            {PURPOSES.map((purpose) => <option key={purpose.value} value={purpose.value}>{purpose.label}</option>)}
          </select>
        </label>
        {selectedPathSegment ? <button onClick={() => setPathSegmentKind(selectedPathSegment.kind === "cubic" ? "line" : "cubic")}>Converter segmento para {selectedPathSegment.kind === "cubic" ? "reta" : "curva"}</button> : null}
        <button onClick={togglePathVisibility}>{selectedPath.visible ? "Ocultar" : "Mostrar"}</button>
        <button onClick={togglePathLocked}>{selectedPath.locked ? "Desbloquear" : "Bloquear"}</button>
        {selectedPathPiece && !multiCutAnalysis && (selectedPath.purpose === "cut" || selectedPath.purpose === "cut-and-sew") ? (
          <CutRegionPreview piece={selectedPathPiece} path={selectedPath} analysis={pathAnalysis} />
        ) : null}
        {multiCutAnalysis && cutTargetCount > 0 ? (
          <span className="context-diagnostic" role="status">
            <strong>{cutTargetCount === 1 ? "1 peça atravessada." : `${cutTargetCount} peças atravessadas.`}</strong> Um único confirmar aplicará o corte a todas elas.
          </span>
        ) : null}
        {effectiveCutAnalysis?.diagnostics.map((diagnostic) => (
          <span key={`${diagnostic.code}:${diagnostic.message}`} className={diagnostic.severity === "error" ? "context-error" : "context-diagnostic"} role={diagnostic.severity === "error" ? "alert" : "status"}>
            {diagnostic.message}
          </span>
        ))}
        {selectedPath.purpose === "cut" ? <button type="button" className="primary-button" disabled={!effectiveCutAnalysis?.valid} onClick={() => { if (applyPath(false)) finishOperation(); }}>{multiCutAnalysis ? `Aplicar corte em ${cutTargetCount} ${cutTargetCount === 1 ? "peça" : "peças"}` : "Aplicar corte"}</button> : null}
        {selectedPath.purpose === "cut-and-sew" ? <button type="button" className="primary-button" disabled={!effectiveCutAnalysis?.valid} onClick={() => { if (applyPath(true)) finishOperation(); }}>{multiCutAnalysis ? `Cortar ${cutTargetCount} ${cutTargetCount === 1 ? "peça" : "peças"} e manter costuradas` : "Cortar e manter costurado"}</button> : null}
        {selectedPath.purpose === "dart" ? <button type="button" className="primary-button" disabled={!pathAnalysis?.valid} onClick={() => { if (applyPath(false)) finishOperation(); }}>Fechar pence</button> : null}
        <button onClick={deletePath}>Excluir caminho</button>
      </> : null}

      {selectedDart ? <>
        <span><strong>Pence estrutural selecionada</strong></span>
        <label>Largura <input aria-label="Largura da pence" type="number" step="0.1" value={Number(selectedDart.widthMm.toFixed(1))} onChange={(event) => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value) && value > 0) updateDart(selectedDart.id, { widthMm: value }); }} /> mm</label>
        <label>Profundidade <input aria-label="Profundidade da pence" type="number" step="0.1" value={Number(selectedDart.lengthMm.toFixed(1))} onChange={(event) => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value) && value > 0) updateDart(selectedDart.id, { lengthMm: value }); }} /> mm</label>
        <label>Direção <input aria-label="Direção da pence" type="number" step="1" value={Math.round(selectedDart.directionDeg)} onChange={(event) => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) updateDart(selectedDart.id, { directionDeg: value }); }} />°</label>
        <button onClick={() => invertDart(selectedDart.id)}>Inverter</button>
        <button onClick={() => removeDart(selectedDart.id)}>Excluir</button>
      </> : null}
      {selectedSegment ? <>
        <span><strong>Segmento</strong> · {(edgeLength(selectedSegment.piece, selectedSegment.segment.id) / 10).toFixed(1)} cm · {selectedSegment.segment.kind === "cubic" ? "curva" : "reta"}</span>
        <button onClick={() => convertSegment(selectedSegment.segment.kind === "cubic" ? "line" : "cubic")}>Converter para {selectedSegment.segment.kind === "cubic" ? "reta" : "curva"}</button>
        <button onClick={splitSegment}>Dividir segmento</button>
      </> : null}
      {measure ? <span><strong>Medida:</strong> {lengthCm.toFixed(1)} cm</span> : null}

      {showModelingControls ? <ModelingOperationsControls /> : null}
      {selected.length > 1 && tool === "select" ? <>
        <button onClick={() => rotateSelected(90)}>Girar seleção 90°</button>
        <button onClick={deleteSelected}>Excluir desbloqueadas</button>
      </> : null}
      {!draftPath ? <button type="button" onClick={closePanel}>Fechar</button> : null}
    </div>
  );
}
