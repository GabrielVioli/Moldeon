# Prompt 10.7.1 — Waistband Boundary Binding

## Base

- Base obrigatório: `771d9126be69cfbe5eb1d7f08d5d883ec0350aa2`
- Branch: `recovery/10.7.1-waistband-boundary-binding`
- Escopo: correção de identidade/mapeamento de boundary. Nenhuma alteração em ARAP, objective, XPBD, coarse solver ou lógica semântica de tipo de roupa.

## Sintoma manual

A shell multipainel da saia passou a montar corretamente no Prompt 10.7, mas uma faixa costurada às bordas superiores curvas podia aparecer ligada à região inferior da shell. O problema foi tratado como mapping bug, não como erro de física.

## Auditoria por fronteira

### Canonical SeamGroup — CORRETO

Os `EdgeRange`s persistidos preservam `pieceId`, `edgeId`, `startT` e `endT`. O teste full-chain confirma quatro ranges superiores independentes e a faixa material correspondente do band.

### Physical Binding — CORRETO

`physicalBindings` preserva os `PanelInstanceV3` concretos e não modifica os ranges materiais. A projeção runtime mantém os mesmos `edgeId/startT/endT`.

### Coarse Boundary Mapping — BUG ENCONTRADO E CORRIGIDO

`PanelTopology` utilizava `contour.segmentIds` para ordenar as edges, mas assumia que todo `PatternSegment.startNodeId -> endNodeId` apontava na mesma direção da travessia do contorno.

Essa hipótese não é válida depois de operações que podem reconstruir/normalizar segmentos mantendo um `edgeId` canônico enquanto a travessia do contorno usa a direção oposta.

Antes da correção, um segmento invertido era amostrado em sua direção canônica e concatenado como se estivesse na direção do contorno. Como o último sample não é duplicado e o próximo segmento fornece o vértice compartilhado, a identidade `edgeId -> boundary vertices` podia deslocar-se para a boundary vizinha. Em casos suficientemente ruins o contorno tornava-se sobreposto/autointersectante.

A correção separa explicitamente:

- **contour traversal direction**, usada somente para construir uma sequência geométrica contínua;
- **canonical material edge direction**, usada por `EdgeRange.t`, source mapping e `PanelEdgePath`.

O algoritmo agora orienta cada segmento por conectividade de endpoints. Se a travessia é reversa, samples são revertidos apenas para montar o contorno; `t`, interpolation e o `PanelEdgePath` final continuam na direção canônica `0 -> 1` da edge.

Não existe regra por saia, cós, cintura, eixo global ou nome de peça.

### Embedding — CORRETO

`IsometricSurfaceAssembly` usa os `CoarseMaterialBinding` recebidos de `CoarseSeamConstraints` através de barycentric evaluation. Ele não escolhe top/bottom e não recria edges por proximidade.

### Coarse -> Fine Transfer — CORRETO

Cada fine vertex mantém a própria coordenada material e um binding determinístico para coarse triangle + barycentric weights. O teste verifica que a coordenada material antes/depois é idêntica dentro de tolerância e que a posição final corresponde a `evaluateCoarseBinding`.

## Reproducer

O regression test cria um painel curvo cujo `contour.segmentIds` percorre duas edges no sentido oposto ao sentido material canônico dessas edges.

Antes do fix, `buildPanelTopology` falhava com contorno sobreposto/autointersectante. Depois do fix:

- a waist edge continua na região material superior;
- a hem edge continua na região material inferior;
- o `PanelEdgePath` de uma edge percorrida ao contrário ainda começa em `t=0` e termina em `t=1` canônicos;
- uma passada de refinement preserva a mesma identidade.

## Full-chain boundary trace

O fixture de saia curva + band percorre:

`PatternDocumentV3 -> physical binding -> AssemblyStitchConstraint -> CoarseMaterialBinding -> isometric solve -> coarse-to-fine transfer`.

A amostra inicial validada possui, por exemplo:

- `groupId = waist-join`
- painel material: edge superior, material `(0, 0)`
- band material: boundary oposta selecionada, material `(0, 42)`
- ambos os lados possuem coarse triangle, vertex IDs e barycentric weights explícitos
- a hem boundary dos painéis não possui stitch

O teste também cobre sample no meio e no final da costura composta.

## Regressões específicas

Coberto explicitamente:

- band permanece ligada à boundary material selecionada;
- boundary oposta da shell permanece livre;
- ordem de PatternDefinitions/PanelInstances/SeamGroups não muda a identidade material;
- `mirrored` PanelInstances não trocam top/bottom;
- refinement não troca edge identity;
- coarse-to-fine não troca material identity.

## Validação

O finalizador executa antes do commit:

- `npm run typecheck`
- testes focados Prompt 10.7.1
- P0 saia e saia + band
- arquitetura coarse/isométrica G1-G24 relevante
- Assembly Worker lifecycle tests
- suíte web completa
- `npm run build`
- `git diff --check`

Todos esses gates precisam estar verdes para o commit final existir.

## Classificação final

**Fronteira incorreta: Coarse Boundary Mapping**, mais precisamente a construção de `PanelTopology` que alimenta a `CoarseAssemblyMesh`.

Canonical SeamGroup, Physical Binding, Embedding e Coarse -> Fine Transfer foram auditados e preservam a identidade material no regression full-chain.
