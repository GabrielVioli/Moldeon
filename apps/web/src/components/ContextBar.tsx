import type { EditorTool } from "../editor/PatternCanvas";
import { classifyCutIntersections, extendCutLine } from "../domain/patternOperations";
import { useEditorStore } from "../state/editorStore";

export function ContextBar({ tool, onDone }: { tool: EditorTool; onDone(): void }) {
  const garment = useEditorStore((state) => state.garment);
  const seam = useEditorStore((state) => state.seamProposal);
  const cut = useEditorStore((state) => state.cutDraft);
  const dart = useEditorStore((state) => state.dartDraft);
  const measure = useEditorStore((state) => state.measureDraft);
  const selected = useEditorStore((state) => state.selectedPieceIds);
  const confirmSeam = useEditorStore((state) => state.confirmSeamProposal);
  const proposeSeam = useEditorStore((state) => state.proposeSeam);
  const confirmCut = useEditorStore((state) => state.confirmCut);
  const confirmDart = useEditorStore((state) => state.confirmDart);
  const cancel = useEditorStore((state) => state.cancelIntent);
  const deleteSelected = useEditorStore((state) => state.deleteSelectedPieces);
  const rotateSelected = useEditorStore((state) => state.rotateSelectedPieces);
  const duplicateSelected = useEditorStore((state) => state.duplicateSelectedPieces);
  const cutPiece = cut && garment.pieces.find((piece) => piece.id === cut.pieceId);
  const cutKind = cutPiece && classifyCutIntersections(cutPiece, extendCutLine(cutPiece, [cut.start, cut.end])).kind;
  const lengthCm = measure ? Math.hypot(measure.end.xMm - measure.start.xMm, measure.end.yMm - measure.start.yMm) / 10 : 0;
  const finish = () => { cancel(); onDone(); };

  if (!seam && !cut && !dart && !measure && selected.length < 2) {
    const hint = tool === "seam" ? "Clique na primeira borda e depois na segunda." : tool === "cut" ? "Trace uma linha atravessando a peça." : tool === "dart" ? "Clique na borda e depois no ápice da pence." : tool === "measure" ? "Clique em dois pontos para medir." : null;
    return hint ? <div className="context-bar"><span>{hint}</span><button onClick={finish}>Cancelar</button></div> : null;
  }
  return (
    <div className="context-bar" role="region" aria-label="Concluir ação">
      {seam ? <>
        <span><strong>Costura pronta para revisar</strong> · diferença {seam.compatibility.differenceMm.toFixed(1)} mm</span>
        <button onClick={() => proposeSeam(seam.second, seam.first)}>Trocar lados</button>
        <button className="primary-button" onClick={() => { confirmSeam({ name: "Costura", direction: "opposite", treatment: "standard" }); onDone(); }}>Criar costura</button>
      </> : null}
      {cut ? <>
        <span><strong>Recorte</strong> · {cutKind === "valid" ? "pronto para cortar" : "a linha precisa atravessar a peça duas vezes"}</span>
        <button disabled={cutKind !== "valid"} onClick={() => { confirmCut(false); onDone(); }}>Cortar</button>
        <button className="primary-button" disabled={cutKind !== "valid"} onClick={() => { confirmCut(true); onDone(); }}>Cortar e manter unidas</button>
      </> : null}
      {dart ? <>
        <span><strong>Pence</strong> · {(Math.hypot(dart.apex.xMm - dart.edgePoint.xMm, dart.apex.yMm - dart.edgePoint.yMm) / 10).toFixed(1)} cm</span>
        <button className="primary-button" onClick={() => { confirmDart(); onDone(); }}>Criar pence</button>
      </> : null}
      {measure ? <span><strong>Medida:</strong> {lengthCm.toFixed(1)} cm</span> : null}
      {selected.length > 1 ? <><span><strong>{selected.length} peças selecionadas</strong></span><button onClick={() => rotateSelected(90)}>Girar 90°</button><button onClick={() => duplicateSelected(false)}>Duplicar</button><button onClick={() => duplicateSelected(true)}>Espelhar</button><button onClick={deleteSelected}>Excluir desbloqueadas</button></> : null}
      <button onClick={finish}>Cancelar</button>
    </div>
  );
}
