import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
const page = await context.newPage();
const result = { errors: [], modes: {}, persistence: {} };
page.on("pageerror", (error) => result.errors.push(error.message));

try {
  await page.goto(process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4173", { waitUntil: "networkidle", timeout: 60_000 });
  result.initial = await snapshot(page);

  for (const mode of ["Montagem", "Prova", "Modelagem"]) {
    const started = performance.now();
    await page.getByRole("button", { name: mode, exact: true }).click();
    await page.waitForTimeout(mode === "Prova" ? 650 : 150);
    result.modes[mode] = { elapsedMs: Math.round(performance.now() - started), ...(await snapshot(page)) };
  }

  await page.getByRole("button", { name: "Moldes", exact: true }).click();
  await page.getByRole("button", { name: /Camiseta b.sica/i }).first().click();
  await page.getByRole("button", { name: "Criar molde", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached", timeout: 15_000 });
  await page.waitForFunction(() => document.body.innerText.includes("Salvo localmente"), null, { timeout: 10_000 });
  result.persistence.beforeReload = await snapshot(page);
  await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForFunction(() => document.body.innerText.includes("Restaurado") || document.body.innerText.includes("Salvo localmente"), null, { timeout: 10_000 });
  result.persistence.afterReload = await snapshot(page);
  result.persistence.restoredTshirt = documentBodyIncludes(result.persistence.afterReload, "Camiseta básica") && documentBodyIncludes(result.persistence.afterReload, "Frente");
} finally {
  await browser.close();
}

console.log(JSON.stringify(result, null, 2));

async function snapshot(page) {
  return page.evaluate(() => ({
    body: document.body.innerText.replace(/\s+/g, " ").slice(0, 2200),
    activeMode: document.querySelector(".workspace-mode-switch button.active")?.textContent?.trim() ?? null,
    visible3D: Boolean(document.querySelector("canvas.three-canvas")?.getBoundingClientRect().width),
    dialogCount: document.querySelectorAll("[role='dialog']").length,
  }));
}

function documentBodyIncludes(snapshotValue, value) {
  return snapshotValue.body.toLocaleLowerCase("pt-BR").includes(value.toLocaleLowerCase("pt-BR"));
}
