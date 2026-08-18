import type { BodyType } from "../domain/pattern";

export type AvatarAxis = "x" | "-x" | "y" | "-y" | "z" | "-z";

export interface ApprovedAvatarAssetDescriptor {
  assetId: string;
  sourceUrl: string;
  bodyProfile: BodyType;
  sourceUnit: "m" | "cm" | "mm";
  scaleToMeters: number;
  upAxis: AvatarAxis;
  forwardAxis: AvatarAxis;
  groundOffsetM: number;
  rootTransform: {
    positionM: [number, number, number];
    rotationDeg: [number, number, number];
  };
  version: string;
  license: string;
  authorAttribution: string;
}

/**
 * Registro deliberadamente vazio até o usuário fornecer e aprovar um GLB/glTF.
 * Um arquivo colocado em public/ não deve se tornar público por descoberta ou nome.
 */
export const APPROVED_AVATAR_ASSETS: readonly ApprovedAvatarAssetDescriptor[] = [];

export function approvedAvatarForBody(
  bodyProfile: BodyType,
): ApprovedAvatarAssetDescriptor | undefined {
  return APPROVED_AVATAR_ASSETS.find((asset) => asset.bodyProfile === bodyProfile);
}

export const AVATAR_NOT_CONFIGURED_MESSAGE = "Manequim humano ainda não configurado.";
