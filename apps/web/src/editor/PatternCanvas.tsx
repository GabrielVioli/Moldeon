import { memo, type ComponentProps } from "react";
import { useEditorStore } from "../state/editorStore";
import { PatternCanvas as LegacyPatternCanvas } from "./PatternCanvasLegacy";

export type { EditorTool } from "./PatternCanvasLegacy";

type PatternCanvasProps = ComponentProps<typeof LegacyPatternCanvas>;

export function canvasDocumentGenerationKey(
  pieceIds: readonly string[],
  activePieceId: string,
): string {
  return `${pieceIds.join("\u001f")}\u001e${activePieceId}`;
}

function PatternCanvasGuard(props: PatternCanvasProps) {
  const generationKey = useEditorStore((state) =>
    canvasDocumentGenerationKey(
      state.garment.pieces.map((piece) => piece.id),
      state.activePieceId,
    ),
  );

  return <LegacyPatternCanvas key={generationKey} {...props} />;
}

export const PatternCanvas = memo(PatternCanvasGuard);
