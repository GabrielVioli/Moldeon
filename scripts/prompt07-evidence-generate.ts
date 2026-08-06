import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createTrouserVisualEvidence } from "../apps/web/src/patterns/trouserVisualEvidence";

const directory = process.env.PROMPT07_ARTIFACT_DIR ?? "artifacts/prompt07-trousers";
const evidence = createTrouserVisualEvidence();

await mkdir(directory, { recursive: true });
await Promise.all([
  writeFile(resolve(directory, "trouser-front-back-medium.svg"), evidence.frontBackSvg),
  writeFile(resolve(directory, "trouser-body-comparison.svg"), evidence.comparisonSvg),
  writeFile(resolve(directory, "trouser-assembly-graph.svg"), evidence.graphSvg),
  writeFile(
    resolve(directory, "prompt07-visual-audit.json"),
    `${JSON.stringify(evidence.report, null, 2)}\n`,
  ),
]);
