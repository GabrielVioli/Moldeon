import { useState } from "react";
import { useEditorStore } from "../state/editorStore";
import { useModelingOperationsStore } from "../state/modelingOperationsStore";
import type { PleatSense } from "../domain/modelingOperations";

export function ModelingOperationsControls() {
  const selected = useEditorStore((state) => state.selectedPieceIds);
  const diagnostics = useModelingOperationsStore((state) => state.diagnostics);
  const duplicate = useModelingOperationsStore((state) => state.duplicate);
  const align = useModelingOperationsStore((state) => state.align);
  const distribute = useModelingOperationsStore((state) => state.distribute);
  const join = useModelingOperationsStore((state) => state.join);
  const createPleat = useModelingOperationsStore((state) => state.createPleat);
  const [pleatDepth, setPleatDepth] = useState(30);
  const [pleatDirection, setPleatDirection] = useState(90);
  const [pleatSense, setPleatSense] = useState<PleatSense>("inward");

  if (selected.length === 0) return null;

  return (
    <>
      <span><strong>Operações de modelagem</strong> · {selected.length} peça(s)</span>
      <button type="button" onClick={() => duplicate()}>Duplicar</button>
      <button
        type="button"
        title="Espelhar em torno do eixo vertical da peça"
        onClick={() => duplicate("horizontal")}
      >
        Espelhar no eixo vertical
      </button>
      <button
        type="button"
        title="Espelhar em torno do eixo horizontal da peça"
        onClick={() => duplicate("vertical")}
      >
        Espelhar no eixo horizontal
      </button>

      {selected.length >= 2 ? <>
        <button type="button" onClick={() => align("left")}>Alinhar esquerda</button>
        <button type="button" onClick={() => align("right")}>Alinhar direita</button>
        <button type="button" onClick={() => align("top")}>Alinhar topo</button>
        <button type="button" onClick={() => align("bottom")}>Alinhar base</button>
        <button type="button" onClick={() => align("center-x")}>Centralizar X</button>
        <button type="button" onClick={() => align("center-y")}>Centralizar Y</button>
      </> : null}

      {selected.length >= 3 ? <>
        <button type="button" onClick={() => distribute("horizontal")}>Distribuir horizontal</button>
        <button type="button" onClick={() => distribute("vertical")}>Distribuir vertical</button>
      </> : null}

      {selected.length === 2 ? (
        <button type="button" className="primary-button" onClick={() => join()}>Unir bordas coincidentes</button>
      ) : null}

      {selected.length === 1 ? <>
        <label>Profundidade da prega
          <input
            aria-label="Profundidade da prega"
            type="number"
            min="1"
            step="1"
            value={pleatDepth}
            onChange={(event) => setPleatDepth(event.currentTarget.valueAsNumber)}
          /> mm
        </label>
        <label>Direção da prega
          <input
            aria-label="Direção da prega"
            type="number"
            step="1"
            value={pleatDirection}
            onChange={(event) => setPleatDirection(event.currentTarget.valueAsNumber)}
          />°
        </label>
        <label>Sentido da prega
          <select
            aria-label="Sentido da prega"
            value={pleatSense}
            onChange={(event) => setPleatSense(event.currentTarget.value as PleatSense)}
          >
            <option value="inward">Para dentro</option>
            <option value="outward">Para fora</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => createPleat({ depthMm: pleatDepth, directionDeg: pleatDirection, sense: pleatSense })}
        >
          Criar prega simples
        </button>
      </> : null}

      {diagnostics.map((message, index) => (
        <span key={`${index}:${message}`} className="context-diagnostic" role="status">{message}</span>
      ))}
    </>
  );
}