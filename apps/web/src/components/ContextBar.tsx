import type { EditorTool } from "../editor/PatternCanvas";
import {
  edgeLength,
  isInternalPath,
  type InternalPathPurpose,
} from "../domain/pattern";
import { useEditorStore } from "../state/editorStore";
import { useInternalPathEditorStore } from "../state/internalPathEditorStore";

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
  const seamFirstEdge = useEditorStore((state) => state.seamFirstEdge);
  const nearbySeam = useEditorStore((state) => state.nearbySeamSuggestion);
  const selectedDartId = useEditorStore((state) => state.selectedDartId);
  const selectedEdgeId = useEditorStore((state) => state.selectedEdgeId);
  const measure = useEditorStore((state) => state.measureDraft);
  const selected = useEditorStore((state) => state.selectedPieceIds);
  const confirmSeam = useEditorStore((state) => state.confirmSeamProposal);
  const proposeSeam = useEditorStore((state) => state.proposeSeam);
  const updateDart = useEditorStore((state) => state.updateDart);
  const removeDart = useEditorStore((state) => state.removeDart);
  const invertDart = useEditorStore((state) => state.invertDart);
  const convertSegment = useEditorStore((state) => state.convertSelectedSegment);
  const splitSegment = useEditorStore((state) => state.splitSelectedSegment);
  const cancel = useEditorStore((state) => state.cancelIntent);
  const deleteSelected = useEditorStore((state) => state.deleteSelectedPieces);
  const rotateSelected = useEditorStore((state) => state.rotateSelectedPieces);
  const duplicateSelected = useEditorStore((state) => state.duplicateSelectedPieces);

  const draftPathId = useInternalPathEditorStore((state) => state.draftPathId);
  const selectedPathId = useInternalPathEditorStore((state) => state.selectedPathId);
  const selectedPathSegmentId = useInternalPathEditorStore((state) => state.selectedSegmentId);
  const pathAnalysis = useInternalPathEditorStore((state) => state.analysis);
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
  const selectedPathSegment = selectedPath?.segments.find((segment) => segment.id === selectedPathSegmentId)
    ?? selectedPath?.segments[0];
  const lengthCm = measure ? Math.hypot(measure.end.xMm - measure.start.xMm, measure.end.yMm - measure.start.yMm) / 10 : 0;
  const selectedDart = selectedDartId ? garment.pieces.flatMap((piece) => piece.darts ?? []).find((candidate) => candidate.id === selectedDartId) : undefined;
  const selectedSegment = selectedEdgeId
    ? garment.pieces.flatMap((piece) => (piece.segments ?? []).map((segment) => ({ piece, segment }))).find(({ segment }) => segment.id === selectedEdgeId)
    : undefined;
  const finish = () => { cancel(); selectPath(null); onDone(); };
  const hasContext = seam || seamFirstEdge || nearbySeam || seamIssues.length > 0 || draftPath || selectedPath || measure || selectedDart || selectedSegment || selected.length > 1;

  const confirmCurrentSeam = () => {
    if (!seam) return;
    confirmSeam({ name: "Costura", direction: seam.compatibility.recommendedDirection, treatment: seam.compatibility.recommendedTreatment });
    if (!useEditorStore.getState().seamProposal && useEditorStore.getState().seamIssues.length === 0) onDone();
  };

  if (!hasContext) {
    const hint = tool === "seam"
      ? "Clique na primeira borda e depois na segunda."
      : tool === "cut"
        ? "Clique para criar nós do caminho. Enter confirma, Backspace remove o último e Escape cancela."
        : tool === "dart"
          ? "Comece na borda, adicione o ápice e pressione Enter."
          : tool === "measure"
            ? "Clique em dois pontos para medir."
            : null;
    return hint ? <div className="context-bar"><span>{hint}</span><button onClick={finish}>Cancelar</button></div> : null;
  }

  return (
    <div className="context-bar" role="region" aria-label="Concluir ação">
      {nearbySeam && !seam ? <>
        <span><strong>Bordas próximas</strong> · deseja costurá-las?</span>
        <button className="primary-button" onClick={() => proposeSeam(nearbySeam.first, nearbySeam.second)}>Costurar</button>
      </> : null}
      {seamFirstEdge && !seam ? <span><strong>Primeira borda escolhida.</strong> Agora escolha a borda correspondente.</span> : null}
      {seamIssues.length > 0 ? <span className="context-error" role="alert"><strong>Não foi possível concluir:</strong> {seamIssues.map((issue) => issue.message).join(" ")}</span> : null}
      {seam ? <>
        <span><strong>Revisar costura</strong> · {(seam.compatibility.firstLengthMm / 10).toFixed(1)} cm × {(seam.compatibility.secondLengthMm / 10).toFixed(1)} cm · diferença {seam.compatibility.differenceMm.toFixed(1)} mm{seam.compatibility.compatible ? "" : " (confirme apenas se for intencional)"}</span>
        <button onClick={() => proposeSeam(seam.second, seam.first)}>Inverter lado</button>
        <button className="primary-button" onClick={confirmCurrentSeam}>Confirmar costura</button>
      </> : null}

      {draftPath ? <>
        <span><strong>{draftPath.purpose === "dart" ? "Desenhando pence" : "Desenhando caminho"}</strong> · {Math.max(1, draftPath.nodes.length - 1)} nó(s) fixos</span>
        <span className="context-shortcuts">Enter confirma · Backspace volta · Escape cancela</span>
        <button className="primary-button" disabled={draftPath.nodes.length < 3} onClick={() => confirmPath()}>Concluir caminho</button>
        <button onClick={() => { cancelPath(); onDone(); }}>Cancelar desenho</button>
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
        {pathAnalysis?.diagnostics.map((diagnostic) => (
          <span key={`${diagnostic.code}:${diagnostic.message}`} className={diagnostic.severity === "error" ? "context-error" : "context-diagnostic"} role={diagnostic.severity === "error" ? "alert" : "status"}>
            {diagnostic.message}
          </span>
        ))}
        {selectedPath.purpose === "cut" ? <button className="primary-button" disabled={!pathAnalysis?.valid} onClick={() => applyPath(false)}>Aplicar corte</button> : null}
        {selectedPath.purpose === "cut-and-sew" ? <button className="primary-button" disabled={!pathAnalysis?.valid} onClick={() => applyPath(true)}>Cortar e manter costurado</button> : null}
        {selectedPath.purpose === "dart" ? <button className="primary-button" disabled={!pathAnalysis?.valid} onClick={() => applyPath(false)}>Fechar pence</button> : null}
        <button onClick={deletePath}>Excluir caminho</button>
      </> : null}

      {selectedDart ? <>
        <span><strong>Pence estrutural selecionada</strong></span>
        <label>Largura <input aria-label="Largura da pence" type="number" min="1" step="1" value={Math.round(selectedDart.widthMm)} onChange={(event) => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) updateDart(selectedDart.id, { widthMm: value }); }} /> mm</label>
        <label>Profundidade <input aria-label="Profundidade da pence" type="number" min="1" step="1" value={Math.round(selectedDart.lengthMm)} onChange={(event) => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) updateDart(selectedDart.id, { lengthMm: value }); }} /> mm</label>
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
      {selected.length > 1 ? <><span><strong>{selected.length} peças selecionadas</strong></span><button onClick={() => rotateSelected(90)}>Girar 90°</button><button onClick={() => duplicateSelected(false)}>Duplicar</button><button onClick={() => duplicateSelected(true)}>Espelhar</button><button onClick={deleteSelected}>Excluir desbloqueadas</button></> : null}
      {!draftPath ? <button onClick={finish}>Fechar</button> : null}
    </div>
  );
}
