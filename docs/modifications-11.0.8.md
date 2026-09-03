# Moldeon 11.0.8 — checkpoint da Fase D

## Estado do checkpoint

- Branch: `recovery/11.0.8-sewing-2d-3d-authoring`.
- SHA-base final da 11.0.7: `c8b341075d3e2fda0b5c979b7ca13fbbfb10c27c`.
- SHA do checkpoint funcional das Fases A–D: `d661e7ecc06cbff22df1bff137187f16defffcea`.
- Este documento é o handoff do código já publicado nesse SHA; o commit documental posterior não altera produto.
- `docs/chat.md` foi consultado somente como possível fonte de continuação. Não havia informação técnica adicional da 11.0.8 que justificasse copiar histórico local; este handoff é autossuficiente e não depende daquele arquivo.

## Arquitetura encontrada e preservada

- `PatternDocumentV3` permanece a fonte canônica persistida.
- `PanelInstanceV3` permanece a identidade física das cópias de painéis.
- `SeamGroupV3` continua representando sewing; nenhum modelo paralelo de costura foi criado.
- Cada lado de uma seam usa a sequência canônica de `EdgeRange`, incluindo `definitionId`, `edgeId`, `tStart` e `tEnd`.
- `editorStore` já possuía o estado transitório `seamDraft`, proposta/validação, confirmação e integração com histórico/undo-redo. Esse fluxo foi reutilizado.
- `PatternCanvasLegacy` já resolvia seleção 2D em `EdgeRange`; o 3D passou a alimentar exatamente a mesma ação de domínio.
- `PanelTopology` e o source mapping da malha fornecem `sourceSegmentId`/`edgeId`/`t`, preservando a identidade material apesar da tesselação.
- `GarmentAssembly.buildGlobalStitchConstraints` continua sendo o compilador físico canônico: resolve comprimento de arco, direção da seam, interpolação e bindings físicos.
- `GlobalThreeViewport`/`GarmentViewport` continuam responsáveis pelo ciclo de vida visual. O overlay de authoring é separado do XPBD e não altera `physics/**`.

## Arquivos alterados no checkpoint funcional

- `apps/web/src/App.tsx`
- `apps/web/src/editor/PatternCanvasLegacy.tsx`
- `apps/web/src/garment3d/GarmentAssembly.ts`
- `apps/web/src/state/editorStore.ts`
- `apps/web/src/state/assemblyHistory.test.ts`
- `apps/web/src/viewport/GarmentViewport.tsx`
- `apps/web/src/viewport/GlobalThreeViewport.ts`
- `apps/web/src/viewport/SewingViewportOverlay.ts`
- `docs/modifications-11.0.8.md`

## Fases concluídas

### Fase A — auditoria e contrato canônico

- Auditados `SeamGroupV3`, `EdgeRange`, `seamDraft`, proposta, confirmação, `PanelTopology`, source mapping e o compilador de constraints físicas.
- Confirmado que 2D e 3D podem compartilhar a mesma identidade persistente de range sem criar schema novo.
- Mantidos `PatternDocumentV3`, `PanelInstanceV3`, `SeamGroupV3`, histórico e undo/redo existentes.

### Fase B — seleção de EdgeRange no 3D

- Adicionado overlay das bordas materiais das `PanelInstanceV3` no viewport 3D.
- `SewingViewportOverlay.buildEdgeSegments` agrupa os `vertexSources` pela borda canônica e ordena os pontos pelo parâmetro `t`.
- O hit-test retorna o mesmo `EdgeRange` usado no canvas 2D e também o `PanelInstanceV3.id` físico tocado.
- A seleção 3D chama a mesma ação `selectSeamRange` do fluxo 2D; não existe draft separado por viewport.
- No escopo atual, clicar um segmento 3D seleciona o range material completo da borda (`0..1`). Ranges parciais e Free Sewing continuam pendentes.

### Fase C — fluxo rápido A→B

- No modo Segment Sewing, o primeiro clique define o lado A e o segundo define o lado B.
- Depois de A e B, a proposta/validação existente é produzida sem botão intermediário obrigatório.
- Cliques podem ser 2D→2D, 3D→3D ou mistos 2D↔3D porque todos convergem para `selectSeamRange` e para o mesmo `seamDraft` global.
- O fluxo continua sem mutar o documento enquanto é apenas proposta; a confirmação persiste `SeamGroupV3` e usa o histórico existente.

### Fase D — threads 3D canônicos e batched

- Propostas e costuras confirmadas são representadas por threads no 3D.
- Threads confirmados são derivados de `assemblyState.stitchConstraints`, portanto representam os constraints físicos efetivamente compilados.
- Threads da proposta são derivados pelo mesmo `buildGlobalStitchConstraints`, sem compilador visual paralelo e sem mutar o documento.
- Cada ponta usa a `GlobalPointReference` do constraint, com `instanceId`, vértices e pesos interpolados; direção `same/opposite` e distribuição seguem o compilador canônico.
- Não foram inferidos threads por proximidade, nomes, triangulação renderizada ou índices transitórios.

## Compartilhamento de EdgeRange entre 2D e 3D

O canvas 2D e o overlay 3D produzem a mesma estrutura de domínio. No 2D, o hit vem da geometria da definição. No 3D, `buildEdgeSegments` reconstrói a borda material a partir do source mapping da malha e associa cada segmento visual a `definitionId + edgeId + tStart/tEnd`. Ambos entregam o resultado a `editorStore.selectSeamRange`.

Assim, o viewport de origem não muda a semântica persistida. Triângulos e vértices são detalhes de resolução visual/física, enquanto `EdgeRange` continua sendo a identidade autoral.

## Bindings físicos e PanelInstanceV3

- Ao selecionar no 3D, o `instanceId` tocado é preservado no estado transitório e materializado em `physicalBindings` durante a confirmação.
- Ao selecionar no 2D, um binding pode ser materializado somente quando a definição resolve de forma inequívoca para uma única instância física.
- Se houver múltiplas instâncias possíveis no 2D, o código não inventa uma identidade física; a ambiguidade permanece explícita para evolução do authoring.
- IDs dos bindings continuam derivados do ID da seam, mantendo estabilidade e compatibilidade com o compilador existente.
- `physicalBindings` apontam para `PanelInstanceV3.id`, nunca apenas para `PatternDefinitionV3`.

## Batching, buffers e caches introduzidos

`SewingViewportOverlay` mantém dois draw calls principais com `THREE.LineSegments`:

1. um batch para bordas selecionáveis;
2. um batch para threads de proposta e seams confirmadas.

Estruturas mantidas pelo overlay:

- `edgeSegments`, com identidade material, instância e extremos locais;
- `threadSegments`, derivados dos constraints compilados;
- chave de hover/seleção ativa;
- buffers de posição e cor para os dois batches;
- geometrias e materiais compartilhados durante a vida do overlay.

Hover e atualização de pose atualizam atributos dos buffers existentes. Não foi criado worker, RAF, listener global, clone de documento ou cache global novo. A troca de `BufferAttribute` em rebuilds ainda precisa de soak/memory profiling na fase de performance.

## Testes adicionados ou ampliados

- `apps/web/src/state/assemblyHistory.test.ts`: cobertura de seleção/confirmação com binding físico e preservação por histórico/undo-redo.
- Testes existentes de `ResolvedGarmentAssembly` e `CoarseSeamConstraints`: usados para validar compilação dos constraints, bindings e correspondência física.
- Cobertura focada confirmou que o fluxo novo não altera o contrato do assembly nem o solver.

## Resultados de validação

- Baseline da 11.0.7: build PASS.
- Baseline da 11.0.7: 31 testes focados de arrangement/mobile PASS.
- Typecheck final: PASS.
- Testes focados finais: 3 arquivos, 26 testes PASS (`assemblyHistory`, `ResolvedGarmentAssembly`, `CoarseSeamConstraints`).
- Build final: PASS.
- `git diff --check`: PASS; somente avisos de conversão LF/CRLF do ambiente Windows.
- Nenhum arquivo em `apps/web/src/physics/**` foi alterado.

### Browser automático

O servidor Vite iniciou, mas o executável `agent-browser` não estava instalado/disponível no ambiente (`CommandNotFoundException`). Por isso o gate visual automatizado não foi executado. A validação manual de hit 2D↔3D, threads e interação continua necessária.

## Ainda não implementado

- directional notches;
- ação `Reverse` e sua atualização visual/física;
- gates completos de parametrização por comprimento de arco. O compilador físico canônico já usa arc-length, mas a autoria/visualização de ranges parciais ainda não está completa;
- Free Sewing;
- sewing 1:N;
- sewing N:M;
- Edit Sewing completo;
- authoring e feedback visual completos de active/inactive;
- show/hide de sewing e preview contínuo completo durante hover;
- conform incremental de STEP-0;
- gate final de performance e memória;
- validação automatizada em Chromium/mobile e WebKit.

## Dívidas e riscos conhecidos

- A tolerância de hit equivalente a aproximadamente 44 px usa a profundidade do target da câmera; deve ser validada em zoom extremo e mobile.
- `refreshPositions` ainda cria alguns vetores temporários; medir antes de otimizar.
- Rebuilds podem substituir `BufferAttribute`; validar estabilização de heap/GPU em soak test.
- Seleção 2D de uma definição com várias instâncias físicas permanece ambígua e deliberadamente não inventa binding.
- O fluxo rápido implementado é Segment Sewing de borda inteira; não deve ser confundido com Free Sewing ou ranges parciais finalizados.
- Threads de seams inativas e estados avançados ainda precisam da semântica visual da fase de edição.
- Falta o gate visual automático desta rodada; nenhuma conclusão de UX/performance deve se apoiar apenas nos testes unitários.

## Continuação exata

Primeiro arquivo: `apps/web/src/viewport/SewingViewportOverlay.ts`.

Funções/pontos iniciais:

1. `SewingViewportOverlay.rebuild` e `refreshColors`: adicionar notches direcionais e feedback de direção sem criar objetos por frame.
2. `buildThreadSegments`: preservar a derivação canônica ao exibir direção/reverse e estados active/inactive.
3. `apps/web/src/state/editorStore.ts`, ação `toggleSeamDirection`: conectar Reverse ao draft/SeamGroup e ao histórico existente.
4. UI existente em `apps/web/src/components/ContextBar.tsx` e `apps/web/src/components/AssemblyPanel.tsx`: expor Reverse/edição sem painel paralelo.
5. `apps/web/src/viewport/GlobalThreeViewport.ts`, `refreshSewingOverlay`: atualizar overlay incrementalmente após ações de edição.

Antes de editar, confirmar os nomes atuais com `rg`, pois componentes podem ter sido movidos. Não reauditar o repositório inteiro e não tocar `physics/**`.

## Ordem recomendada das próximas fases

1. Fase E: directional notches, Reverse e feedback coerente 2D/3D.
2. Fase F: parametrização completa por comprimento de arco e ranges parciais, com testes same/opposite.
3. Fase G: Free Sewing.
4. Fase H: chains compostas 1:N e N:M, preservando ordem e arc-length global.
5. Fase I: Edit Sewing, active/inactive, show/hide e histórico completo.
6. Fase J: STEP-0 incremental conform, sem XPBD oculto e sem alterar métrica 2D.
7. Fase K: gates finais de browser, performance, memória, mobile e soak.

Não iniciar qualquer fase seguinte a partir deste checkpoint sem antes validar manualmente as Fases B–D.
