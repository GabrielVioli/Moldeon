# Moldeon 11.0.8 — checkpoint pós-Fase E

## Estado atual

- Branch: `recovery/11.0.8-sewing-2d-3d-authoring`.
- SHA-base final/manual da 11.0.7: `c8b341075d3e2fda0b5c979b7ca13fbbfb10c27c`.
- Checkpoint funcional original das Fases A–D: `d661e7ecc06cbff22df1bff137187f16defffcea`.
- Handoff documental anterior: `f2f9ea83667baf562ce48b5369c5debbc8e3782b`.
- Patch validado de correções B–D + Fase E: `cb77e9897de17268d52cf25e3f7f7437704cf33f`.
- Os helpers one-shot usados apenas para aplicar a alteração grande do viewport foram removidos depois da validação; não fazem parte da implementação do produto.
- Próximo passo obrigatório: gate manual. Não iniciar Fase F antes dele.

## Contratos preservados

- `PatternDocumentV3` continua canônico.
- `PanelInstanceV3` continua sendo a identidade física de cada painel.
- `SeamGroupV3` continua sendo o único modelo persistido de sewing.
- `EdgeRange` continua sendo a identidade autoral compartilhada entre 2D e 3D.
- `physicalBindings` apontam para `PanelInstanceV3`, sem inferência por nome/template/role.
- `Costurar` continua com physics OFF.
- Nenhum arquivo em `apps/web/src/physics/**` foi alterado.
- XPBD, gravity, dress e body collision de `Provar` não foram ligados pelo authoring de seam.
- Escala/arrangement da 11.0.7 não foram reabertos.

## Fases A–D já implementadas

### Fase A — auditoria

Foram mapeados e reutilizados:

- `SeamGroupV3`;
- `EdgeRange`;
- `seamDraft` / proposal / review;
- `PanelTopology` e source mapping;
- `GarmentAssembly.buildGlobalStitchConstraints`;
- histórico/undo-redo existentes.

### Fase B — seleção bidirecional

- O 3D reconstrói bordas materiais a partir do source mapping.
- Hit 3D resolve a mesma identidade `EdgeRange` usada no 2D.
- 2D e 3D alimentam o mesmo `editorStore.selectSeamRange`.
- Não existe draft paralelo por viewport.
- Segment Sewing atual seleciona a borda inteira `0..1`.

### Fase C — fluxo rápido 1:1

- Primeiro click/tap = Side A.
- Segundo click/tap = Side B.
- Funciona 2D→2D, 3D→3D e misto 2D↔3D.
- Draft/proposal não persiste seam antes da confirmação.

### Fase D — threads derivados da correspondência física

- Threads confirmados vêm de `assemblyState.stitchConstraints`.
- Proposal usa o mesmo `buildGlobalStitchConstraints`.
- Não há nearest-vertex visual independente.
- `GlobalPointReference` continua sendo a base de interpolação dos endpoints.

## Gate manual `moldeon27.mp4`

O vídeo mostrou três problemas claros no checkpoint da Fase D:

1. **Threads visualmente fracos**
   - apenas poucas linhas amarelas eram distinguíveis entre os painéis;
   - amarelo tinha contraste ruim contra avatar, piso e painel;
   - a leitura não lembrava o fan de sewing threads do CLO3D.

2. **Saída de Costurar pouco explícita**
   - o botão `Costurar` permanecia ativo;
   - clicar nele novamente não encerrava o modo;
   - o usuário estava entrando em `Pence` apenas para sair de sewing.

3. **Painéis costurados não formavam unidade de movimento no arrangement**
   - o drag 3D continuava usando somente `selectedInstanceIds`;
   - o grafo de seams físicas ainda não participava da seleção de arrangement;
   - portanto uma seam confirmada não fazia seus `PanelInstanceV3` se moverem rigidamente juntos.

## Correções aplicadas após o vídeo

### 1. Threads CLO-like mais legíveis

Arquivo principal:

- `apps/web/src/viewport/SewingViewportOverlay.ts`

Alterações:

- confirmed threads mudaram de amarelo para magenta de alto contraste;
- proposal usa ciano brilhante;
- o visual agora garante um mínimo de 14 threads por par costurado e limita o batch a 48 quando necessário;
- essa densificação é **somente visual**;
- nenhuma constraint física adicional é criada;
- novos samples visuais são interpolados exclusivamente entre `GlobalPointReference`s canônicos adjacentes já produzidos pelo compiler físico;
- portanto overlay e physical correspondence continuam semanticamente ligados;
- `SewingViewportOverlay.visualThreadCount` expõe a densidade visual separadamente do número físico de constraints.

A regra é:

`physical stitch correspondence -> visual resampling -> CLO-like thread fan`

Nunca:

`nearest visual point -> thread inventado`.

### 2. Directional notches da Fase E

`SewingViewportOverlay` agora possui um terceiro batch de `THREE.LineSegments` para indicação direcional.

- Side A usa feedback visual próprio;
- Side B usa feedback visual próprio;
- a seta é derivada do começo/fim da correspondência canônica;
- em seam `opposite`, os endpoints do Side B já vêm invertidos pelo compiler e a seta consequentemente vira;
- `Reverse` altera a correspondência física existente e o próximo rebuild atualiza os notches;
- não é criado objeto/material por frame.

Diagnostics adicionados:

- `data-sewing-physical-thread-count`;
- `data-sewing-thread-count` para threads visuais;
- `data-sewing-direction-notch-count`.

### 3. Saída explícita de Costurar

Arquivo:

- `apps/web/src/components/Toolbar.tsx`

Com `Costurar` ativo:

- o próprio botão vira visualmente `Sair`;
- aria/title passam a `Sair do modo Costurar`;
- clicar nele chama `onSelectTool("select")`;
- não é necessário entrar em `Pence`, `Editar` ou outra ferramenta para encerrar sewing.

### 4. Painéis costurados movem juntos

Arquivos:

- `apps/web/src/viewport/SewingInteraction.ts`;
- `apps/web/src/viewport/GlobalThreeViewport.ts`;
- `apps/web/src/viewport/SewingInteraction.test.ts`.

Foi adicionado `connectedSewingInstanceIds`.

A função constrói o connected component usando os `instanceA/instanceB` dos stitch constraints canônicos ativos.

No arrangement:

- clicar num painel que pertence a um componente costurado seleciona o componente físico inteiro;
- translação usa o multi-select rígido já existente da 11.0.7;
- rotação usa o mesmo pivot/rigid path já existente;
- o body barrier continua sendo o mesmo caminho de grupo já validado;
- cada painel recebe seu arrangement commit;
- nenhum solver novo de roupa foi criado;
- nenhum XPBD é utilizado.

Darts são explicitamente ignorados pelo grafo de movimento porque são constraints internas do mesmo material e não devem conectar painéis independentes.

Panels pinned continuam respeitando a semântica de pin existente.

### 5. Reverse mais explícito

A ação já existente de `toggleSeamDirection` foi preservada.

No `AssemblyPanel`, a ação aparece como:

`Inverter direção`

em vez do rótulo genérico `Inverter`.

## Validação automática do patch

Workflow de aplicação/validação concluído com sucesso antes do commit funcional `cb77e9897de17268d52cf25e3f7f7437704cf33f`:

- `git diff --check`: PASS;
- `npm ci`: PASS;
- `npm run typecheck`: PASS;
- focused sewing tests: PASS;
- `SewingInteraction.test.ts`: PASS;
- `assemblyHistory.test.ts`: PASS;
- production build: PASS.

O teste de threads foi atualizado porque o contrato anterior exigia `visual threads == physical constraints`. Isso deixou de ser válido intencionalmente: agora o renderer pode mostrar mais linhas que as constraints físicas para obter a leitura CLO-like, mantendo todas elas interpoladas da correspondência canônica.

O gate valida:

- `visualThreadCount >= physical stitch constraint count`;
- geometry de thread usa o visual thread count;
- directional notches existem;
- connected component transitivo A↔B↔C funciona;
- componente desconectado fica fora;
- darts não expandem seleção;
- self/missing endpoints não quebram seleção.

## Fase E — estado

Implementado para o próximo gate manual:

- directional feedback 3D;
- notches/setas 3D;
- Reverse usando o `direction` canônico já persistido;
- `Inverter direção` exposto na UI existente;
- thread correspondence continua vindo do compiler físico;
- same/opposite continuam chegando aos stitch constraints físicos.

Ainda precisa de validação visual humana antes de marcar Fase E como aceita.

## Gate manual obrigatório agora

Validar no produto:

1. Criar seam 1:1 no 3D.
2. Confirmar que aparecem várias threads magenta/ciano, não apenas 2–3 linhas amarelas difíceis de ler.
3. Conferir que as linhas realmente percorrem a borda costurada, formando um fan de correspondência semelhante conceitualmente ao CLO3D.
4. Confirmar que `Costurar` ativo mostra `Sair` e que clicar nele encerra sewing.
5. Sair de Costurar, voltar ao arrangement e mover um painel costurado.
6. Confirmar que todos os painéis do mesmo connected component se movem juntos rigidamente.
7. Confirmar que painel não conectado não se move.
8. Girar o componente e conferir rigidez/pivot.
9. Usar `Inverter direção` e observar mudança dos notches/correspondência.
10. Confirmar que criar/inverter seam não inicia physics.
11. Confirmar que nenhum painel some.
12. Repetir pelo menos o essencial em touch/mobile se disponível.

Se algum item acima falhar, corrigir antes da Fase F.

## Ainda não implementado

- Free Sewing completo com autoria de subrange;
- Fase F completa de autoria/visualização de ranges parciais por arc-length;
- chains de authoring 1:N / N:1 / N:M completas;
- Edit Sewing completo;
- show/hide de threads como preferência;
- estados visuais finais active/inactive;
- STEP-0 incremental conform;
- performance/memory soak final;
- browser gates finais automatizados.

Observação: o compiler físico existente já usa arc-length para constraints de seam. A Fase F restante é completar o contrato de authoring/ranges parciais e seus gates, não substituir esse compiler por nearest-vertex.

## Próxima fase depois do gate

Somente se este checkpoint for aceito manualmente:

1. **Fase F** — arc-length authoring completo + partial ranges + testes same/opposite.
2. **Fase G** — Free Sewing.
3. **Fase H** — ordered chains 1:N / N:M.
4. Parar novamente para gate humano antes de Edit/STEP-0.

Não iniciar Fase F antes da aceitação manual deste checkpoint.
