import type { PatternMethodologyRecord } from "../domain/parametricMeasurements";

const DOCUMENTATION_PATH = "docs/PATTERN_LIBRARY.md";

export const UPPER_BLOCK_METHODOLOGY: PatternMethodologyRecord = {
  id: "freesewing-brian-teagan-moldeon-adaptation",
  version: "2026.3",
  name: "Adaptação Moldeon dos blocos Brian e Teagan",
  sourceType: "documented-adaptation",
  documentationPath: DOCUMENTATION_PATH,
  references: [
    "https://github.com/freesewing/freesewing/blob/develop/designs/brian/src/base.mjs",
    "https://github.com/freesewing/freesewing/blob/develop/designs/teagan/src/shared.mjs",
    "https://freesewing.org/docs/designs/teagan/options/",
  ],
};

export const SKIRT_BLOCK_METHODOLOGY: PatternMethodologyRecord = {
  id: "freesewing-penelope-moldeon-adaptation",
  version: "2026.3",
  name: "Adaptação Moldeon do bloco Penelope",
  sourceType: "documented-adaptation",
  documentationPath: DOCUMENTATION_PATH,
  references: [
    "https://github.com/freesewing/freesewing/blob/develop/designs/penelope/src/shape.mjs",
    "https://github.com/freesewing/freesewing/blob/develop/designs/penelope/src/utils.mjs",
    "https://freesewing.org/docs/designs/penelope/",
  ],
};

export const TROUSER_BLOCK_METHODOLOGY: PatternMethodologyRecord = {
  id: "freesewing-titan-moldeon-adaptation",
  version: "2026.3",
  name: "Adaptação Moldeon do bloco de calça Titan",
  sourceType: "documented-adaptation",
  documentationPath: DOCUMENTATION_PATH,
  references: [
    "https://github.com/freesewing/freesewing/blob/develop/designs/titan/src/back.mjs",
    "https://github.com/freesewing/freesewing/blob/develop/designs/titan/src/front.mjs",
    "https://freesewing.org/docs/designs/titan/options/",
  ],
};

export const JACKET_PENDING_METHODOLOGY: PatternMethodologyRecord = {
  id: "moldeon-jacket-pending",
  version: "0",
  name: "Método próprio de jaqueta ainda não definido",
  sourceType: "pending",
  documentationPath: DOCUMENTATION_PATH,
  references: [],
};
