import { readFile, writeFile } from "node:fs/promises";

async function edit(path, transform) {
  const source = await readFile(path, "utf8");
  const result = transform(source);
  if (result === source) throw new Error(`Nenhuma alteração aplicada em ${path}`);
  await writeFile(path, result);
  console.log(`updated ${path}`);
}

function replaceRequired(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: esperado 1 trecho, encontrado ${count}`);
  return source.replace(before, after);
}

await edit("apps/web/src/editor/PatternCanvas.tsx", (source) =>
  replaceRequired(
    source,
    `  function handleWheel(event: WheelEvent<HTMLCanvasElement>) {\n    event.preventDefault();\n    const rect = event.currentTarget.getBoundingClientRect();`,
    `  function handleWheel(event: WheelEvent<HTMLCanvasElement>) {\n    const rect = event.currentTarget.getBoundingClientRect();`,
    "wheel sem preventDefault passivo",
  ),
);

await edit("apps/web/src/components/AssemblyPanel.tsx", (source) =>
  replaceRequired(
    source,
    ` key={seam.id} onClick={() => selectSeam(seam.id)}>\n              <input`,
    ` key={seam.id} onClick={() => selectSeam(seam.id)}>\n              <button\n                type="button"\n                className="seam-select-button"\n                aria-label={"Selecionar costura " + (seam.name ?? seam.id)}\n                aria-pressed={selectedSeamId === seam.id}\n                onClick={(event) => {\n                  event.stopPropagation();\n                  selectSeam(seam.id);\n                }}\n              >\n                {selectedSeamId === seam.id ? "✓" : "○"}\n              </button>\n              <input`,
    "controle explícito de seleção de costura",
  ),
);

await edit("apps/web/src/styles.css", (source) => {
  const marker = "/* Prompt 03: final mobile workspace ownership */";
  if (source.includes(marker)) throw new Error("Bloco mobile final já existe.");
  return `${source.trimEnd()}\n\n${marker}\n.seam-select-button {\n  flex: 0 0 28px;\n  width: 28px;\n  min-width: 28px;\n  min-height: 28px;\n  padding: 0;\n  border: 1px solid #bcb7ac;\n  border-radius: 50%;\n  color: #5c5d59;\n  background: #fff;\n  cursor: pointer;\n  font-weight: 800;\n}\n\n.seam-select-button[aria-pressed="true"] {\n  color: #fff;\n  background: #9a6400;\n  border-color: #9a6400;\n}\n\n@media (max-width: 760px) {\n  .workspace.mode-modeling,\n  .workspace.mode-assembly,\n  .workspace.mode-fitting,\n  .workspace.mode-preparation {\n    grid-template-columns: minmax(0, 1fr);\n    grid-template-rows: 44px minmax(0, 1fr);\n    width: 100%;\n    min-width: 0;\n  }\n\n  .workspace.mode-modeling > .workspace-view,\n  .workspace.mode-assembly > .workspace-view,\n  .workspace.mode-fitting > .workspace-view,\n  .workspace.mode-preparation > .workspace-view {\n    grid-column: 1;\n    grid-row: 2;\n    min-width: 0;\n  }\n\n  .mobile-workspace-tabs {\n    width: 100%;\n    min-width: 0;\n  }\n\n  .workspace-tab {\n    min-width: 0;\n    min-height: 36px;\n    padding: 0 4px;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n\n  .editor-panel {\n    grid-template-rows: 48px minmax(0, 1fr);\n  }\n\n  .editor-body {\n    grid-template-columns: minmax(0, 1fr);\n    grid-template-rows: auto minmax(0, 1fr);\n    min-width: 0;\n    min-height: 0;\n  }\n\n  .pieces-panel {\n    min-width: 0;\n    overflow: hidden;\n    border-right: 0;\n    border-bottom: 1px solid #cbc8c1;\n  }\n\n  .pieces-panel header {\n    height: 34px;\n  }\n\n  .pieces-list {\n    display: flex;\n    gap: 6px;\n    padding: 4px 6px 6px;\n    overflow-x: auto;\n    overscroll-behavior-x: contain;\n    scrollbar-width: thin;\n  }\n\n  .pieces-item {\n    flex: 0 0 min(154px, 42vw);\n    grid-template-columns: 20px 24px minmax(0, 1fr) 26px 24px;\n    min-height: 42px;\n  }\n\n  .canvas-stack {\n    width: 100%;\n    min-width: 0;\n    min-height: 0;\n    height: auto;\n  }\n\n  .canvas-navigation {\n    right: 6px;\n    bottom: 6px;\n    max-width: calc(100% - 12px);\n    overflow-x: auto;\n  }\n\n  .canvas-navigation button,\n  .canvas-navigation input {\n    flex: 0 0 auto;\n  }\n}\n`;
});

await edit("scripts/prompt03-interaction-audit.mjs", (source) => {
  let next = replaceRequired(
    source,
    `  await row.click();\n  const selected = await state(page);`,
    `  await row.getByRole("button", { name: /Selecionar costura/i }).click();\n  const selected = await state(page);`,
    "seleção explícita da costura na lista",
  );
  next = replaceRequired(
    next,
    `  await details.locator("summary").click();`,
    `  await details.locator(":scope > summary").click();`,
    "summary externo de medidas",
  );
  next = replaceRequired(
    next,
    `  if (!(await mainGroup.evaluate((element) => element.open))) await mainGroup.locator("summary").click();`,
    `  if (!(await mainGroup.evaluate((element) => element.open))) await mainGroup.locator(":scope > summary").click();`,
    "summary do grupo de medidas",
  );
  return next;
});

await edit("README.md", (source) =>
  replaceRequired(
    source,
    `## Desempenho\n`,
    `## Atalhos do editor\n\n- \`Ctrl+A\` ou \`Cmd+A\` com foco na bancada seleciona todas as peças visíveis.\n- \`Ctrl+Z\` ou \`Cmd+Z\` desfaz; \`Ctrl+Shift+Z\`, \`Cmd+Shift+Z\` ou \`Ctrl+Y\` refaz.\n- \`Shift\` mantém a seleção múltipla e permite seleção aditiva por caixa.\n- Espaço pressionado ou a ferramenta **Mão** move a câmera; a roda aplica zoom no cursor e a pinça controla zoom e pan no touch.\n- \`F\` enquadra a seleção. \`[\` e \`]\` giram a peça ativa em 15°; com \`Shift\`, em 90°.\n- \`Escape\` cancela a intenção atual, limpa a seleção quando aplicável e fecha menus ou popovers ativos.\n- Atalhos de edição não são capturados enquanto o foco está em campos de texto, número ou seleção.\n\n## Desempenho\n`,
    "documentação de atalhos",
  ),
);

console.log("Prompt 03 final patch prepared");
