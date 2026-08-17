# Prompt 10.6 — Constraint-Based Spatial Assembly

## Resultado

Esta etapa substitui a decisão terminal baseada em casos conhecidos por uma arquitetura geral de constraints materiais:

```text
PatternDocumentV3
-> PanelInstanceV3 + SeamGroupV3
-> GarmentSpatialConstraintGraph
-> candidate seeds
-> global rigid-pose solve em SE(3)
-> initial spatial assembly
-> XPBD
```

`docs/ASSEMBLY_ARCHITECTURE.md` é o documento canônico da arquitetura resultante.

## Arquitetura antiga

O assembly acumulava comportamentos úteis, porém a decisão final ainda dependia de mecanismos locais como BFS de primeira visita, seleção de tube groups e estratégias específicas para algumas topologias. Isso permitia que uma subestrutura fechada pequena dominasse o garment ou que relações descobertas depois da primeira visita não reconciliassem globalmente as poses.

O Prompt 10.5 preservou corretamente múltiplas SeamGroups em casos importantes, mas ainda usava uma busca discreta como estratégia terminal. No 10.6 essas técnicas passam a ser seeds/fast paths e toda rede multipainel relevante compete em um objective global.

## Heurísticas removidas ou rebaixadas

Não são mais autoridade final:

- fallback planar;
- BFS first-visit;
- primary tube selection;
- upper band/tube pequeno como núcleo obrigatório;
- `multipanel-surface-shell` do 10.5 como decisão terminal;
- alinhar um painel usando apenas a primeira seam disponível.

Embeddings analíticos isométricos continuam válidos como subestruturas/candidates. Uma solução 10.5 já validada também compete intacta no objective e só vence quando for realmente melhor que as novas seeds.

## GarmentSpatialConstraintGraph

O graph é um multigrafo material.

Nodes são `PanelInstanceV3` físicos. Cada relation preserva individualmente:

- SeamGroup;
- PanelInstance A/B;
- EdgeRanges concretos;
- samples por arc-length;
- progress material;
- comprimento característico;
- direção `same`/`opposite`;
- tangentes materiais locais;
- orientação lateral do boundary;
- treatment, target ratio e slack;
- classificação de residual;
- peso estrutural.

Duas SeamGroups entre A↔B continuam duas relations independentes. Não há deduplicação somente pelo par de painéis.

Connected components registram relações paralelas, cycle rank independente e free boundaries.

## Pose solver

Cada painel possui pose rígida `T_i ∈ SE(3)` com quaternion e translação. Um anchor determinístico remove apenas a liberdade global do component e não depende de nome de peça, template ou posição no editor.

O solver usa rigid best-fit ponderado do tipo Horn/Kabsch em iterações alternadas. Para cada painel são usadas simultaneamente todas as correspondências estruturais com seus vizinhos. Tangentes entram como pseudo-correspondências em torno do midpoint da seam.

As candidates incluem:

- embedding geométrico existente intacto;
- embedding existente reconciliado;
- estado material plano;
- duas hipóteses diedrais determinísticas derivadas do graph.

A seleção usa residual normalizado, overlap/collapse grosseiro, penalidade de planaridade apenas quando a topologia suporta shell e distorção intrínseca. Não existe pré-simulação XPBD escondida.

## Underconstrained hinges

Uma seam reta isolada continua sendo uma hinge subdeterminada. O solver não inventa 90°, frente/costas, manga, cilindro ou qualquer semântica de roupa. Um component realmente sem informação suficiente pode permanecer aberto.

Cycles e múltiplas relations fornecem constraints adicionais quando existem.

## Multiple relations A↔B

O teste P0 mantém relações materialmente distintas entre o mesmo par. Uma lateral e uma seam superior A↔B influenciam simultaneamente a pose relativa. A chave interna inclui SeamGroup + ranges concretos, não apenas `(A,B)`.

## Calça, shorts e o gancho

A investigação revelou um blocker de domínio além do solver. O molde paramétrico de calça já tinha curvas `frontCrotch` e `backCrotch`, mas o gerador automático persistia principalmente laterais e entrepernas. Além disso, a validação tratava a mesma faixa material como self-seam inválida mesmo quando a intenção era unir duas cópias físicas da mesma definição.

Foi adicionado `physicalPairing: "paired-copies"` a Seam/SeamGroupV3. Ele representa uma relação entre duas `PanelInstanceV3` distintas originadas da mesma `PatternDefinitionV3`. A validação exige pelo menos duas cópias físicas.

O template de calça passa a persistir:

- lateral/outseam;
- entrepernas/inseam;
- fechamento do gancho frontal entre as duas cópias da frente;
- fechamento do gancho traseiro entre as duas cópias das costas.

As pences permanecem `local-shaping-closure`: são diagnosticadas, mas não dominam o objective rígido global. Seu fechamento/deformação é responsabilidade física do XPBD.

O solver não possui `if pants`, `if shorts`, `if crotch`, `if front` ou `if back`. O teste de shorts encurta geometricamente a mesma topologia de calça e usa exatamente o mesmo constraint graph.

## Repuxo

Quando relações não podem ser satisfeitas simultaneamente por transforms rígidos, o assembly mantém o melhor fit rígido e preserva o residual físico real.

```text
ASSEMBLY = estrutura espacial + best-fit rígido
XPBD     = tensão, repuxo, ease, gather e deformação
```

O teste G14 confirma que o assembly não estica o painel para zerar uma seam incompatível e que o XPBD reduz o residual por deformação física.

## Bateria de topologias

A suíte específica cobre:

- G1 self-seam rectangle/tube;
- G2 dois painéis com relações paralelas;
- G3 ciclo fechado de quatro painéis;
- G4/G5 torso/shell com laterais, seams superiores, curvas e free boundaries;
- G6 body + band;
- G7 local closure/dart;
- G8 múltiplas seams A↔B;
- G9 N↔M composite seam;
- G10 open chain;
- G11 remoção de seam;
- G12 topologia assimétrica e order independence;
- G13 curved boundaries/tangents;
- G14 incompatible distant seam/repuxo;
- G15 body + duas bands independentes;
- calça paramétrica real com quatro PanelInstances, laterais, entrepernas, gancho frontal, gancho traseiro e pences;
- shorts derivados geometricamente da mesma rede;
- `same`/`opposite`;
- A→B→A;
- adapter/Worker correspondence;
- lifecycle/rebuild;
- regressões históricas de assembly e PatternDocumentV3.

## Before / after representativo

Valores observados nos runners Linux durante a implementação. `Old` é o estado geométrico anterior ao global solve; `New` é a candidate selecionada pelo 10.6.

| Fixture | Old mean/max | New mean/max | Non-planarity | Coarse overlap | assemblySolveMs |
| --- | ---: | ---: | ---: | ---: | ---: |
| curved four-panel shell | ~16.67 / 43.95 mm | ~10.26 / 27.37 mm | ~1.491 rad | ~0.256 | ~160–200 ms |
| body + upper band | ~16.63 / 76.39 mm | ~16.63 / 76.39 mm | ~1.571 rad | ~0.000 | ~200–250 ms |
| straight pants | ~36.06 / 75.74 mm | ~24.35 / 96.28 mm | ~1.354 rad | ~0.543 | ~210–260 ms |

Na calça, o residual médio estrutural cai fortemente. O pico restante no STEP 0 fica localizado em uma região fisicamente incompatível/fortemente acoplada do gancho em vez de uma separação estrutural de centenas ou milhares de milímetros. O assembly não deforma arbitrariamente a peça para zerar esse pico.

## Calça em gravidade zero

No fixture real `straight-pants-standard`:

- 4 PanelInstances físicos;
- 20 relations materiais no graph;
- gancho frontal e traseiro por `paired-copies`;
- pences classificadas como shaping local;
- 13 ciclos independentes observados na rede;
- STEP 0 aproximadamente 25 mm médio / 96 mm máximo;
- STEP 1 aproximadamente 22 / 94 mm;
- STEP 10 aproximadamente 2.7 / 41 mm;
- STEP 60 aproximadamente 0.34 / 33.5 mm;
- STEP 240 aproximadamente 0.35 / 33.5 mm;
- nenhum NaN/Infinity;
- nenhuma explosão radial;
- nenhum painel percorrendo metros;
- shell permanece tridimensional.

## Performance

O global solve roda somente no rebuild. Nos garments complexos medidos durante a etapa ficou aproximadamente na faixa de 160–260 ms no runner Linux, dentro da meta inicial de 100–300 ms para garments comuns.

Os kernels XPBD do Prompt 10.4-A não foram alterados. O benchmark heavy é reexecutado na validação final para impedir regressão do hot loop.

## Determinismo

Testes cobrem alteração de display names, piece insertion order, SeamGroup insertion order, alteração/remoção de relations, `same`/`opposite` e A→B→A. A estratégia não consulta categoria de roupa para resolver a pose.

## Documentação superseded

Documentos históricos que descreviam anchors/BFS/tube heuristics como arquitetura final são marcados como históricos/superseded e apontam para `docs/ASSEMBLY_ARCHITECTURE.md`.

## Limitações reais

- Uma hinge isolada continua matematicamente ambígua.
- Garments com várias soluções rígidas equivalentes podem escolher uma hipótese determinística entre candidates geométricas.
- Relações materialmente incompatíveis mantêm residual para o XPBD.
- O solver atual é alternating rigid registration, não um Gauss-Newton completo sobre uma Lie algebra SE(3).
- Graphs futuros muito grandes podem justificar pose-graph optimization contínua sem mudar o contrato material.
- Validação manual visual continua necessária para garments autorais com redes nunca cobertas por fixtures.

## Fora de escopo

Não foi implementado nesta etapa:

- body/avatar collision;
- self-collision;
- cloth-cloth collision;
- chão;
- physics mesh reduzida / Prompt 10.4-B;
- IA/LLM;
- Prompt 11.

A física continua recebendo uma pose inicial espacial; ela não é usada para descobrir a topologia da roupa.
