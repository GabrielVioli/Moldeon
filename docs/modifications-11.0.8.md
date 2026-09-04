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


## Fases F–H implementadas para gate manual

Após a aceitação visual da Fase E, o authoring foi ampliado sem tocar `physics/**`:

- **Fase F — arc-length + ranges parciais:** o hit 2D e o hit 3D agora preservam o parâmetro `t` exato da borda material; ranges parciais continuam usando `EdgeRange(startT/endT)` e o compiler físico existente continua resolvendo a correspondência pelo comprimento acumulado da chain.
- **Fase G — Free Sewing:** modo `Livre` usa dois toques/clicks na mesma borda para marcar início e fim. O range resultante é canônico, funciona em 2D ou 3D e preserva `PanelInstanceV3` quando a seleção veio do 3D.
- **Fase H — 1:N / N:M:** modo `Vários trechos` mantém Side A aberto até `Concluir lado A`, acumula Side B e usa `Revisar costura` antes do commit. Ordem autoral dos `EdgeRange[]` é preservada e os bindings físicos permanecem explícitos.
- Segment Sewing rápido 1:1 continua sendo o caminho padrão e não ganhou passos extras.
- Sair de `Costurar` agora também limpa draft/proposal/free-endpoint transitórios, sem alterar seams já confirmadas.
- UI mostra comprimento material acumulado de A/B durante chains e feedback do primeiro endpoint no Free Sewing.

Gate humano necessário antes de Fase I/J:

1. Segmento 1:1 continua funcionando em dois clicks/taps.
2. Livre: dois pontos na mesma borda produzem apenas o subrange entre eles.
3. Testar Livre 2D→3D e 3D→2D.
4. `Vários trechos`: 1:N e N:M preservam a ordem visual e geram threads coerentes.
5. `same/opposite` e `Inverter direção` continuam coerentes após ranges parciais/chains.
6. Threads não aparecem fora dos ranges selecionados.
7. Painéis costurados continuam se movendo juntos; componentes não relacionados continuam independentes.
8. Costurar continua com XPBD OFF.

Não iniciar STEP-0 antes deste gate.


---

## Refinement checkpoint after Phase H (11.0.8 authoring polish)

This pass audits the Phase A-H implementation before the next manual gate. It deliberately does **not** start Phase J STEP-0 and does not touch `physics/**`.

### Revision isolation

`ResolvedAssemblyInput` now owns a dedicated `sewingRevision`.

- `geometryRevision` contains geometry/physical-instance identity only.
- `sewingRevision` contains canonical SeamGroup changes.
- `arrangementRevision` remains placement/body-measurement driven.
- `simulationRevision` includes `sewingRevision`, so Provar still rebuilds when sewing changes.

In Montar/Costurar a seam-only edit no longer invalidates geometry or asks the Assembly Worker to rebuild topology/meshes. `ThreeViewport.updateSewingRelationships()` recompiles only stitch correspondence against the already-built PanelInstances.

### Edit Sewing and inactive relationships

Inactive SeamGroups stay in the resolved authoring document. The physical compiler continues to skip `active=false`, while the 3D overlay may render the same canonical correspondence in gray for editing. This separates semantic existence from physics participation.

3D relationship threads are now selectable outside the Costurar tool and bridge back to the shared `selectedSeamId`. The selected relationship receives a high-contrast overlay; confirmed groups use a deterministic vertex-color palette without allocating one material per group.

### Show / hide connections

The 3D viewport has a compact `Mostrar conexões` / `Ocultar conexões` control. Thread visibility is a UI preference and never changes `SeamGroupV3.active`. Entering Costurar turns relationships on by default; the preference may remain outside the tool.

### Hot-path cleanup

Sewing edge hover no longer rewrites every edge/thread/notch BufferGeometry on each pointermove. Edge hit testing uses the cached world-space overlay. During authored 3D movement only thread/notch positions are refreshed, so relationship lines follow panels without remeshing or invoking the worker.

The stale ordering in the initial assembly response was also removed: authored arrangement transforms are applied before sewing overlays are finalized.

### Editor transaction cleanup

Group edits now use `updateSeams()` / `removeSeams()` so a multi-part relation is one history command instead of N full document clones. The seam name field keeps an in-UI draft and commits on blur/Enter instead of creating a history snapshot on every keystroke.

Confirmed seams also persist explicit canonical defaults (`distribution`, `targetRatio`, `slackMm`, `active`) rather than depending on projection defaults.

### Material length visibility

Existing seam rows and the proposal review show canonical 2D material lengths for Side A/Side B plus signed delta in mm and percentage. A mismatch receives visual emphasis but remains authorable.

### Focused regressions added

- seam reverse/active changes keep `geometryRevision` and `arrangementRevision` stable;
- `sewingRevision` and `simulationRevision` change;
- inactive SeamGroup remains persisted but produces zero active physical stitch constraints;
- grouped seam editing is one undoable transaction;
- edge visibility and thread visibility are independent.

### Manual gate still required

This checkpoint must still be validated manually for Segment, Free, mixed 2D/3D, N:M, direction, inactive visualization, 3D thread selection and mobile portrait/landscape. Phase J STEP-0 remains intentionally pending until that interaction gate is accepted.


## CLO-like sewing polish after manual gate

Manual feedback showed that canonical sewing relationships were correct, but
opposite-oriented panels rendered as giant X-shaped fans. This pass keeps the
physical A(u) <-> B(u)/B(1-u) correspondence untouched and introduces a
rendering-only pairing that chooses the shorter B-side display order. Direction
continues to be communicated by canonical notches/arrows, never by mutating the
physical bindings.

Free Sewing UX is now explicit: it states that only a subrange is being sewn,
shows the current side A/B and step 1/2 or 2/2, and instructs the user to click
start and end on the same edge without dragging. Proposal review now reports
Segmento/Livre/Vários trechos, range counts, direction, treatment and material
length delta before confirmation.

Additional polish in the same checkpoint:
- overlay BufferAttributes reuse capacity and rely on drawRange;
- seam editor controls stack in the narrow side panel instead of forcing
  horizontal scrolling;
- target ratio and slack commit on blur/Enter rather than every keystroke;
- no-op grouped seam edits are ignored;
- treatment edits keep the legacy field and canonicalTreatment synchronized
  (`stretch` projects canonically as `elastic`).

No XPBD, physics/**, garment-specific inference or STEP-0 behavior was added.


---

## Fase J — STEP-0 geométrico para gate manual

Foi adicionada uma ação **Ajustar montagem** no viewport 3D. Ela é deliberadamente explícita: não roda automaticamente ao confirmar uma seam e não liga XPBD.

Fluxo:

1. resolve o `connected component` físico a partir dos stitch constraints ativos (darts não conectam painéis);
2. exige `PanelInstanceV3` com placement manual/confirmado;
3. recusa componentes cujo painel esteja longe demais do `HumanBodyModel.visualMesh`;
4. usa o Assembly Worker em modo `step0`, que chama o solver geométrico coarse/isometric já existente e separado de XPBD;
5. registra rigidamente a solução do solver no frame mundial do painel-raiz atual, sem escala, mantendo o placement manual como autoridade;
6. aplica somente os painéis do componente alvo ao workspace atual;
7. executa conform corporal local e limitado usando `adjustMeshToBodySurface`, sem restaurar o molde flat e sem gravar deformação em `PatternDefinitionV3`;
8. qualquer pequena translação normal feita pelo conform é baked na geometria runtime, preservando o transform rígido authored do painel;
9. atualiza threads/notches a partir da mesma relação canônica e mantém `simulationStatus=disabled-in-montar`.

Guard rails:

- nenhum arquivo em `physics/**` é alterado;
- `step0` usa Assembly Worker, não `XpbdWorkerClient`;
- sem gravidade, velocidade, timestep ou auto-dress;
- sem inferência por nome/template/role;
- sem autoscale;
- selected seam tem prioridade; se ela estiver inativa/sem constraint física, não há fallback silencioso para outra seam;
- resultado é rejeitado se exigir deslocamento de centroide > 450 mm em relação ao placement manual;
- mudanças de geometry/sewing/arrangement durante o solve invalidam o resultado como stale;
- painel longe do corpo é recusado antes do solve.

### Gate manual J1/J2

1. Camiseta frente/costas próximas ao torso: costurar laterais/ombros e clicar `Ajustar montagem`.
2. Verificar que bordas costuradas se aproximam e os painéis começam a formar um volume sem simulação.
3. Frente continua na frente e costas continuam atrás; nenhuma peça atravessa o corpo para buscar caminho curto.
4. Escala permanece 1 e o molde não encolhe para fechar seam.
5. Saia/calça: laterais devem aproximar ao redor do quadril/pernas mantendo placement.
6. Componente desconectado fica imóvel.
7. Peça deliberadamente longe do corpo retorna `Aproxime os painéis do corpo antes de ajustar a montagem.`
8. Repetir STEP-0 deve permanecer estável, sem segundo salto grande.
9. Depois do STEP-0, mover/girar manualmente ainda funciona e as threads acompanham.
10. Durante todo o gate, física/XPBD permanece OFF em Montar/Costurar.

Não avançar para 11.0.9 antes deste gate humano.


## Manual gate repair: placement-safe local STEP-0

The first visual gate exposed an architectural failure: the coarse isometric
solution was registered from one root panel and that root registration was then
applied to every connected panel. That made the solver's legacy relative pose
authoritative over manual 3D arrangement, allowing a back skirt panel to move
to the front of the body. Body conform happened only after that destructive
move, so it could not recover the authored hemisphere. The same global solve
also made the explicit action unnecessarily slow.

The gate now uses a bounded local projection starting from the currently visible
mesh geometry. Every PanelInstance keeps its own Object3D transform; only local
vertex geometry may change. Current structural edge lengths are restored every
iteration, seam constraints attract canonical correspondence points, per-vertex
movement is capped, per-panel centroid drift is capped, and the result is not
committed until body-side, penetration, material and seam-residual audits pass.
Any unsafe result restores the exact pre-click meshes atomically. The body
surface normal selected before the solve remains a hemisphere guard after the
solve, so front/back cannot silently swap.

This path does not invoke the expensive coarse candidate Worker and never starts
XPBD. It is intentionally incremental: when a complex garment cannot close
safely inside the local displacement cage, it keeps the manual arrangement and
reports the refusal instead of purchasing seam closure with a teleport.
Undo/redo of seam authoring remains outside this repair pass per the manual gate.
