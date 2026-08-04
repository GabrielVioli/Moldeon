import {
  memo,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  GarmentDraft,
  PatternSnapshot,
  PreviewRegion,
} from "../domain/pattern";

import { ThreeViewport } from "./ThreeViewport";

interface GarmentViewportProps {
  garment: GarmentDraft;
  snapshots: PatternSnapshot[];
  simulateVersion: number;
  active: boolean;
  onBackendChange(
    backend: "webgpu" | "webgl2",
  ): void;
  onPieceDrop?(
    pieceId: string,
    region: PreviewRegion,
  ): void;
  showBody: boolean;

  /**
   * Mantido por compatibilidade com os componentes que chamam
   * GarmentViewport.
   *
   * Ele não é mais usado para esconder peças do preview 3D.
   */
  connectedPieceIds: string[];
}

export const GarmentViewport = memo(
  function GarmentViewport({
    garment,
    snapshots,
    simulateVersion,
    active,
    onBackendChange,
    onPieceDrop,
    showBody,
  }: GarmentViewportProps) {
    const hostRef =
      useRef<HTMLDivElement>(null);

    const viewportRef =
      useRef<ThreeViewport | null>(null);

    const latestSnapshotsRef =
      useRef(snapshots);

    const latestGarmentRef =
      useRef(garment);

    const latestActiveRef =
      useRef(active);

    const latestSimulateVersionRef =
      useRef(simulateVersion);

    const latestShowBodyRef =
      useRef(showBody);

    const lastDressedVersionRef =
      useRef(0);

    const updateFrameRef =
      useRef<number | null>(null);

    const [error, setError] =
      useState<string | null>(null);

    const [warnings, setWarnings] =
      useState<string[]>([]);

    const [
      draggingPiece,
      setDraggingPiece,
    ] = useState(false);

    const [
      inspectionMode,
      setInspectionMode,
    ] = useState<
      "mounted" | "exploded"
    >("mounted");

    /*
     * Mantém os valores mais recentes disponíveis para callbacks
     * assíncronos sem recriar o viewport.
     */
    latestSnapshotsRef.current =
      snapshots;

    latestGarmentRef.current =
      garment;

    latestActiveRef.current =
      active;

    latestSimulateVersionRef.current =
      simulateVersion;

    latestShowBodyRef.current =
      showBody;

    /*
     * Inicialização única do ThreeViewport.
     */
    useEffect(() => {
      const host = hostRef.current;

      if (!host) {
        return;
      }

      let mounted = true;

      const abortController =
        new AbortController();

      setError(null);

      void ThreeViewport.create(
        host,
        abortController.signal,
      )
        .then((viewport) => {
          if (!mounted) {
            viewport.dispose();
            return;
          }

          viewportRef.current =
            viewport;

          onBackendChange(
            viewport.backend,
          );

          viewport.setBodyVisible(
            latestShowBodyRef.current,
          );

          /*
           * Todas as peças são enviadas ao viewport.
           *
           * Peças desconectadas continuam visíveis e podem ser
           * exibidas separadamente no modo explodido.
           */
          if (
            latestActiveRef.current
          ) {
            const nextWarnings =
              viewport.updateGarment(
                latestSnapshotsRef.current,
                latestGarmentRef.current,
              );

            setWarnings(nextWarnings);
          }

          if (
            latestActiveRef.current &&
            latestSimulateVersionRef.current >
              0
          ) {
            viewport.dress();

            lastDressedVersionRef.current =
              latestSimulateVersionRef.current;
          }
        })
        .catch(
          (reason: unknown) => {
            if (!mounted) {
              return;
            }

            if (
              reason instanceof
                DOMException &&
              reason.name ===
                "AbortError"
            ) {
              return;
            }

            console.error(reason);

            setError(
              "Não foi possível iniciar o viewport 3D neste navegador.",
            );
          },
        );

      return () => {
        mounted = false;

        abortController.abort();

        if (
          updateFrameRef.current !==
          null
        ) {
          window.cancelAnimationFrame(
            updateFrameRef.current,
          );

          updateFrameRef.current =
            null;
        }

        viewportRef.current?.dispose();
        viewportRef.current = null;
      };
    }, [onBackendChange]);

    /*
     * Mostra ou esconde o manequim sem reconstruir o viewport.
     */
    useEffect(() => {
      viewportRef.current?.setBodyVisible(
        showBody,
      );
    }, [showBody]);

    /*
     * Alterna apenas a organização visual dos painéis.
     */
    useEffect(() => {
      viewportRef.current?.setExploded(
        inspectionMode === "exploded",
      );
    }, [inspectionMode]);

    /*
     * Atualiza a geometria quando o molde ou a roupa mudam.
     *
     * A atualização é agrupada em requestAnimationFrame para evitar
     * várias reconstruções dentro do mesmo frame.
     */
    useEffect(() => {
      if (!active) {
        return;
      }

      if (
        updateFrameRef.current !==
        null
      ) {
        return;
      }

      updateFrameRef.current =
        window.requestAnimationFrame(
          () => {
            updateFrameRef.current =
              null;

            const viewport =
              viewportRef.current;

            if (!viewport) {
              return;
            }

            /*
             * Não filtramos por connectedPieceIds.
             *
             * Frente, costas, mangas, gola, cós e peças ainda
             * desconectadas precisam continuar visíveis.
             */
            const nextWarnings =
              viewport.updateGarment(
                latestSnapshotsRef.current,
                latestGarmentRef.current,
              );

            setWarnings(nextWarnings);
          },
        );

      return () => {
        if (
          updateFrameRef.current !==
          null
        ) {
          window.cancelAnimationFrame(
            updateFrameRef.current,
          );

          updateFrameRef.current =
            null;
        }
      };
    }, [
      active,
      garment,
      snapshots,
      showBody,
    ]);

    /*
     * Inicia novamente a animação de montagem quando o usuário
     * solicita uma nova simulação.
     */
    useEffect(() => {
      if (
        simulateVersion <=
          lastDressedVersionRef.current ||
        !viewportRef.current
      ) {
        return;
      }

      viewportRef.current.dress();

      lastDressedVersionRef.current =
        simulateVersion;
    }, [simulateVersion]);

    return (
      <div
        className={
          `viewport-host` +
          (draggingPiece
            ? " is-piece-dragging"
            : "")
        }
        ref={hostRef}
        onDragEnter={(event) => {
          if (
            event.dataTransfer.types.includes(
              "application/x-moldeon-piece",
            )
          ) {
            setDraggingPiece(true);
          }
        }}
        onDragOver={(event) => {
          if (
            event.dataTransfer.types.includes(
              "application/x-moldeon-piece",
            )
          ) {
            event.preventDefault();
          }
        }}
        onDragLeave={(event) => {
          const relatedTarget =
            event.relatedTarget as
              | Node
              | null;

          if (
            !event.currentTarget.contains(
              relatedTarget,
            )
          ) {
            setDraggingPiece(false);
          }
        }}
        onDrop={() =>
          setDraggingPiece(false)
        }
      >
        {error ? (
          <div className="viewport-error">
            {error}
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div
            className="viewport-warnings"
            role="alert"
          >
            {warnings.join(" ")}
          </div>
        ) : null}

        {draggingPiece ? (
          <div
            className="preview-drop-zones"
            aria-label="Regiões de posicionamento"
          >
            {(
              [
                "torso",
                "waist",
                "hip",
                "arm",
                "leg",
              ] as const
            ).map((region) => (
              <button
                key={region}
                type="button"
                onDragOver={(event) =>
                  event.preventDefault()
                }
                onDrop={(event) => {
                  event.preventDefault();

                  const pieceId =
                    event.dataTransfer.getData(
                      "application/x-moldeon-piece",
                    );

                  if (pieceId) {
                    onPieceDrop?.(
                      pieceId,
                      region,
                    );
                  }

                  setDraggingPiece(
                    false,
                  );
                }}
              >
                {regionLabel(region)}
              </button>
            ))}
          </div>
        ) : null}

        <div
          className="viewport-inspection"
          role="group"
          aria-label="Inspeção da montagem"
        >
          <button
            type="button"
            className={
              inspectionMode ===
              "mounted"
                ? "active"
                : ""
            }
            onClick={() =>
              setInspectionMode(
                "mounted",
              )
            }
          >
            Montada
          </button>

          <button
            type="button"
            className={
              inspectionMode ===
              "exploded"
                ? "active"
                : ""
            }
            onClick={() =>
              setInspectionMode(
                "exploded",
              )
            }
          >
            Explodida
          </button>
        </div>

        <div className="viewport-label">
          Preview 3D ·{" "}
          {garment.bodyType ===
          "feminine"
            ? "Feminino"
            : "Masculino"}{" "}
          ·{" "}
          {garment.fabrics.length >
          1
            ? `${garment.fabrics.length} tecidos`
            : garment.fabrics[0]
                ?.name ??
              "sem tecido"}
        </div>
      </div>
    );
  },
);

function regionLabel(
  region: PreviewRegion,
): string {
  const labels: Record<
    PreviewRegion,
    string
  > = {
    torso: "Tronco",
    waist: "Cintura",
    hip: "Quadril",
    arm: "Braço",
    leg: "Perna",
  };

  return labels[region];
}