import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";

const baseURL = process.env.AVATAR_AUDIT_URL ?? "http://127.0.0.1:4179";
const output = process.env.AVATAR_AUDIT_DIR ?? "artifacts/avatar-visual-final";
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});

const scenarios = [
  { label: "desktop-tshirt", template: "Camiseta básica", viewport: { width: 1440, height: 1000 } },
  { label: "desktop-skirt", template: "Saia reta", viewport: { width: 1440, height: 1000 } },
  { label: "mobile-trousers", template: "Calça reta", viewport: { width: 390, height: 844 } },
];
const results = [];

for (const scenario of scenarios) {
  const context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Moldes" }).click();
  const card = page.getByRole("button", { name: scenario.template, exact: false }).first();
  await card.waitFor({ state: "visible" });
  await card.evaluate((element) => element.click());
  await page.locator(".pattern-library-dialog").waitFor({ state: "detached" });

  const mobileTab = page.getByRole("tab", { name: "Manequim 3D" });
  if (await mobileTab.isVisible()) await mobileTab.evaluate((element) => element.click());
  else {
    const dress = page.getByRole("button", { name: "Vestir no manequim" });
    await dress.waitFor({ state: "visible" });
    await dress.evaluate((element) => element.click());
  }

  const canvas = page.locator("canvas.three-canvas");
  await canvas.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await page.waitForTimeout(600);

  const canvasPath = path.join(output, `${scenario.label}-canvas.png`);
  const pagePath = path.join(output, `${scenario.label}.png`);
  await canvas.screenshot({ path: canvasPath });
  await page.screenshot({ path: pagePath, fullPage: true });

  const png = PNG.sync.read(await fs.readFile(canvasPath));
  const colors = new Set();
  let minLuma = 255;
  let maxLuma = 0;
  let opaque = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    const r = png.data[index];
    const g = png.data[index + 1];
    const b = png.data[index + 2];
    const a = png.data[index + 3];
    if (a < 32) continue;
    opaque += 1;
    const luma = Math.round(r * 0.2126 + g * 0.7152 + b * 0.0722);
    minLuma = Math.min(minLuma, luma);
    maxLuma = Math.max(maxLuma, luma);
    if (colors.size < 4096) colors.add(`${r >> 3}/${g >> 3}/${b >> 3}`);
  }

  const box = await canvas.boundingBox();
  const host = await page.locator("[data-testid='dressed-avatar-viewport']").evaluate((element) => ({ ...element.dataset }));
  const metrics = {
    box,
    opaque,
    quantizedColors: colors.size,
    lumaRange: maxLuma - minLuma,
    host,
    consoleErrors,
  };

  if (!box || box.width < 240 || box.height < 300) throw new Error(`${scenario.label}: canvas pequeno ${JSON.stringify(metrics)}`);
  if (colors.size < 18 || maxLuma - minLuma < 28) throw new Error(`${scenario.label}: canvas visualmente vazio ${JSON.stringify(metrics)}`);
  if (host.avatarVisible !== "true" || Number(host.garmentInstanceCount ?? 0) < 4) throw new Error(`${scenario.label}: cena sem avatar/roupa ${JSON.stringify(metrics)}`);
  if (Number(host.arrangementErrorCount ?? 0) !== 0) throw new Error(`${scenario.label}: erro de montagem ${JSON.stringify(metrics)}`);
  if (consoleErrors.length > 0) throw new Error(`${scenario.label}: console ${consoleErrors.join(" | ")}`);

  results.push({ scenario, metrics, canvasPath, pagePath });
  await context.close();
}

await browser.close();
await fs.writeFile(path.join(output, "audit.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
