import type {
  BodyAnchorId,
  BodyPlacementRegion,
  BodyPlacementSide,
  BodyPlacementSurface,
  BodyPlacementRole,
  PreviewBodySide,
  PreviewRegion,
  PreviewSurface,
} from "./pattern";

export interface BodyAnchorSpecification {
  id: BodyAnchorId;
  label: string;
  region: Exclude<PreviewRegion, "custom"> | "neck";
  surface: Exclude<PreviewSurface, "custom">;
  bodySide: PreviewBodySide;
  defaultRole: BodyPlacementRole;
}

/**
 * Domain vocabulary shared by authoring, migration and avatar arrangement.
 * This describes the existing BodyAnchorId values; it is not a placement map
 * and stores no document state.
 */
export const BODY_ANCHOR_SPECIFICATIONS: readonly BodyAnchorSpecification[] = [
  { id: "torso-front", label: "Frente do torso", region: "torso", surface: "front", bodySide: "center", defaultRole: "front" },
  { id: "torso-back", label: "Costas do torso", region: "torso", surface: "back", bodySide: "center", defaultRole: "back" },
  { id: "shoulder-left", label: "Ombro esquerdo", region: "arm", surface: "side", bodySide: "left", defaultRole: "sleeve" },
  { id: "shoulder-right", label: "Ombro direito", region: "arm", surface: "side", bodySide: "right", defaultRole: "sleeve" },
  { id: "arm-left", label: "Braço esquerdo", region: "arm", surface: "side", bodySide: "left", defaultRole: "sleeve" },
  { id: "arm-right", label: "Braço direito", region: "arm", surface: "side", bodySide: "right", defaultRole: "sleeve" },
  { id: "waist-front", label: "Frente da cintura", region: "waist", surface: "front", bodySide: "center", defaultRole: "waistband" },
  { id: "waist-back", label: "Costas da cintura", region: "waist", surface: "back", bodySide: "center", defaultRole: "waistband" },
  { id: "hip-front", label: "Frente do quadril", region: "hip", surface: "front", bodySide: "center", defaultRole: "panel" },
  { id: "hip-back", label: "Costas do quadril", region: "hip", surface: "back", bodySide: "center", defaultRole: "panel" },
  { id: "hip-left", label: "Lateral esquerda do quadril", region: "hip", surface: "side", bodySide: "left", defaultRole: "panel" },
  { id: "hip-right", label: "Lateral direita do quadril", region: "hip", surface: "side", bodySide: "right", defaultRole: "panel" },
  { id: "leg-left", label: "Perna esquerda", region: "leg", surface: "side", bodySide: "left", defaultRole: "panel" },
  { id: "leg-right", label: "Perna direita", region: "leg", surface: "side", bodySide: "right", defaultRole: "panel" },
  { id: "neck", label: "Pescoço", region: "neck", surface: "front", bodySide: "center", defaultRole: "collar" },
] as const;

const BODY_ANCHOR_BY_ID = new Map(BODY_ANCHOR_SPECIFICATIONS.map((specification) => [specification.id, specification]));

export function bodyAnchorSpecification(id: BodyAnchorId): BodyAnchorSpecification {
  const specification = BODY_ANCHOR_BY_ID.get(id);
  if (!specification) throw new Error(`BodyAnchorId não suportado: ${id}`);
  return specification;
}

export function pairedBodyAnchorId(id: BodyAnchorId, bodySide: PreviewBodySide): BodyAnchorId {
  if (bodySide === "left" && id.endsWith("-right")) return id.replace(/-right$/, "-left") as BodyAnchorId;
  if (bodySide === "right" && id.endsWith("-left")) return id.replace(/-left$/, "-right") as BodyAnchorId;
  return id;
}

export function placementFieldsForAnchor(id: BodyAnchorId): {
  role: BodyPlacementRole;
  region: BodyPlacementRegion;
  surface: BodyPlacementSurface;
  bodySide: BodyPlacementSide;
} {
  const specification = bodyAnchorSpecification(id);
  return {
    role: specification.defaultRole,
    region: specification.region,
    surface: specification.surface,
    bodySide: specification.bodySide,
  };
}
