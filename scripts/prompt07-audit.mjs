import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const directory = process.env.PROMPT07_ARTIFACT_DIR ?? "artifacts/prompt07-trousers";
const scenarios = [
  ["trouser-front-back-medium.svg", "trouser-front-back-medium.png"],
  ["trouser-body-comparison.svg", "trouser-body-comparison.png"],
  ["trouser-assembly-graph.svg", "trouser-assembly-graph.png"],
];
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [sourceName, screenshotName] of scenarios) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    const sourcePath = resolve(directory, sourceName);
    await page.goto(`file://${sourcePath}`, { waitUntil: "load" });
    const inspection = await page.evaluate(() => {
      const svg = document.querySelector("svg");
      const paths = [...document.querySelectorAll("path")];
      return {
        hasSvg: Boolean(svg),
        width: svg?.getBoundingClientRect().width ?? 0,
        height: svg?.getBoundingClientRect().height ?? 0,
        pathCount: paths.length,
        invalidPaths: paths.filter((path) => /NaN|Infinity|undefined/.test(path.getAttribute("d") ?? "")).length,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      };
    });
    if (!inspection.hasSvg || inspection.width <= 0 || inspection.height <= 0 || inspection.invalidPaths > 0) {
      throw new Error(`${sourceName}: SVG inválido ${JSON.stringify(inspection)}`);
    }
    await page.screenshot({ path: resolve(directory, screenshotName), fullPage: true });
    results.push({
      name: sourceName.replace(/\.svg$/, ""),
      status: "passed",
      consoleErrors,
      ...inspection,
      screenshot: screenshotName,
    });
    await page.close();
  }

  const reportPath = resolve(directory, "prompt07-visual-audit.json");
  const base = JSON.parse(await readFile(reportPath, "utf8"));
  const report = {
    ...base,
    browserVersion: browser.version(),
    browserScenarios: results,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const markdown = [
    "# Auditoria visual do Prompt 7",
    "",
    `Chromium: ${browser.version()}`,
    "",
    "| Cenário | Estado | Paths inválidos | Erros de console |",
    "|---|---:|---:|---:|",
    ...results.map((result) => `| ${result.name} | ${result.status} | ${result.invalidPaths} | ${result.consoleErrors.length} |`),
    "",
    "A inspeção usa apenas o molde 2D e o grafo lógico. O preview 3D não participa da aprovação.",
    "",
  ].join("\n");
  await writeFile(resolve(directory, "prompt07-visual-audit.md"), markdown);
} finally {
  await browser.close();
}
