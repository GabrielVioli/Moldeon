# Prompt 10.5 — General Garment Spatial Assembly

## Blocker observado manualmente

O caso real que motivou esta etapa tinha quatro painéis com laterais, ombros, cavas, decote, curvas e seams parciais. No STEP 0, gravidade 0%, foram observados aproximadamente 514.51 mm de residual médio e 1879.95 mm de residual máximo. Após cerca de 240 physics steps ainda restavam aproximadamente 60.81 mm de média e 1154.60 mm de máximo, com a roupa transformada em uma estrutura radial/origami.

A correção desta branch não altera o XPBD, collision, avatar, mesh física ou parâmetros do solver. O problema foi tratado no initial spatial assembly.

## Causa raiz

O fallback rígido anterior perdia informação topológica em três pontos combinados:

1. `placeConnectedPanelsRigidly` agrupava constraints apenas pelo par de PanelInstances. Assim, uma lateral A↔B e um ombro A↔B eram colapsados no mesmo bucket embora fossem relações materiais distintas.
2. A BFS considerava um painel definitivamente posicionado na primeira visita. Relações adicionais e ciclos que surgiam depois não participavam de uma reconciliação global da pose.
3. Para `rigid-panel ↔ rigid-panel`, o alinhamento local desenvolvia o painel no plano oposto ao painel pai. Em componentes gerais isso produzia uma solução coplanar degenerada mesmo quando o multigraph de seams continha informação suficiente para uma casca espacial.

O Adapter não era a origem. No fixture de reprodução, o salto máximo Material/Assembly → Adapter foi apenas 0.000085 mm antes da correção e 0.000032 mm depois.

## Fixture automatizada

Foi adicionada `createGeneralGarmentShellFixture`, com quatro painéis neutros A/B/C/D. Cada painel contém uma pequena região de ombro, boundary curva semelhante a cava, laterais, barra e boundary curva semelhante a decote. Neckline e armholes permanecem livres. A fixture possui múltiplas relações materialmente distintas entre os mesmos pares, incluindo lateral + ombro A↔B e C↔D.

Os nomes são deliberadamente neutros; o algoritmo não consulta nome, template id, front/back, shirt/dress ou coordenadas visuais do editor para decidir a estratégia.

## Reprodução antes da correção

No fixture automatizado, antes do novo strategy:

- todos os quatro mappings eram `rigid-panel`;
- `normalSpreadRad = 0`, confirmando coplanaridade exata;
- mean residual do Assembly = 26.4866 mm;
- max residual do Assembly = 180.1557 mm;
- Adapter max = 181.6557 mm;
- maximum correspondence jump no Adapter = 0.000085 mm.

O objetivo da fixture não é reproduzir artificialmente os 1879.95 mm do garment manual, e sim reproduzir a mesma falha estrutural: relações laterais + superiores existentes, porém pose inicial plana e residual grande gerado no Assembly.

## Nova representação/estratégia

O seam-derived-tube analítico permanece intacto e continua sendo preferido para self-seam tubes e ciclos longitudinais simples.

Para componentes gerais sem tube mapping, o fallback agora preserva um multigraph material: `pair -> seamGroup -> sampled constraints`. Relações diferentes entre as mesmas PanelInstances deixam de ser deduplicadas pelo par.

Um connected component é elegível a `multipanel-surface-shell` quando suas relações materiais fornecem evidência espacial adicional, por exemplo parallel material relations entre o mesmo par ou cycle rank positivo no multigraph. Free boundaries não invalidam essa classificação.

A propagação de pose continua rígida/isométrica. Uma relação primária alinha tangente e midpoint. Depois, para a ambiguidade diedral, são avaliadas deterministicamente poses não degeneradas derivadas do tamanho do connected component. Cada candidata é reconciliada por translação contra todas as relações já colocadas e avaliada pelo residual estrutural global relevante. Não existe ângulo de 90 graus hardcoded, deformação individual de boundary vertices, scale não isométrico ou pré-simulação escondida.

Componentes sem informação suficiente continuam em `rigid-fallback`, com diagnóstico explícito.

## Diagnostics por connected component

O resultado agora expõe `spatialAssemblyDiagnostics` com:

- `strategy`;
- `reason`;
- PanelInstances;
- structural seam group count;
- free boundary count;
- detected cycles;
- pose constraint count;
- residual médio e máximo após o assembly.

Para a fixture principal:

- strategy = `multipanel-surface-shell`;
- reason = `multigraph-cycle-or-parallel-material-relations`;
- 4 PanelInstances;
- 6 structural SeamGroups;
- 16 free boundaries;
- 3 independent cycle-rank relations;
- 6 pose constraints;
- `normalSpreadRad = 1.570788` no STEP 0.

## Residual por SeamGroup

Valores abaixo são do fixture determinístico e representam residual geométrico do Assembly, antes do Adapter.

| SeamGroup | Before mean / max | After mean / max |
| --- | ---: | ---: |
| shoulder A↔B | 119.207 / 180.156 mm | 22.367 / 38.306 mm |
| shoulder C↔D | 119.207 / 180.156 mm | 25.915 / 42.450 mm |
| side A↔B | 3.909 / 10.918 mm | 6.408 / 11.501 mm |
| side C↔D | 3.909 / 10.918 mm | 15.699 / 27.825 mm |
| shoulder B↔C | 1.500 / 1.500 mm | 19.914 / 19.914 mm |
| shoulder D↔A | 1.500 / 1.500 mm | 1.500 / 1.500 mm |

A métrica global passou de 26.4866 / 180.1557 mm para 13.6019 / 42.4501 mm. Algumas relações locais recebem residual maior para permitir uma pose global espacial; o critério não força overlap ou zero local artificial. O Adapter resulta em 15.4686 / 43.9501 mm, com correspondence jump de apenas 0.000032 mm.

A distorção intrínseca máxima após o assembly é 0.00004094 relativa, com erro absoluto máximo de aproximadamente 0.000000199 m, consistente com transformações rígidas e discretização numérica.

## STEP 1, gravidade 0

Com velocities = 0 e exatamente um fixed timestep:

- max displacement = 0.003782 m;
- seam mean = 12.2979 mm;
- seam max = 40.5737 mm;
- estado permaneceu finito;
- a casca permaneceu não planar.

Não há kick estrutural catastrófico.

## 240 steps, gravidade 0

No mesmo fixture:

- max displacement acumulado = 0.07050 m;
- seam mean: 15.4686 → 0.04039 mm;
- seam max: 43.9501 → 0.73659 mm;
- `normalSpreadRad` final = 1.54591;
- nenhum NaN/Infinity;
- garment continua como casca espacial em vez de estrela/origami radial.

## Performance

O novo assembly só roda no rebuild. Os kernels XPBD do Prompt 10.4-A não foram alterados.

Na fixture 10.5, após warm-up de 40 steps:

- physicsStep median = 3.3579 ms;
- physicsStep p95 = 3.4444 ms.

O benchmark determinístico do 10.4-A também é executado novamente na validação final para garantir que TypedArrays/hot loops permanecem ativos e que não foram reintroduzidas alocações por constraint.

## Regressões

A validação cobre e preserva:

- self-seam tube;
- 2-panel seam-derived tube;
- 4-panel simple cycle;
- open component sem fechamento falso;
- upper-band tube + body tube e phase alignment do Prompt 10.3;
- local closures;
- composite seams 1↔N, N↔1 e N↔M através das cenas canônicas;
- free neckline/armhole boundaries;
- múltiplas SeamGroups entre o mesmo par;
- nomes alterados;
- piece insertion order e SeamGroup insertion order;
- remoção de shoulder relations;
- remoção de uma side seam;
- A→B→A sem stale pose;
- XPBD one-step e 240-step gravity-zero;
- Worker lifecycle e rebuild;
- ResolvedAssemblyInput e PhysicalGarmentAssembly.

## Browser smoke

O smoke abre o app real em Chromium via Vite fallback e importa a fixture 10.5 pelo próprio runtime do navegador. Ele executa Assembly → Adapter → XPBD com gravidade zero, valida strategy `multipanel-surface-shell`, residual, não-planaridade, 1 step e 240 steps e falha caso apareçam erros de console/page.

## Limitações restantes

O strategy geral não tenta inferir uma roupa quando o componente realmente contém informação insuficiente. Um par ligado por uma única seam isolada continua podendo usar `rigid-fallback`. A solução também não implementa body collision, self-collision, chão, multilayer, adaptive physics mesh ou fitting anatômico. Esses problemas pertencem a etapas posteriores.

O assembly ainda usa uma busca geométrica discreta e determinística de poses diedrais, não um otimizador global contínuo. Garments muito ambíguos, com várias soluções espaciais matematicamente equivalentes ou relações fortemente incompatíveis, podem exigir uma etapa futura de pose-graph optimization.

## Escopo preservado

Nenhum código de collision foi adicionado. Nenhuma physics mesh reduzida do 10.4-B foi implementada. Prompt 11 não foi iniciado. O XPBD continua responsável por deformar uma pose espacial plausível, não por descobrir a topologia da roupa a partir de painéis planos.
