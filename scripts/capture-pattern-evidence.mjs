import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const evidenceDir = resolve(process.argv[2] ?? "artifacts/recovery-9-5-06-method-rebuild");
const executablePath = process.env.CHROME_PATH
  ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const svgFiles = (await readdir(evidenceDir)).filter((name) => name.endsWith(".svg"));
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1500 }, deviceScaleFactor: 1 });
  for (const file of svgFiles) {
    await page.goto(pathToFileURL(resolve(evidenceDir, file)).href, { waitUntil: "load" });
    const svg = page.locator("svg");
    await svg.screenshot({ path: resolve(evidenceDir, file.replace(/\.svg$/, ".png")) });
  }
} finally {
  await browser.close();
}
