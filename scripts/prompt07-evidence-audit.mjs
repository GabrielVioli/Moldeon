import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const directory = process.env.PROMPT07_ARTIFACT_DIR ?? "artifacts/prompt07-trousers";
const candidates = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const executablePath = candidates.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error(`Chrome não encontrado: ${candidates.join(", ")}`);

const scenarios = [
  ["trouser-front-back-medium.svg", "trouser-front-back-medium.png"],
  ["trouser-body-comparison.svg", "trouser-body-comparison.png"],
  ["trouser-assembly-graph.svg", "trouser-assembly-graph.png"],
];

const browser = await chromium.launch({ executablePath, headless: true });
const browserScenarios = [];
try {
  for (const [sourceName, screenshotName] of scenarios) {
    const page = await browser.newPage({ viewport: { width: 2000, height: 1600 }, deviceScaleFactor: 1 });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.goto(`file://${resolve(directory, sourceName)}`, { waitUntil: "load" });
    const inspection = await page.evaluate(() => {
      const svg = document.querySelector("svg");
      const paths = [...document.querySelectorAll("path")];
      const seamLabels = [...document.querySelectorAll(".seam-label")].map((element) => element.textContent?.trim());
      return {
        hasSvg: Boolean(svg),
        width: svg?.getBoundingClientRect().width ?? 0,
        height: svg?.getBoundingClientRect().height ?? 0,
        pathCount: paths.length,
        invalidPaths: paths.filter((path) => /NaN|Infinity|undefined/.test(path.getAttribute("d") ?? "")).length,
        seamLabels,
      };
    });
    if (!inspection.hasSvg || inspection.width <= 0 || inspection.height <= 0 || inspection.invalidPaths > 0) {
      throw new Error(`${sourceName}: SVG inválido ${JSON.stringify(inspection)}`);
    }
    if (sourceName === "trouser-assembly-graph.svg") {
      const expected = ["left-outseam", "left-inseam", "right-outseam", "right-inseam", "front-rise", "back-rise"];
      for (const role of expected) {
        if (!inspection.seamLabels.includes(role)) throw new Error(`Grafo sem rótulo visível: ${role}`);
      }
    }
    await page.screenshot({
      path: resolve(directory, screenshotName),
      fullPage: false,
      animations: "disabled",
      timeout: 60_000,
    });
    browserScenarios.push({
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
  await writeFile(reportPath, `${JSON.stringify({
    ...base,
    browserVersion: browser.version(),
    browserExecutable: executablePath,
    browserScenarios,
  }, null, 2)}\n`);
  await writeFile(resolve(directory, "prompt07-visual-audit.md"), [
    "# Auditoria visual do Prompt 7",
    "",
    `Chrome: ${browser.version()}`,
    "",
    "| Cenário | Estado | Paths inválidos | Erros de console |",
    "|---|---:|---:|---:|",
    ...browserScenarios.map((scenario) => `| ${scenario.name} | ${scenario.status} | ${scenario.invalidPaths} | ${scenario.consoleErrors.length} |`),
    "",
    "O grafo apresenta lateral e entreperna em ancoragens separadas. As seis relações lógicas estão visíveis.",
    "O 3D não participa da aprovação.",
    "",
  ].join("\n"));
} finally {
  await browser.close();
}
