import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.PROMPT06_BASE_URL ?? "http://127.0.0.1:5190";
const outputDirectory = resolve(process.env.PROMPT06_ARTIFACT_DIR ?? "artifacts/prompt06-base-patterns");
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const report = {
  browserVersion: browser.version(),
  physicalDevicesValidated: false,
  threeDimensionalPreviewUsedAsEvidence: false,
  scenarios: [],
};

const targets = ["bodice-block", "tshirt", "blouse", "straight-skirt", "mini-skirt"];
for (const templateId of targets) {
  await runTemplateScenario(templateId);
}
await runComparisonScenario("upper-body-comparison", ["bodice-block", "tshirt", "blouse"]);
await runComparisonScenario("skirt-comparison", ["straight-skirt", "mini-skirt"]);
await runContinuityScenario();
await browser.close();

const markdown = renderMarkdown(report);
await writeFile(resolve(outputDirectory, "prompt06-visual-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(resolve(outputDirectory, "prompt06-visual-audit.md"), markdown, "utf8");
console.log(markdown);
if (report.scenarios.some((scenario) => scenario.status !== "passed")) process.exitCode = 1;

async function runTemplateScenario(templateId) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "pt-BR" });
  const page = await context.newPage();
  const diagnostics = collectDiagnostics(page);
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const data = await page.evaluate(async ({ templateId }) => {
      const catalog = await import("/src/patterns/templateCatalog.ts");
      const fixtures = await import("/src/testFixtures/parametricBodyFixtures.ts");
      const metadataModule = await import("/src/patterns/basePatternDrafting.ts");
      const fixture = fixtures.createParametricBodyFixture("medium");
      const garment = catalog.createGarmentFromTemplate(templateId, fixture.supplied, fixture.bodyType, fixture.profile);
      renderAuditDocument(`${garment.name} · corpo médio`, [garment], metadataModule.BASE_PATTERN_METADATA[templateId]);
      return inspectRendered(garment);

      function renderAuditDocument(title, garments, metadata) {
        document.head.innerHTML = `<meta charset="utf-8"><style>${auditCss()}</style>`;
        document.body.innerHTML = `<main><header><p>Moldeon · auditoria 2D</p><h1>${escapeHtml(title)}</h1><div class="status">${escapeHtml(metadata.templateVersion)} · ${escapeHtml(metadata.validationStatus)} · revisão manual: ${metadata.manualReview ? "sim" : "não"}</div></header><section class="garment-grid">${garments.map(renderGarment).join("")}</section><footer>O 3D não foi usado como prova. Coordenadas em milímetros.</footer></main>`;
      }

      function renderGarment(garment) {
        return `<article class="garment"><h2>${escapeHtml(garment.name)}</h2><div class="piece-grid">${garment.pieces.map(renderPiece).join("")}</div></article>`;
      }

      function renderPiece(piece) {
        const xs = piece.points.map((point) => point.xMm);
        const ys = piece.points.map((point) => point.yMm);
        const minX = Math.min(...xs) - 30;
        const minY = Math.min(...ys) - 30;
        const width = Math.max(...xs) - Math.min(...xs) + 60;
        const height = Math.max(...ys) - Math.min(...ys) + 60;
        const grain = piece.grainline ? `<line class="grain" x1="${piece.grainline.start.xMm}" y1="${piece.grainline.start.yMm}" x2="${piece.grainline.end.xMm}" y2="${piece.grainline.end.yMm}"/><path class="grain-head" d="M ${piece.grainline.end.xMm - 5} ${piece.grainline.end.yMm - 10} L ${piece.grainline.end.xMm} ${piece.grainline.end.yMm} L ${piece.grainline.end.xMm + 5} ${piece.grainline.end.yMm - 10}"/>` : "";
        const darts = (piece.darts ?? []).map((dart) => `<path class="dart" d="M ${dart.legA.xMm} ${dart.legA.yMm} L ${dart.apex.xMm} ${dart.apex.yMm} L ${dart.legB.xMm} ${dart.legB.yMm}"/>`).join("");
        const notches = (piece.annotations ?? []).filter((annotation) => /Pique|Marca de ombro/.test(annotation.label)).map((annotation) => `<circle class="landmark" cx="${annotation.xMm}" cy="${annotation.yMm}" r="4"><title>${escapeHtml(annotation.label)}</title></circle>`).join("");
        return `<figure data-piece="${escapeHtml(piece.name)}"><figcaption><strong>${escapeHtml(piece.name)}</strong><span>${piece.cutOnFold ? "dobra" : `cortar ${piece.cutQuantity ?? 1}x`}</span></figcaption><svg viewBox="${minX} ${minY} ${width} ${height}" role="img" aria-label="Molde ${escapeHtml(piece.name)}"><path class="outline" d="${pathData(piece.points)}"/>${grain}${darts}${notches}</svg></figure>`;
      }

      function pathData(points) {
        let result = `M ${points[0].xMm} ${points[0].yMm}`;
        for (let index = 0; index < points.length; index += 1) {
          const start = points[index];
          const end = points[(index + 1) % points.length];
          if (start.handleOut || end.handleIn) {
            const c1 = start.handleOut ? { x: start.xMm + start.handleOut.xMm, y: start.yMm + start.handleOut.yMm } : { x: start.xMm, y: start.yMm };
            const c2 = end.handleIn ? { x: end.xMm + end.handleIn.xMm, y: end.yMm + end.handleIn.yMm } : { x: end.xMm, y: end.yMm };
            result += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.xMm} ${end.yMm}`;
          } else {
            result += ` L ${end.xMm} ${end.yMm}`;
          }
        }
        return `${result} Z`;
      }

      function inspectRendered(garment) {
        const figures = [...document.querySelectorAll("figure")];
        const paths = [...document.querySelectorAll("path.outline")];
        return {
          pieces: figures.map((figure) => figure.dataset.piece),
          pathCount: paths.length,
          invalidPaths: paths.filter((path) => /NaN|Infinity|undefined/.test(path.getAttribute("d") ?? "")).length,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          frontBackPresent: garment.pieces.some((piece) => piece.name === "Frente") && garment.pieces.some((piece) => piece.name === "Costas"),
        };
      }

      function auditCss() {
        return `*{box-sizing:border-box}html,body{margin:0;background:#ebe8e1;color:#242526;font-family:Inter,system-ui,sans-serif}main{min-height:100vh;padding:32px}header{display:grid;gap:8px;margin-bottom:24px}header p{margin:0;text-transform:uppercase;letter-spacing:.16em;font-size:12px}h1,h2{margin:0;font-family:Georgia,serif;font-weight:500}.status{font-size:13px;color:#5d5e5a}.garment-grid{display:grid;gap:24px}.garment{padding:20px;background:#f8f6f1;border:1px solid #cbc7bd;border-radius:16px}.piece-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:16px}figure{display:grid;grid-template-rows:auto 1fr;min-height:600px;margin:0;padding:14px;background:white;border:1px solid #d6d2ca;border-radius:12px}figcaption{display:flex;justify-content:space-between;gap:12px;font-size:13px}figcaption span{color:#777}svg{width:100%;height:100%;min-height:520px}.outline{fill:#f2ede0;stroke:#202124;stroke-width:2;vector-effect:non-scaling-stroke}.grain,.grain-head{fill:none;stroke:#8b5d13;stroke-width:1.5;vector-effect:non-scaling-stroke}.dart{fill:none;stroke:#9d3830;stroke-width:1.5;stroke-dasharray:5 3;vector-effect:non-scaling-stroke}.landmark{fill:#1d5f75;stroke:white;stroke-width:1.5;vector-effect:non-scaling-stroke}footer{margin-top:20px;color:#696a66;font-size:12px}`;
      }

      function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
      }
    }, { templateId });
    assert(data.frontBackPresent, `${templateId}: frente/costas ausentes.`);
    assert(data.pathCount >= 2, `${templateId}: poucos contornos renderizados.`);
    assert(data.invalidPaths === 0, `${templateId}: path SVG inválido.`);
    assert(data.scrollWidth <= data.clientWidth + 1, `${templateId}: overflow horizontal.`);
    await page.screenshot({ path: resolve(outputDirectory, `${templateId}-medium.png`), fullPage: true });
    report.scenarios.push({ name: `${templateId}-medium`, status: "passed", diagnostics, data });
  } catch (error) {
    await page.screenshot({ path: resolve(outputDirectory, `${templateId}-failed.png`), fullPage: true }).catch(() => undefined);
    report.scenarios.push({ name: `${templateId}-medium`, status: "failed", diagnostics, error: readable(error) });
  } finally {
    await context.close();
  }
}

async function runComparisonScenario(name, templateIds) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1200 }, locale: "pt-BR" });
  const page = await context.newPage();
  const diagnostics = collectDiagnostics(page);
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const result = await page.evaluate(async ({ templateIds, name }) => {
      const catalog = await import("/src/patterns/templateCatalog.ts");
      const fixtures = await import("/src/testFixtures/parametricBodyFixtures.ts");
      const fixtureList = fixtures.createAllParametricBodyFixtures();
      const cards = fixtureList.flatMap((fixture) => templateIds.map((templateId) => {
        const garment = catalog.createGarmentFromTemplate(templateId, fixture.supplied, fixture.bodyType, fixture.profile);
        const front = garment.pieces.find((piece) => piece.name === "Frente");
        const back = garment.pieces.find((piece) => piece.name === "Costas");
        return { fixture: fixture.id, templateId, version: garment.parametric?.templateVersion, pieces: [front, back].filter(Boolean) };
      }));
      document.head.innerHTML = `<meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;background:#e7e3da;font-family:Inter,system-ui,sans-serif;color:#222}main{padding:26px}h1{margin:0 0 20px;font:500 32px Georgia,serif}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.card{padding:12px;background:#fff;border:1px solid #cbc6bb;border-radius:12px}.card h2{display:flex;justify-content:space-between;margin:0 0 8px;font-size:13px}.pieces{display:grid;grid-template-columns:1fr 1fr;gap:6px}svg{width:100%;height:300px;background:#faf9f5}.outline{fill:#eee6d3;stroke:#222;stroke-width:2;vector-effect:non-scaling-stroke}.label{font-size:11px;color:#666}@media(max-width:1200px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}</style>`;
      document.body.innerHTML = `<main><h1>${name}</h1><section class="grid">${cards.map(renderCard).join("")}</section></main>`;
      return {
        cards: cards.length,
        paths: document.querySelectorAll("path.outline").length,
        invalidPaths: [...document.querySelectorAll("path.outline")].filter((path) => /NaN|Infinity|undefined/.test(path.getAttribute("d") ?? "")).length,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };

      function renderCard(card) {
        return `<article class="card"><h2><span>${card.fixture} · ${card.templateId}</span><span class="label">${card.version}</span></h2><div class="pieces">${card.pieces.map(renderPiece).join("")}</div></article>`;
      }
      function renderPiece(piece) {
        const xs = piece.points.map((point) => point.xMm); const ys = piece.points.map((point) => point.yMm);
        const minX = Math.min(...xs) - 20; const minY = Math.min(...ys) - 20;
        const width = Math.max(...xs) - Math.min(...xs) + 40; const height = Math.max(...ys) - Math.min(...ys) + 40;
        return `<svg viewBox="${minX} ${minY} ${width} ${height}" aria-label="${piece.name}"><path class="outline" d="${pathData(piece.points)}"/></svg>`;
      }
      function pathData(points) {
        let result = `M ${points[0].xMm} ${points[0].yMm}`;
        for (let index = 0; index < points.length; index += 1) {
          const start = points[index]; const end = points[(index + 1) % points.length];
          if (start.handleOut || end.handleIn) {
            const c1x = start.xMm + (start.handleOut?.xMm ?? 0); const c1y = start.yMm + (start.handleOut?.yMm ?? 0);
            const c2x = end.xMm + (end.handleIn?.xMm ?? 0); const c2y = end.yMm + (end.handleIn?.yMm ?? 0);
            result += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.xMm} ${end.yMm}`;
          } else result += ` L ${end.xMm} ${end.yMm}`;
        }
        return `${result} Z`;
      }
    }, { templateIds, name });
    assert(result.cards === templateIds.length * 5, `${name}: quantidade inesperada de cartões.`);
    assert(result.paths === result.cards * 2, `${name}: frente/costas não foram renderizadas em todos os corpos.`);
    assert(result.invalidPaths === 0, `${name}: contorno inválido.`);
    assert(result.scrollWidth <= result.clientWidth + 1, `${name}: overflow horizontal.`);
    await page.screenshot({ path: resolve(outputDirectory, `${name}.png`), fullPage: true });
    report.scenarios.push({ name, status: "passed", diagnostics, data: result });
  } catch (error) {
    await page.screenshot({ path: resolve(outputDirectory, `${name}-failed.png`), fullPage: true }).catch(() => undefined);
    report.scenarios.push({ name, status: "failed", diagnostics, error: readable(error) });
  } finally {
    await context.close();
  }
}

async function runContinuityScenario() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "pt-BR" });
  const page = await context.newPage();
  const diagnostics = collectDiagnostics(page);
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const result = await page.evaluate(async () => {
      const catalog = await import("/src/patterns/templateCatalog.ts");
      const fixtures = await import("/src/testFixtures/parametricBodyFixtures.ts");
      const fixture = fixtures.createParametricBodyFixture("medium");
      const widths = [];
      const signs = [];
      for (let bustMm = 780; bustMm <= 1280; bustMm += 10) {
        const garment = catalog.createGarmentFromTemplate("tshirt", { ...fixture.supplied, bustMm }, fixture.bodyType);
        const front = garment.pieces.find((piece) => piece.name === "Frente");
        widths.push(Math.max(...front.points.map((point) => point.xMm)));
        signs.push(Math.sign(front.points.reduce((sum, point, index) => {
          const next = front.points[(index + 1) % front.points.length];
          return sum + point.xMm * next.yMm - next.xMm * point.yMm;
        }, 0)));
      }
      return {
        samples: widths.length,
        monotonic: widths.every((value, index) => index === 0 || value >= widths[index - 1] - 0.1),
        maxJumpMm: Math.max(...widths.slice(1).map((value, index) => Math.abs(value - widths[index]))),
        consistentOrientation: signs.every((sign) => sign !== 0 && sign === signs[0]),
      };
    });
    assert(result.monotonic, "A largura do molde não cresce de forma monotônica.");
    assert(result.maxJumpMm < 8, `Salto geométrico de ${result.maxJumpMm} mm.`);
    assert(result.consistentOrientation, "O contorno inverteu orientação durante atualização de medidas.");
    report.scenarios.push({ name: "measurement-continuity", status: "passed", diagnostics, data: result });
  } catch (error) {
    report.scenarios.push({ name: "measurement-continuity", status: "failed", diagnostics, error: readable(error) });
  } finally {
    await context.close();
  }
}

function collectDiagnostics(page) {
  const diagnostics = [];
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  return diagnostics;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readable(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function renderMarkdown(value) {
  return [
    "# Auditoria 2D do Prompt 6",
    "",
    `Chromium ${value.browserVersion}`,
    "",
    "| Cenário | Resultado | Diagnósticos |",
    "|---|---|---:|",
    ...value.scenarios.map((scenario) => `| ${scenario.name} | ${scenario.status} | ${scenario.diagnostics.length} |`),
    "",
    "A inspeção usou somente os contornos 2D. O viewport 3D não foi usado como evidência de correção.",
    "",
    "Não houve validação em aparelho físico, toile ou revisão presencial por modelista.",
    "",
  ].join("\n");
}
