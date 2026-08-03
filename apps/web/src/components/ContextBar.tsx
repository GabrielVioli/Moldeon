import type { EditorTool } from "../editor/PatternCanvas";
import { edgeLength } from "../domain/pattern";
import { classifyCutIntersections, extendCutLine } from "../domain/patternOperations";
import { useEditorStore } from "../state/editorStore";

export function ContextBar({ tool, onDone }: { tool: EditorTool; onDone(): void }) {
  const garment = useEditorStore((state) => state.garment);
  const seam = useEditorStore((state) => state.seamProposal);
  const seamFirstEdge = useEditorStore((state) => state.seamFirstEdge);
  const nearbySeam = useEditorStore((state) => state.nearbySeamSuggestion);
  const cut = useEditorStore((state) => state.cutDraft);
  const dart = useEditorStore((state) => state.dartDraft);
  const selectedDartId = useEditorStore((state) => state.selectedDartId);
  const selectedEdgeId = useEditorStore((state) => state.selectedEdgeId);
  const measure = useEditorStore((state) => state.measureDraft);
  const selected = useEditorStore((state) => state.selectedPieceIds);
  const confirmSeam = useEditorStore((state) => state.confirmSeamProposal);
  const proposeSeam = useEditorStore((state) => state.proposeSeam);
  const confirmCut = useEditorStore((state) => state.confirmCut);
  const confirmDart = useEditorStore((state) => state.confirmDart);
  const updateDart = useEditorStore((state) => state.updateDart);
  const removeDart = useEditorStore((state) => state.removeDart);
  const invertDart = useEditorStore((state) => state.invertDart);
  const convertSegment = useEditorStore((state) => state.convertSelectedSegment);
  const splitSegment = useEditorStore((state) => state.splitSelectedSegment);
  const cancel = useEditorStore((state) => state.cancelIntent);
  const deleteSelected = useEditorStore((state) => state.deleteSelectedPieces);
  const rotateSelected = useEditorStore((state) => state.rotateSelectedPieces);
  const duplicateSelected = useEditorStore((state) => state.duplicateSelectedPieces);

  const cutPiece = cut && garment.pieces.find((piece) => piece.id === cut.pieceId);
  const cutKind = cutPiece && classifyCutIntersections(cutPiece, extendCutLine(cutPiece, [cut.start, cut.end])).kind;
  const lengthCm = measure ? Math.hypot(measure.end.xMm - measure.start.xMm, measure.end.yMm - measure.start.yMm) / 10 : 0;
  const selectedDart = selectedDartId ? garment.pieces.flatMap((piece) => piece.darts ?? []).find((candidate) => candidate.id === selectedDartId) : undefined;
  const selectedSegment = selectedEdgeId
    ? garment.pieces.flatMap((piece) => (piece.segments ?? []).map((segment) => ({ piece, segment }))).find(({ segment }) => segment.id === selectedEdgeId)
    : undefined;
  const finish = () => { cancel(); onDone(); };
  const hasContext = seam || seamFirstEdge || nearbySeam || cut || dart || measure || selectedDart || selectedSegment || selected.length > 1;

  if (!hasContext) {
    const hint = tool === "seam" ? "Clique na primeira borda e depois na segunda." : tool === "cut" ? "Trace uma linha atravessando a peça." : tool === "dart" ? "Clique na borda e depois no ápice da pence." : tool === "measure" ? "Clique em dois pontos para medir." : null;
    return hint ? <div className="context-bar"><span>{hint}</span><button onClick={finish}>Cancelar</button></div> : null;
  }

  return (
    <div className="context-bar" role="region" aria-label="Concluir ação">
      {nearbySeam && !seam ? <>
        <span><strong>Bordas próximas</strong> · deseja costurá-las?</span>
        <button className="primary-button" onClick={() => proposeSeam(nearbySeam.first, nearbySeam.second)}>Costurar</button>
      </> : null}
      {seamFirstEdge && !seam ? <span><strong>Primeira borda escolhida.</strong> Agora escolha a borda correspondente.</span> : null}
      {seam ? <>
        <span><strong>Revisar costura</strong> · {(seam.compatibility.firstLengthMm / 10).toFixed(1)} cm × {(seam.compatibility.secondLengthMm / 10).toFixed(1)} cm · diferença {seam.compatibility.differenceMm.toFixed(1)} mm{seam.compatibility.compatible ? "" : " (confirme apenas se for intencional)"}</span>
        <button onClick={() => proposeSeam(seam.second, seam.first)}>Inverter lado</button>
        <button className="primary-button" onClick={() => { confirmSeam({ name: "Costura", direction: seam.compatibility.recommendedDirection, treatment: seam.compatibility.recommendedTreatment }); onDone(); }}>Confirmar costura</button>
      </> : null}
      {cut ? <>
        <span><strong>Recorte</strong> · {cut.phase === "placing" ? "agora escolha o segundo ponto" : cut.error ?? (cutKind === "valid" ? "pronto para cortar" : "a linha precisa atravessar a peça duas vezes")}</span>
        {cut.phase === "ready" ? <>
          <button disabled={cutKind !== "valid"} onClick={() => { confirmCut(false); onDone(); }}>Recortar</button>
          <button className="primary-button" disabled={cutKind !== "valid"} onClick={() => { confirmCut(true); onDone(); }}>Recortar e manter unidas</button>
        </> : null}
      </> : null}
      {dart ? <>
        <span><strong>Pence</strong> · {dart.phase === "placing" ? "agora escolha o ápice" : `${(Math.hypot(dart.apex.xMm - dart.edgePoint.xMm, dart.apex.yMm - dart.edgePoint.yMm) / 10).toFixed(1)} cm`}</span>
        {dart.phase === "ready" ? <button className="primary-button" onClick={() => { confirmDart(); onDone(); }}>Criar pence</button> : null}
      </> : null}
      {selectedDart ? <>
        <span><strong>Pence selecionada</strong></span>
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
      <button onClick={finish}>Cancelar</button>
    </div>
  );
}
