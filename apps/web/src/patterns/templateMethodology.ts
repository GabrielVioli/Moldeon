import type { PatternMethodologyRecord } from "../domain/parametricMeasurements";

const DOCUMENTATION_PATH = "docs/PATTERN_LIBRARY.md";

export const UPPER_BLOCK_METHODOLOGY: PatternMethodologyRecord = {
  id: "moldeon-upper-block",
  version: "2026.2",
  name: "Bloco superior de referência Moldeon",
  sourceType: "moldeon-original",
  documentationPath: DOCUMENTATION_PATH,
  references: [
    "https://freesewing.dev/guides/best-practices/",
    "https://freesewing.org/docs/designs/teagan/",
  ],
};

export const SKIRT_BLOCK_METHODOLOGY: PatternMethodologyRecord = {
  id: "moldeon-skirt-block",
  version: "2026.2",
  name: "Bloco de saia de referência Moldeon",
  sourceType: "moldeon-original",
  documentationPath: DOCUMENTATION_PATH,
  references: [
    "https://freesewing.dev/guides/best-practices/",
    "https://freesewing.org/designs/penelope/",
  ],
};

export const TROUSER_BLOCK_METHODOLOGY: PatternMethodologyRecord = {
  id: "moldeon-trouser-block",
  version: "2026.2",
  name: "Bloco de calça de referência Moldeon",
  sourceType: "moldeon-original",
  documentationPath: DOCUMENTATION_PATH,
  references: [
    "https://freesewing.org/designs/titan/",
    "https://freesewing.dev/reference/measurements/",
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
