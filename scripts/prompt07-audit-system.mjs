import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const directory = process.env.PROMPT07_ARTIFACT_DIR ?? "artifacts/prompt07-trousers";
const browserCandidates = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => existsSync(candidate));
if (!executablePath) {
  throw new Error(`Nenhum Chrome do sistema encontrado. Candidatos: ${browserCandidates.join(", ")}`);
}

const scenarios = [
  ["trouser-front-back-medium.svg", "trouser-front-back-medium.png"],
  ["trouser-body-comparison.svg", "trouser-body-comparison.png"],
  ["trouser-assembly-graph.svg", "trouser-assembly-graph.png"],
];
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
try {
  for (const [sourceName, screenshotName] of scenarios) {
    const page = await browser.newPage({ viewport: { width: 2000, height: 1600 }, deviceScaleFactor: 1 });
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
    if (inspection.width > 2000 || inspection.height > 1600) {
      throw new Error(`${sourceName}: prancheta excede a viewport de auditoria ${JSON.stringify(inspection)}`);
    }
    await page.screenshot({
      path: resolve(directory, screenshotName),
      fullPage: false,
      animations: "disabled",
      timeout: 60_000,
    });
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
    browserExecutable: executablePath,
    browserScenarios: results,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const markdown = [
    "# Auditoria visual do Prompt 7",
    "",
    `Chrome: ${browser.version()}`,
    `Executável: ${executablePath}`,
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
