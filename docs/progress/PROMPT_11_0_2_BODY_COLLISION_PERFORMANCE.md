# Prompt 11.0.2 — Body Collision Performance

Data: 2026-08-20

Branch: `recovery/11.0.2-body-collision-performance`

Base publicada 11.0.1: `2b5960dfe67ad3d0023ebf713a063f7a1e0ac086`

## Resultado

O hot loop CPU/Worker de cloth ↔ body foi otimizado sem reduzir partículas, proxies, constraints, seams, iterações, timestep, gravidade, CCD swept ou qualidade geométrica dos colliders. O caminho otimizado é numericamente equivalente ao caminho 11.0.1 de referência nas cenas determinísticas low/medium/stress.

O gate específico da 11.0.2, typecheck, build, testes focados, benchmarks e smoke de navegador passaram. A suíte web inteira ainda contém cinco blockers herdados fora deste escopo; eles estão registrados em **Gates e blockers herdados** e não foram mascarados aumentando tolerâncias nem alterando assembly 10.x.

## Diagnóstico BEFORE

No caminho de referência 11.0.1, cada consulta criava tuples para `point`/`previous`, arrays para centro/eixo/radii/delta/normal e um `BodyContactQuery` por contato. O broadphase também recalculava AABBs por partícula × proxy e executava a varredura completa dos 12 proxies tanto para point quanto para swept.

O profile A/B confirma que o broadphase era o gargalo dominante fora do corpo:

- 4.900 / low: `22,572 ms` de broadphase em `24,301 ms` totais;
- 4.900 / medium: `22,149 ms` de broadphase em `24,720 ms` totais;
- 4.900 / stress: `23,123 ms` de broadphase + `15,810 ms` de narrowphase em `42,399 ms` totais.

No baseline bruto do HEAD publicado antes de materializar o candidate 11.0.1, a carga histórica de 6.408 partículas registrou `21,984 ms` OFF, `47,625 ms` ON e `26,697 ms` de body collision. Esse número não é usado como comparação de equivalência porque o HEAD publicado aplicava o candidate final por scripts no CI; a comparação principal abaixo usa as mesmas semânticas materializadas da 11.0.1 nos dois lados.

## Implementação AFTER

- cache estático por geração com AABBs, eixos/inverso de comprimento² de cápsulas, normais fallback e inversos de raios;
- invariantes derivados em `Float64Array`, evitando arredondamento de borda sem alterar os colliders canônicos `Float32`;
- índice espacial conservador de 32 slabs no eixo Y e bitmask para até 32 proxies;
- refinamento point/segment contra AABBs cacheadas, expandido por espessura + contact skin;
- early exit swept para movimento desprezível e segmento fora da AABB expandida;
- kernels escalares para cápsula, elipsoide, swept capsule e swept ellipsoid;
- dois scratch contacts reutilizados por runtime, sem retorno de objetos no solver;
- friction escalar in-place, sem tuples/arrays de velocity e normal;
- bookkeeping numérico no solve e conversão collider → region apenas no fim do step;
- fallback funcional anterior preservado para conjuntos com mais de 32 colliders;
- cache reconstruído em `initialize`/`updateGeometry` porque o Worker recebe novos buffers canônicos e cria um novo runtime; reset reutiliza o mesmo cache; dispose descarta o Worker state.

### Alocações

BEFORE, por partícula/consulta, havia pelo menos os tuples `point` e `previous`; cada narrow contact acrescentava center/start/end/radii/delta/normal/surface e um objeto de resultado. AFTER, o hot path cria `0` arrays, `0` tuples e `0` objetos por partícula ou proxy. As TypedArrays, slabs e dois scratch objects são alocados uma vez por geometry generation. As APIs object-friendly foram preservadas apenas para testes e chamadas fora do solver.

## Microbench A/B

Cada linha usa 12 proxies, 8 iterações, mesmas positions, velocities, materials, timestep e gravidade. Tempos em ms, mediana; p95 está registrado pelo teste dedicado.

| Partículas | Contato | Referência | Otimizado | Ganho |
|---:|---|---:|---:|---:|
| 2.500 | low | 11,921 | 1,177 | 10,13× |
| 2.500 | medium | 12,819 | 1,461 | 8,77× |
| 2.500 | stress | 22,124 | 5,313 | 4,16× |
| 4.900 | low | 24,301 | 2,514 | 9,67× |
| 4.900 | medium | 24,720 | 3,281 | 7,54× |
| 4.900 | stress | 42,399 | 12,098 | 3,50× |
| 6.400 | low | 30,746 | 3,109 | 9,89× |
| 6.400 | medium | 32,865 | 3,636 | 9,04× |
| 6.400 | stress | 52,935 | 13,917 | 3,80× |

### Candidate reduction

| Partículas / cenário | Tests referência | Tests espaciais | Narrow candidates | Reject rate |
|---|---:|---:|---:|---:|
| 2.500 / medium | 480.000 | 247.116 | 2.122 | 99,14% |
| 4.900 / medium | 940.800 | 483.528 | 4.012 | 99,17% |
| 6.400 / medium | 1.228.800 | 631.656 | 5.224 | 99,17% |
| 4.900 / stress | 940.800 | 763.332 | 98.195 | 87,14% |

Os “tests espaciais” já excluem queries swept sem movimento. O broadphase é exclusivamente espacial e não consulta nome/tipo de roupa.

## Cena integrada de ~4.900 partículas

Fixture: 4.900 particles, 7.792 triangles, 12.678 stretch, 7.792 shear, 10.698 bend, 248 seams, 8 iterations e 12 body colliders.

| Métrica | 11.0.1 reference | 11.0.2 optimized |
|---|---:|---:|
| physicsStep OFF | 14,947 ms | 14,947 ms |
| physicsStep ON | 21,105 ms | 17,240 ms |
| bodyCollision | 5,236 ms | 1,624 ms |
| delta ON − OFF | 6,159 ms | 2,293 ms |
| contatos medianos | 2.441 | 2.441 |

O body collision integrado ficou `3,23×` mais rápido; o passo físico total caiu cerca de `18,3%` contra o mesmo caminho ON de referência. No AFTER, a média foi `1,34` candidatos por query e o reject rate foi `88,86%` nessa cena de contato intenso.

## Equivalência física

O regression A/B executa o fallback allocation-heavy 11.0.1 e o caminho otimizado sobre buffers independentes e idênticos.

- low e medium: RMS e máximo de posição `0`;
- stress de equivalência: RMS `2,61e-18`, máximo `1,11e-16`;
- matriz até 6.400 particles: pior máximo `5,33e-15`;
- velocities: RMS/máximo `0`;
- body contact count: idêntico;
- swept contact count: idêntico;
- maximum penetration: idêntica;
- maximum correction: idêntica;
- nenhum NaN/tunneling novo.

Regressão real 11.0.1 da saia:

- 12 colliders e máximo observado de 1.949 contatos;
- penetração inicial máxima `0,111218 m`;
- correção máxima `0,035 m` durante dressing;
- gravity-zero final: penetração máxima `0,049758 m`, seam mean `0,000475 m`, seam max `0,035739 m`;
- friction e swept regressions passaram.

## Telemetria DEV

Foram preservados os tempos de body collision/broadphase/narrowphase/projection/friction e adicionados:

- full collider tests;
- candidate collider tests;
- broadphase rejected/reject rate;
- candidates/query;
- capsule/ellipsoid narrow tests;
- point contacts;
- swept tests/hits.

## Gates

Passaram:

- focused body collision + Worker: 16 arquivos, 46 testes aprovados, 2 perf-only skipped;
- correção das duas auditorias intermediárias para medir `maximumObservedContacts`, coerente com o contrato final 11.0.1;
- microbench 2.500/4.900/6.400 × low/medium/stress;
- integrated OFF/reference/optimized benchmark;
- XPBD hotloop performance;
- typecheck;
- build fallback;
- `git diff --check`;
- browser smoke Playwright/Edge: HTTP 200, título Moldeon, bancada renderizada, loader encerrado, zero error overlay e zero console/page errors.

Suíte web completa: `97/103` arquivos e `580` testes passaram; o run paralelo reportou 7 falhas. Repetição serial isolou 5 blockers herdados fora do body collision:

1. timeout G9 shorts (`coarseIsometricArchitecture`);
2. timeout real pants STEP 1/10/60/240 (`constraintSpatialAssembly`);
3. residual traseiro 10.7.2 de `19,558 mm` contra gate de `12 mm`;
4. auditoria exploratória de body registration que exige waist-top melhor que centroid, contradizendo a estratégia lower-shell final 11.0.1;
5. `tube + sewn flap`, cujo seam max cresce após 30 passos mesmo com body collision desabilitado.

No run paralelo também houve estouros transitórios de `assemblySolveMs < 500 ms` e timeout G5/G6; esses passaram na repetição serial. Nenhum desses arquivos/algoritmos foi relaxado ou alterado nesta etapa de performance.

## Smoke e validação manual

Captura: `artifacts/recovery-11-0-2-browser-smoke.png`.

Para repetir no browser DEV com a mesma cena real:

1. abrir o documento de ~4.900 partículas aprovado na 11.0.1 e clicar **Provar**;
2. no painel **Física DEV**, manter cadence `1`, gravity `1`, iterations/substeps do documento e auto-pause em `500`;
3. desmarcar **Body collision**, clicar **Reiniciar**, aguardar 400–500 steps e registrar `physicsStepMs` e FPS;
4. marcar **Body collision**, clicar **Reiniciar**, aguardar os mesmos 400–500 steps e registrar `physicsStepMs`, `Body collision ms`, FPS, contacts, max penetration, max correction e seam mean/max;
5. confirmar que 12 colliders continuam ativos, a roupa não atravessa o avatar, friction continua reduzindo deslizamento e não há tunneling em movimento rápido;
6. comparar OFF/ON na mesma máquina e sem alterar zoom, mesh, tecido, cadence, iterations ou geometria.

## Limitações

- O fast path de bitmask cobre até 32 colliders; acima disso permanece o fallback genérico correto, porém mais caro.
- Avatar permanece estático conforme o escopo; self-collision, WebGPU, SharedArrayBuffer e Prompt 11.1 não foram iniciados.
- Os números históricos de ~205 ms/3 FPS precisam ser repetidos manualmente no mesmo browser/hardware; benchmark de runner é relativo, não substitui esse gate.
- A implementação 11.0.2 está pronta para o gate manual de performance, mas a branch não pode ser declarada com suíte web total verde enquanto os cinco blockers herdados acima permanecerem.
