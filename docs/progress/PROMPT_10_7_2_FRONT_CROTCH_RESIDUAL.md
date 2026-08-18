# Prompt 10.7.2 — Front Crotch Residual Microfix

## Base e escopo

- Base exata: `026cbd77ac4b1c232f727c087c1d05504aba79b8` (`recovery/10.7.1-waistband-boundary-binding`).
- Branch: `recovery/10.7.2-front-crotch-residual`.
- Fixture usada diretamente: `apps/web/src/testFixtures/realDocuments/real-pants.v3.json`.
- Nenhuma alteração em `main`.
- Nenhuma alteração em CoarseAssemblyMesh, ARAP/objective, XPBD kernels, Worker architecture, PatternDocumentV3, physical binding canônico ou no fix de boundary orientation do 10.7.1.

## 1. Root cause exata

O erro era a **ordem de travessia material de uma SeamGroup composta**. `GarmentAssembly.buildGlobalStitchConstraints` recebia `firstRanges`/`secondRanges` como arrays e tratava a ordem de criação/inserção do array como se fosse necessariamente a ordem material contínua da costura.

Na FRONT real, um lado de `seam-6e42b318-8607-44f0-8353-f0fca3ac48b5` contém duas EdgeRanges válidas individualmente, com `edgeId`, `startT=0` e `endT=1` corretos, mas armazenadas fora da única ordem topologicamente contínua. O fim da primeira range na ordem persistida e o início da seguinte estavam separados em cerca de **200.40 mm** no material. A parametrização por accumulated arc-length atravessava esse salto e passava a emparelhar pontos fisicamente diferentes.

O 10.7.1 continua correto: ele resolveu orientação de traversal dentro de cada edge no PanelTopology. O 10.7.2 resolve a camada seguinte, isto é, a concatenação de múltiplas EdgeRanges canônicas em uma única seam composta.

## 2. Fronteira onde o erro nascia

O erro nasce em **GarmentAssembly, antes do coarse seam mapping**, durante a criação das `AssemblyStitchConstraint`s por progresso material acumulado.

`CoarseSeamConstraints` recebe as referências materiais já escolhidas e não recria top/bottom. O `GarmentXpbdAdapter` preserva a correspondência com jump máximo de aproximadamente `0.0000207 mm`, e o Worker STEP 0 reproduz os mesmos resíduos do Adapter. Portanto Adapter, serialização e Worker não são a origem.

## 3. FRONT vs BACK antes

Baseline automatizado na fixture V3 real, antes da normalização da sequência composta:

| Fronteira | FRONT mean / max | BACK mean / max |
|---|---:|---:|
| Assembly | 98.792 / 149.189 mm | 61.691 / 103.454 mm |
| Adapter | 100.292 / 150.689 mm | 63.191 / 104.954 mm |
| Worker STEP 0 | 100.292 / 150.689 mm | 63.191 / 104.954 mm |

O BACK não prova que a ordem persistida estava correta. Seus dois lados possuíam ordering não contínuo de forma complementar e, com `direction=opposite`, parte do erro se cancelava no pareamento. Esse A/B foi justamente o indício que revelou a assimetria de parametrização.

O valor manual informado antes desta etapa, depois de centenas de steps com gravidade 0%, era FRONT ~`24.78 / 109.59 mm` e BACK ~`0.28 / 3.21 mm`.

## 4. Correção

Foi adicionada uma função pura, `orderCompositeEdgeRangesByContinuity`, usada apenas como **view runtime** da sequência composta.

Regras:

- nunca muta PatternDocumentV3;
- nunca inverte uma EdgeRange;
- preserva `pieceId`, `edgeId`, `startT` e `endT`;
- só tenta reordenar quando todas as ranges pertencem à mesma PatternDefinition;
- só reordena quando existe exatamente uma cadeia contínua por endpoints canônicos;
- sequências N↔M, ranges parciais, chains ambíguas ou não resolvíveis mantêm a ordem persistida.

Não existe `if pants`, `if front`, `if crotch`, semantic role, nome de peça, offset, snap ou regra por eixo.

## 5. Comprimentos materiais

FRONT (`calca` ↔ `calca – espelhada`):

- first: `237.945491479519 mm`
- second: `237.945491479519 mm`
- mismatch: `0 mm`
- mismatch: `0%`
- ratio: `1.0`

BACK (`atras` ↔ `atras – espelhada`):

- first: `222.867624915812 mm`
- second: `222.867624915812 mm`
- mismatch: `0 mm`
- mismatch: `0%`
- ratio: `1.0`

Portanto não existe incompatibilidade material real que justifique residual de dezenas/centenas de milímetros.

Depois da ordenação runtime, os junction gaps internos FRONT e BACK são `~0 mm`, a accumulated arc-length é contínua e o progresso permanece monotônico. Os EdgeRanges individuais continuam com a direção canônica original.

## 6. Comparação depois — Assembly / Adapter / STEP 0

Na mesma fixture real, com somente o microfix de ordering:

| Fronteira | FRONT mean / max | BACK mean / max |
|---|---:|---:|
| Assembly | 71.944 / 106.606 mm | 66.167 / 104.918 mm |
| Adapter | 73.444 / 108.106 mm | 67.667 / 106.418 mm |
| Worker STEP 0 | 73.444 / 108.106 mm | 67.667 / 106.418 mm |

O Assembly coarse/isométrico continua sendo um **initial seed**, não uma projeção de seam residual zero. A correção desta etapa não reescreve esse solver. O sinal decisivo é que a correspondência material agora é contínua e o sistema físico passa a convergir, em vez de permanecer estruturalmente preso no pareamento errado.

## 7. Gravity 0 — convergência

| Steps | FRONT mean / max | BACK mean / max |
|---:|---:|---:|
| 1 | 71.329 / 107.090 mm | 65.513 / 105.108 mm |
| 60 | 51.036 / 142.707 mm | 72.945 / 182.123 mm |
| 240 | **5.163 / 43.316 mm** | **5.836 / 47.772 mm** |
| 480 | **1.045 / 9.736 mm** | **0.465 / 5.641 mm** |

Uma medição exploratória adicional em 720 steps encontrou FRONT `0.323 / 5.133 mm`. O BACK apresentou oscilação posterior em um corner compartilhado, portanto 480 é o checkpoint mais útil para comparar convergência estável nesta investigação.

## 8. Por que ainda existe max maior em STEP 240

O pior residual em 240 não fica no junction interno das duas curvas. Ele fica em um **endpoint externo do gancho compartilhado com outra SeamGroup estrutural**. Os particles envolvidos também pertencem às seams `seam-6c52750c-db50-4f8d-ad9e-fa66046fb0d9` e `seam-ebea66a7-d80b-48a5-8852-271838401856`.

Esse corner é um encontro legítimo de múltiplas costuras. O residual cai naturalmente para single-digit sem mudar compliance, iterations, timestep ou relaxation, portanto não foi mascarado nem tratado com tuning especial.

## 9. Geometria e coarse binding

O regression real registra, para FRONT e BACK:

- piece names e physical PanelInstance IDs;
- EdgeRanges, edgeIds, startT/endT;
- comprimento de cada curva e accumulated arc-length;
- posições e tangentes nos endpoints/junctions;
- sample count e progresso;
- coarse material coordinates;
- coarse triangle IDs;
- barycentric weights e vertex IDs;
- posição 3D inicial;
- normal local da coarse surface.

Isso demonstra que o fix não seleciona borda por proximidade ou por semântica de roupa.

## 10. Arquivos finais alterados

1. `apps/web/src/garment3d/CompositeEdgeRangeOrder.ts`
2. `apps/web/src/garment3d/GarmentAssembly.ts`
3. `apps/web/src/garment3d/InitialSeamResidual.ts`
4. `apps/web/src/garment3d/realPantsFrontCrotchResidual.test.ts`
5. `docs/progress/PROMPT_10_7_2_FRONT_CROTCH_RESIDUAL.md`

## 11. Teste adicionado

`realPantsFrontCrotchResidual.test.ts` carrega **diretamente** `real-pants.v3.json`. Não existe calça sintética de substituição.

O teste diferencial garante:

- FRONT e BACK continuam structural seams;
- physical bindings explícitos são preservados;
- ranges compostas viram uma cadeia contínua sem alterar identidade/t;
- accumulated arc-length/progresso é monotônico;
- não existe mismatch material;
- o documento V3 canônico não é mutado;
- coarse material bindings permanecem rastreáveis;
- Adapter não cria jump;
- Worker STEP 0 não cria jump;
- STEP 1/60/240/480 permanece finito e converge sem tuning.

## 12. Invariantes e ausência de regra semântica

Preservados: explicit physical binding, manual/unclassified path, N↔M fallback, mirrored instances, insertion-order coverage, free boundaries, 10.7.1 boundary orientation, coarse isometric architecture e XPBD existente.

Não foi adicionado nenhum branch por pants/trousers/front/crotch/rise/nome de peça.

## 13. Limitações restantes

- O coarse isometric assembly continua produzindo um initial seed com residual estrutural global não nulo. Isso já faz parte da arquitetura 10.7 e não foi reestruturado neste microfix.
- O corner onde rise encontra seams adjacentes pode oscilar durante a convergência. Ele não fica estruturalmente travado e cai para single-digit sem tuning, mas não foi redesenhado nesta etapa.
- O browser smoke do finalizer valida a aplicação real no Vite fallback quando Chromium pode ser instalado no runner. A fixture `real-pants.v3.json` não possui uma rota UI dedicada de auto-injeção, então a prova automatizada da fixture é feita diretamente pelo pipeline V3 no regression test.
- Ainda é necessário repetir a validação visual manual da calça real na branch final.

## Decisão de estágio

Se a validação manual confirmar saia, saia+cós, back crotch e front crotch sem residual estrutural anormal, o **INITIAL ASSEMBLY deve ser considerado congelado** conforme o critério do Prompt 10.7.2. Não iniciar nova reestruturação 10.x; o próximo estágio será BODY COLLISION / Prompt 11.

## Validação automatizada final

- Typecheck: PASS
- Focused gates: PASS —  Test Files 7 passed (7); Tests 55 passed (55);
- Full web suite: PASS —  Test Files 87 passed (87); Tests 544 passed | 1 skipped (545);
- Build fallback: PASS — dist/assets/FittingRoomDialog-88DFxF1h.js 9.73 kB │ gzip: 2.94 kB;dist/assets/SleeveWizardDialog-mBMOXz0a.js 14.17 kB │ gzip: 4.37 kB;dist/assets/three.core-lkjYqTMt.js 232.25 kB │ gzip: 60.37 kB;dist/assets/GarmentViewport-BQrdkkK-.js 454.87 kB │ gzip: 114.94 kB;dist/assets/index-BNFEhkFi.js 558.92 kB │ gzip: 165.39 kB;dist/assets/three.webgpu-D3__fMXV.js 568.01 kB │ gzip: 159.21 kB;;✓ built in 338ms;
- git diff --check: PASS
- Browser smoke: skipped: playwright setup unavailable
