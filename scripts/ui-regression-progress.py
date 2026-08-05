from pathlib import Path
import json
import os

audit = json.loads(Path("artifacts/ui-regression-fix/ui-regression-audit.json").read_text(encoding="utf-8"))
scenarios = "\n".join(
    f"| `{item['name']}` | {item['status']} | {len(item.get('diagnostics', []))} |"
    for item in audit["scenarios"]
)
implementation = os.environ["IMPLEMENTATION_COMMIT"]
content = f'''# Correção de regressões de UI após o Prompt 4

## Estado

Correção implementada e auditada em `main` em 5 de agosto de 2026.

- commit inicial funcional: `f02fe4c395e223d6276343e58baf9fc18cabd94f`;
- commit da implementação auditada: `{implementation}`;
- workflow de auditoria: `{os.environ.get("GITHUB_RUN_ID", "indisponível")}`;
- navegador automatizado: Chromium `{audit["browserVersion"]}`.

A tarefa ficou restrita à interface, aos controladores de gesto, à navegação da câmera 2D e ao layout do painel direito. Domínio V3, persistência, migrações, geometria de corte, caminhos internos, pences, moldes-base, montagem semântica e física não foram alterados.

## Causas encontradas

### Arraste de peça

O Canvas não mantinha um owner explícito que também bloqueasse a navegação por `wheel` durante um arraste. Eventos de trackpad podiam atingir a câmera enquanto a peça já possuía o pointer. Além disso, `piecesMovingWith` incluía todo o componente conectado do grafo de montagem, fazendo peças costuradas aparentarem estar coladas durante uma edição de bancada.

A correção usa ownership lógico por pointer, `setPointerCapture`, bloqueio da câmera quando o owner é interativo e `stopPropagation` no início do gesto. O grupo de movimento agora contém apenas a peça clicada ou a seleção múltipla explícita. Relações semânticas de costura não movimentam peças na bancada.

### Trackpad e mouse

O handler anterior transformava qualquer `deltaY`, inclusive `0,5 px`, em um salto fixo de 10% de zoom. `deltaX`, `deltaMode`, diagonais e modificadores eram ignorados.

Foi criada a camada pura `canvasWheelNavigation.ts`. Ela normaliza pixels, linhas e páginas, limita deltas extremos, interpreta deltas pequenos ou diagonais como pan de trackpad, roda discreta como zoom e `Ctrl`/`Meta + wheel` como pinch zoom. Entradas de alta frequência são acumuladas e aplicadas no máximo uma vez por frame. O zoom continua centrado no cursor e respeita os limites da câmera.

### Painel direito

O layout sempre renderizava as colunas de prévia e inspeção, sem estado de abertura. Foi adicionada uma única fonte de verdade `isRightPanelOpen`. O conteúdo permanece montado ao recolher, evitando recriar renderer, Canvas ou listeners. O viewport registra a última entrada aplicada e não reconstrói a roupa somente porque o painel foi reaberto.

## Limiares adotados

| Interação | Mouse | Caneta | Touch |
|---|---:|---:|---:|
| clique/tap | 4 px | 5 px | 9 px |
| mover peça | 3 px | 4 px | 9 px |
| mover ponto | 1,5 px | 2 px | 6 px |
| mover alça | 1,5 px | 2 px | 6 px |
| iniciar pan | 3 px | 4 px | 7 px |
| caixa de seleção | 6 px | 7 px | 12 px |

Pan primário começa em região vazia. `Shift + arrastar` em região vazia mantém a seleção por caixa. A ferramenta Mão, botão central e Espaço continuam iniciando pan explícito.

## Painel e acessibilidade

- botão permanente para recolher ou mostrar o painel;
- botão interno de recolhimento;
- texto específico `Voltar à bancada` no mobile;
- `aria-expanded`, `aria-controls`, tooltip e foco visível;
- bancada expande sem refazer o enquadramento da câmera;
- safe areas consideradas no controle mobile;
- o mesmo viewport é preservado entre fechamentos.

## Arquivos alterados

- `apps/web/src/editor/PatternCanvas.tsx`;
- `apps/web/src/editor/canvasGestures.ts`;
- `apps/web/src/editor/canvasGestures.test.ts`;
- `apps/web/src/editor/canvasWheelNavigation.ts`;
- `apps/web/src/editor/canvasWheelNavigation.test.ts`;
- `apps/web/src/App.tsx`;
- `apps/web/src/viewport/GarmentViewport.tsx`;
- `apps/web/src/styles.css`.

## Verificações

- `npm run typecheck`: aprovado;
- `npm test`: aprovado;
- `npm run build`: aprovado;
- pointer capture e continuidade do arraste: aprovados;
- arraste individual e múltiplo com undo/redo: aprovados;
- pan vazio e ferramenta Mão: aprovados;
- perfis de wheel de mouse e trackpad: aprovados em Chromium;
- pinch touch: aprovado por eventos touch nativos do Chromium;
- toggle repetido do painel: aprovado sem múltiplos canvases;
- layouts 1366×768, 1920×1080, 390×844 e 844×390: aprovados.

| Cenário | Resultado | Erros de console |
|---|---|---:|
{scenarios}

## Evidências

As capturas e relatórios estão em `docs/evidence/ui-regression-fix/`:

- `desktop-1366-single-piece-drag.png`;
- `desktop-1366-multi-piece-drag.png`;
- `desktop-1366-right-panel-closed.png`;
- `desktop-1366-right-panel-open.png`;
- `desktop-1920-right-panel-open.png`;
- `desktop-1920-right-panel-closed.png`;
- `mobile-390-right-panel-open.png`;
- `mobile-390-editor-restored.png`;
- `mobile-844x390-editor.png`;
- `ui-regression-audit.json`;
- `ui-regression-audit.md`.

## Limitações restantes

**Trackpad físico não foi validado neste executor.** A auditoria reproduziu sequências de `WheelEvent` do Chromium com `deltaMode`, deltas pequenos, grandes, diagonais e modificadores, mas isso não substitui um notebook real. Portanto, esta entrega não afirma inspeção física de trackpad.

A inspeção mobile foi executada em Chromium automatizado nos viewports solicitados, incluindo eventos touch e pinch nativos. Não houve teste em iPhone, Safari ou aparelho físico nesta execução.

Nenhuma atividade do Prompt 5 foi iniciada.
'''
Path("docs/progress/UI_REGRESSION_FIX_POST_PROMPT_04.md").write_text(content, encoding="utf-8")
