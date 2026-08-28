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
 * Mobile preview registration for the canonical female body already shipped
 * with Moldeon. This lives only on the deploy/test-mobile branch so production
 * branches remain untouched while the responsive workspace is tested.
 */
export const APPROVED_AVATAR_ASSETS: readonly ApprovedAvatarAssetDescriptor[] = [
  {
    assetId: "canonical-female.glb",
    sourceUrl: "/models/human/canonical-female.glb",
    bodyProfile: "feminine",
    sourceUnit: "m",
    scaleToMeters: 1,
    upAxis: "y",
    forwardAxis: "z",
    groundOffsetM: 0,
    rootTransform: {
      positionM: [0, 0, 0],
      rotationDeg: [0, 0, 0],
    },
    version: "canonical-female@1",
    license: "CC BY 4.0",
    authorAttribution: "Female body base by Dori Mur (Sketchfab)",
  },
];

export function approvedAvatarForBody(
  bodyProfile: BodyType,
): ApprovedAvatarAssetDescriptor | undefined {
  return APPROVED_AVATAR_ASSETS.find((asset) => asset.bodyProfile === bodyProfile);
}

export const AVATAR_NOT_CONFIGURED_MESSAGE = "Manequim humano ainda não configurado.";
