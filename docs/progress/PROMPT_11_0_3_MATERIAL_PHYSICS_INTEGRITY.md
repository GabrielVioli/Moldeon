# Prompt 11.0.3 — Material Physics Integrity

Branch: `recovery/11.0.3-material-physics-integrity`

Base confirmada: `538fc750a5ee1b77786edba72025cc929421ee3f`

Status: **PRONTO PARA VALIDAÇÃO MANUAL**

## Veredito

O material 2D passou a ser a fonte autoritativa do rest state do XPBD. A pose espacial do assembly continua sendo a pose inicial, mas não redefine comprimento, área, shear ou curvatura material.

Os gates de patch livre, gravity, banda estreita, tube + sewn flap, pence frontal/traseira, presets de tecido, ausência de pins ocultos, energia de correção corporal, reset e 10.7.1/10.7.2 passaram. O gate manual visual ainda é obrigatório.

## Auditoria do rest state

| Constraint | Antes | Depois |
|---|---|---|
| Stretch | distância da pose 3D do assembly | distância em `topology.positions2DMm`, convertida para metros |
| Anisotropia | direção material, mas aplicada sobre rest length espacial | warp/weft e grainline integralmente no frame material 2D |
| Shear | cosine da pose 3D triangulada | cosine do triângulo material 2D |
| Bend | spring entre vértices opostos | hinge de quatro vértices com ângulo diedro/rest angle material por aresta interna |
| Área/orientação | sem referência material imutável | rest area e orientation por triângulo, além de referência temporal segura de normal |
| Seam | `physicalBindings` e ranges compostos | preservado; compliance e correspondência continuam canônicas |
| Pence | um par na boca + preferência visual no ápice | sequência ordenada de pares das pernas até o ápice + preferência de dobra + fechamento XPBD |

`reset` mantém os mesmos buffers materiais. `updateFabric` altera compliances de stretch/shear/bend, sem reescrever rest lengths, rest angles ou áreas. `updateGeometry` continua sendo a operação que recria a topologia/rest state.

## Causas raiz corrigidas

### Material dependente da pose

`GarmentXpbdAdapter` calculava stretch e parte do shear a partir de `state.positions`. Uma curvatura ou placement válido do assembly, portanto, podia virar um novo “tamanho de tecido”. O adapter agora deriva a métrica de `materialCoordinates` em metros e transporta os buffers imutáveis ao Worker.

### Tube + sewn flap

O limite absoluto de velocidade era derivado da menor aresta local de cada partícula. Painéis com tesselações diferentes recebiam tetos de velocidade diferentes sob a mesma gravidade; esse movimento relativo puxava a seam e fazia o residual crescer. O teto absoluto agora é global e uniforme. Os trust regions de correção continuam locais.

### Bend sem semântica de tecido

O bend anterior era uma distância entre vértices opostos. Ele acoplava dobra a tamanho e não representava curvatura. O solver agora usa hinge diedro XPBD com rest angle derivado do material 2D. `FabricPhysics.bending` controla a compliance angular e não altera comprimento de repouso.

Os hinges usam cadência multirate determinística: no mínimo duas avaliações por step (primeira/última e também a cada quatro iterações), enquanto stretch, shear, seams e o total de iterações permanecem inalterados. Nenhum hinge ou triângulo é removido.

### Pence

Uma única constraint na boca não representava as duas pernas. Agora cada pence produz pares materiais ordenados da boca em direção ao ápice. O assembly permanece isométrico; o fechamento ocorre no XPBD com a compliance normal de seam e um trust region local de pence. O ápice continua materialmente contínuo e a preferência front/back produz seeds volumétricos determinísticos sem lógica por nome de peça.

### Falsos flips

Comparar a normal atual com uma normal global do STEP0 marca uma rotação rígida de 180° como inversão. A contagem agora compara cada triângulo com o último passo metricamente seguro. Assim, movimento rígido não vira flip, mas uma reversão súbita local continua detectável.

## Metric catastrophe guard

Diagnostics públicos:

- stretch mean/max e compression min;
- shear mean/max;
- area mean/min/max;
- flips temporais;
- crescimento do AABB;
- velocidade máxima;
- métricas de stretch por `PanelInstance` e por tecido;
- pins explícitos e suportes temporários.

O guard verifica NaN/Inf, runaway distribuído de stretch/compression, colapso/explosão distribuída de área, flips catastróficos e AABB runaway. Triângulos/arestas materialmente degenerados não dominam a decisão. Fixtures pequenas continuam falhando no primeiro elemento catastrófico; malhas grandes exigem uma fração materialmente relevante.

Em falha, o Worker recebe `invalidReason="metric-instability"`, pausa, restaura o último `stablePositions`, restaura a referência segura das normais e zera velocities. A despenetração inicial do body é uma fase limitada, com gravity e velocidades zeradas; ela atualiza o ponto seguro, mas não é julgada como steady-state material.

## Body correction e gravity

O teste de energia prova que a correção posicional de contato é subtraída da velocidade reconstruída. Uma partícula em repouso não ganha velocidade de ejeção, enquanto velocidade física legítima para fora é preservada.

O fixture livre sem pins/body collision desce sob gravity. Diagnostics reportam `explicitPinCount` e `temporarySupportCount`; o adapter só cria pins quando `pinAssemblyAnchors === true` e nenhum suporte heurístico permanente foi adicionado.

## Testes

### Gates centrais

- solver/material + pence + tube/flap + calça 10.7.x: **34/34 aprovados** na repetição direcionada final;
- suíte de física paralela: **104 aprovados, 4 falhas herdadas/de integração corporal, 3 perf-only skipped**;
- suíte web completa paralela: **584 aprovados, 14 falhas herdadas/de carga paralela, 3 skipped**;
- typecheck: **aprovado**;
- build fallback: **aprovado**;
- `git diff --check`: **aprovado**;
- Edge headless: HTTP 200, `Moldeon`, conteúdo e canvas renderizados, sem overlay e sem erros de console/page.

### Casos obrigatórios cobertos

- patch gravity 0 / collision OFF: 1000 steps;
- patch gravity 100 / collision OFF;
- narrow closed band + shell gravity 0: 500 steps;
- narrow closed band + shell gravity 100: 500 steps;
- tube + sewn flap: 240 steps, residual reduz e material permanece estável;
- pence frontal e traseira: múltiplos pares, fechamento abaixo de 10 mm e seed volumétrico determinístico;
- comparação de bending rígido/flexível sem mudança do rest length;
- no-hidden-pin gravity;
- correção corporal sem energia artificial;
- rollback por `metric-instability`;
- reset e update de tecido sem mutação do rest state;
- Worker/protocol com os novos buffers materiais;
- regressões 10.7.1/10.7.2.

## Performance

Baseline publicada da 11.0.2, workload integrado de 4.900 partículas: `17,240 ms` por physics step com body collision.

Resultado final dedicado da 11.0.3, já com os **10.698 hinges diedros reais** no lugar dos springs legados:

- physics step: `19,131 ms`;
- body collision: `1,524 ms`;
- 12.678 stretch, 7.792 shear, 10.698 dihedral hinges, 248 seams, 8 iterations e 12 colliders;
- broadphase reject rate: `88,83%`;
- candidates/query: `1,34`.

Regressão total: aproximadamente **11,0%**, abaixo do limite de 20%. Não houve redução de partículas, malha, hinges, seams, iterations, gravity ou CCD.

## Blockers herdados da 11.0.2

| Blocker | Situação nesta branch |
|---|---|
| timeouts G5/G6/G24 e pants em execução paralela | permanecem como limite de tempo/carga; gates funcionais passam isoladamente |
| pants STEP 1/10/60/240 | funcionalmente aprovado no gate direcionado |
| residual 10.7.2 de calça | gate direcionado aprovado |
| auditoria `waistTop < centroid` | permanece; é placement/body e pertence ao Prompt 11.0.4 |
| torso com registration residual de 166 mm | o guard detecta stretch runaway após a colisão e pausa; corrigir placement no 11.0.4, não afrouxar material |
| tube + sewn flap | corrigido pela causa raiz do velocity cap |

Na suíte paralela final também apareceram timeouts de 5/20/30/120 s e `assemblySolveMs` acima de 500 ms. A geometria, a distorção intrínseca e os gates materiais passaram nas repetições direcionadas. Nenhum threshold de assembly foi relaxado.

## Checklist manual

1. Abrir a mesma saia com cós/faixa estreita usada na evidência anterior.
2. Em collision OFF e gravity 0, clicar Reiniciar e avançar até pelo menos 500 steps.
3. Confirmar que cós e corpo preservam largura, comprimento e leitura tubular, sem novelo, crescimento ou colapso.
4. Em collision OFF e gravity 100, Reiniciar e confirmar que a roupa cai sem levitar, mantendo tamanho e área reconhecíveis.
5. Abrir uma peça simples com pence frontal; confirmar aproximação das duas pernas, ápice contínuo e volume na direção esperada.
6. Repetir com pence traseira; confirmar direção oposta coerente.
7. Repetir tube + sewn flap e confirmar que a costura não abre progressivamente.
8. Comparar tecido rígido e flexível: a dobra deve mudar, o tamanho não.
9. Observar a telemetria DEV: `invalid=false`, pins explícitos corretos, temporary supports 0 e ausência de runaway persistente.

Não foi iniciado trabalho do Prompt 11.0.4.
