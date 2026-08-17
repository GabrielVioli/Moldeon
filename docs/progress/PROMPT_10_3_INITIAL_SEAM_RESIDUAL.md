# Prompt 10.3 — Residual inicial das costuras

## Status

**PRONTO PARA VALIDAÇÃO MANUAL.**

Branch: `recovery/10.3-initial-seam-residual`.

Base exata validada do Prompt 10.2: `7a7041c14909de14790db3c906d2fa31783ec58d` (`feat: add XPBD diagnostic controls`).

Nenhuma mudança foi feita na `main`.

## Sintoma observado

Em uma roupa multipainel real, a pose inicial aparentava estar montada de forma razoável, mas os diagnostics mostravam antes do avanço da física aproximadamente:

- `seamMeanErrorMm ≈ 183,64 mm`;
- `seamMaxErrorMm ≈ 559,21 mm`.

Após alguns physics steps o residual diminuía, porém a região superior sofria deformação intensa. Uma captura posterior mostrou, aproximadamente, `5972` partículas, `9482` triângulos, `374` seam constraints, `seamMeanErrorMm = 55,87`, `seamMaxErrorMm = 330,54`, `physicsStepMs = 220,82` e `FPS = 4,69`.

A hipótese de trabalho foi, portanto, que o XPBD podia estar reagindo corretamente a uma condição inicial espacial incorreta. Compliance, timestep, iterations, damping, gravidade, tolerância e rest distance das seams não foram usados para mascarar o sintoma.

## Metodologia de auditoria

Foi adicionada uma auditoria por `SeamGroup` que preserva a distinção entre distância espacial, rest distance físico e residual. Para cada grupo ela registra:

- `SeamGroup`, seams, treatment, direction, instâncias e PatternDefinitions envolvidos;
- EdgeRanges ordenados dos dois lados e comprimentos materiais acumulados;
- quantidade de samples, média e máximo;
- pior sample com range, ordem, arco local/global, `t`, particle indices, interpolation weights e posição 3D avaliada nos dois lados.

A mesma correspondência é então comparada em três pontos concretos do pipeline executável, além da semântica material do documento:

1. `PatternDocumentV3 / ResolvedAssemblyInput`: ranges e correspondência material canônica;
2. pós `initial spatial assembly`: posição espacial das references canônicas;
3. `GarmentXpbdAdapter`: exatamente as references interpoladas que são serializadas nos TypedArrays;
4. estado XPBD inicial usado pelo Worker: residual calculado com o buffer que existe antes do primeiro step.

O adapter também mede explicitamente o salto de correspondência entre assembly e TypedArrays. Um salto grande localizaria o bug em remesh/source mapping/offsets; igualdade numérica entre adapter e Worker exclui serialização e offsets do Worker como origem.

## Causa raiz

O problema reproduzido nasceu no **initial spatial assembly**, especificamente quando duas subestruturas tubulares materialmente válidas coexistiam no mesmo garment, como corpo + faixa superior.

Cada tubo era construído corretamente por conta própria, mas escolhia sua fase angular de forma independente. O algoritmo do Prompt 10.1 que conectava uma subestrutura tubular auxiliar à casca já posicionada fazia apenas uma translação média pelas correspondências da seam. Assim, duas argolas podiam parecer concêntricas e visualmente plausíveis enquanto os pontos materiais que deveriam ser costurados estavam angularmente deslocados, no fixture reproduzido por quase `180°`.

O XPBD recebia essa condição e fazia o comportamento esperado: puxava as seams para fechar um gap que já nascera no assembly. Não foi encontrado salto relevante no `GarmentXpbdAdapter`, nos offsets globais ou no Worker.

A lacuna dos testes anteriores era que o caso corpo + faixa validava identidade, reconhecimento das duas cascas e estabilidade geral, mas não media o residual espacial da seam composta que conecta os dois loops.

## Correção

Subestruturas tubulares disjuntas ligadas por seam estrutural agora são alinhadas rigidamente em duas etapas:

1. calcula-se a diferença de fase angular a partir das correspondências reais da seam, ao redor do eixo tubular;
2. aplica-se rotação rígida ao grupo inteiro e, depois, a translação média residual.

No fixture de reprodução a correção foi aproximadamente:

- rotação rígida: `-3,141592542 rad`;
- translação: `[2,47e-9, 1,57e-8, 0,004332] m`, isto é, cerca de `4,33 mm` no eixo relevante.

Não há snap por partícula, escala, teleporte individual, alteração do 2D ou relaxamento do solver. `PatternDocumentV3` permanece canônico.

Seams de `dart`, `ease`, `gather`, `stretch`, intentional mismatch, `ratio != 1` ou slack relevante não entram nessa correção rígida como se fossem alinhamentos estruturais. A auditoria classifica separadamente `structural-alignment`, `local-shaping-closure` e `intentional-mismatch`.

## Evidência por estágio

Fixture: `spatial-notched-tube-waistband`.

SeamGroup estrutural mais afetado no fixture: `spatial-notched-tube-waistband:composite-top`, com `43` samples.

| Estágio | Mean residual | Max residual | Interpretação |
| --- | ---: | ---: | --- |
| Assembly antes da correção | `168,033 mm` | `173,329 mm` | residual introduzido incorretamente pela fase espacial entre os dois tubos |
| Assembly depois da correção | `18,773 mm` | `26,162 mm` | subestruturas rigidamente alinhadas sem deformar o molde |
| Adapter | `20,273 mm` | `27,662 mm` | mesma correspondência material; diferença inclui a semântica física de rest distance existente |
| Worker inicial | `20,273 mm` | `27,662 mm` | idêntico ao adapter antes do primeiro physics step |

O maior salto de **distância espacial** assembly → adapter foi `0,0000547 mm`, compatível com ruído numérico. Portanto, remesh/source mapping, `particleOffset`, `localIndex/globalIndex` e serialização do Worker não introduziram o residual grande neste caso.

A diferença de cerca de `1,5 mm` entre o residual pós-assembly e o residual físico adapter/Worker não corresponde a mudança de particle reference. Ela vem da semântica de rest distance usada pelo pipeline físico; a distância espacial é preservada.

O grupo de fechamento local diagonal do mesmo garment é classificado como `local-shaping-closure` e não é artificialmente forçado a zero.

## Invariants DEV

Foram adicionadas falhas explícitas em DEV para detectar:

- particle global fora do range;
- particle que não pertence à `PanelInstance` declarada;
- mismatch entre quantidade de índices e pesos;
- pesos não finitos/negativos ou soma incompatível com `1`;
- posições não finitas;
- `EdgeRange` inexistente na topologia da instância;
- `t` e progress fora de `[0,1]`.

O fixture complexo terminou com `invariantErrors = []`.

## Zero gravity e primeiro step

O teste killer inicializa o garment com gravidade zero e velocities zero, executa exatamente um timestep XPBD e verifica deslocamento máximo, finitude e distorção estrutural. Passou sem kick estrutural catastrófico.

O teste de 60 steps em gravidade zero também permaneceu finito. O residual estrutural convergiu para faixa submilimétrica. O critério não exige queda estritamente monotônica a cada janela porque, já abaixo de `0,5 mm`, há pequenas oscilações numéricas; exige redução forte em relação ao estado inicial, limite absoluto submilimétrico e ausência de distorção estrutural explosiva.

## Arquivos principais

- `apps/web/src/garment3d/InitialSeamResidual.ts`: auditoria por SeamGroup, invariants e alinhamento rígido de fase entre tube groups;
- `apps/web/src/garment3d/SemanticAvatarArrangement.ts`: auditoria antes/depois e aplicação da correção rígida no initial assembly;
- `apps/web/src/physics/GarmentXpbdAdapter.ts`: prova de continuidade das references até os TypedArrays;
- `apps/web/src/physics/xpbd.ts`: diagnostics de seam por grupo usando o estado real do solver;
- `apps/web/src/viewport/GlobalThreeViewport.ts`: exposição DEV da auditoria de assembly/adapter;
- `apps/web/src/viewport/GarmentViewport.tsx`: lista DEV dos SeamGroups ordenados por residual;
- `apps/web/src/physics/initialSeamResidual.test.ts`: fixtures e regressões específicas do Prompt 10.3;
- `apps/web/src/physics/XpbdWorkerClient.test.ts`: fixtures adaptadas aos novos diagnostics.

## Testes e validação

Workflow dedicado do Prompt 10.3 concluído com sucesso:

- novos testes 10.3: `9/9`;
- regressões focadas de assembly/XPBD: `28/28`;
- suíte web completa: `68` arquivos / `477` testes;
- typecheck: aprovado;
- build fallback: aprovado;
- `cargo fmt --all --check`: aprovado;
- `cargo clippy --workspace --all-targets -- -D warnings`: aprovado;
- `cargo test --workspace`: `3/3`;
- `git diff --check`: aprovado;
- smoke real em Chromium headless: aprovado, página carregada com conteúdo e sem `console.error`/`pageerror`;
- scripts/workflow temporários usados apenas para a execução remota foram removidos antes do commit de implementação.

O `npm ci` reportou uma vulnerabilidade de dependência de severidade alta já presente no conjunto instalado; não foi alterada nesta etapa porque não tem relação com o residual e a tarefa proíbe desviar para trabalho não relacionado.

## Performance

Nenhuma otimização de performance foi feita nesta branch.

Os números do caso manual continuam registrados apenas como baseline aproximado:

- `5972` particles;
- `9482` triangles;
- `15449` stretch constraints;
- `9482` shear constraints;
- `12997` bend constraints;
- `374` seam constraints;
- `physicsStepMs ≈ 200–260 ms`;
- `FPS ≈ 3–5`.

Esses números são um problema separado e permanecem para a etapa de performance.

## Limitações restantes

- O garment real que originou `183,64 / 559,21 mm` precisa ser reaberto manualmente nesta branch para confirmar a redução no documento específico do usuário; o fixture automatizado reproduz a mesma classe estrutural, não os mesmos IDs/material exatos do documento manual.
- O fixture ainda começa com cerca de `20–28 mm` de residual físico no SeamGroup de união entre loops, em vez de zero. A auditoria demonstra que esse valor não surge no adapter ou Worker e ele converge de forma estável sob gravidade zero; a validação manual deve confirmar que o gap remanescente é coerente com a construção desejada.
- Não houve alteração de self-collision, chão, colisão com avatar ou performance.
- O workflow legado `.github/workflows/recovery-zero-workspace.yml` pode continuar sinalizando branches de recovery por regras anteriores; ele não fez parte da validação dedicada desta correção.

## Checklist manual

1. Abra o mesmo garment multipainel que apresentou o blocker e entre em `Provar` com a simulação pausada.
2. Em DEV, confira os SeamGroups ordenados por residual e compare os maiores grupos com a auditoria inicial.
3. Use gravidade `0%`, `Reiniciar` e execute exatamente um `Passo`; confirme ausência de implosão/pico imediato.
4. Continue até `30` e `60` steps em gravidade zero e confirme que corpo e faixa permanecem reconhecíveis e que pences/local closures afetam somente suas regiões.
5. Reinicie, use gravidade `25%` e slow motion; confirme deformação gradual.
6. Teste undo/redo + rebuild e confirme que o residual volta deterministicamente, sem seam ghost.
7. Confirme visualmente que nenhum painel desaparece, coincide com outro ou cria giant triangle.
8. Confirme que o `PatternDocumentV3`/molde 2D não muda durante a simulação.

Não houve merge na `main`, otimização de performance, chão, avatar collision, self-collision ou início do Prompt 11.