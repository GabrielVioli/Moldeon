# Assembly 3D por constraints materiais

> Documento canônico a partir do Prompt 10.6. Para a montagem espacial de garments, este documento substitui descrições antigas baseadas em fallback planar, BFS de primeira visita, seleção de tube group principal ou regras por topologia conhecida.

## Objetivo

O initial spatial assembly transforma o domínio canônico em uma pose espacial inicial coerente antes da física:

```text
PatternDocumentV3
  -> PanelInstanceV3 + SeamGroupV3
  -> GarmentSpatialConstraintGraph
  -> candidate seeds
  -> global rigid-pose solve
  -> initial garment shell
  -> XPBD
```

O assembly não é uma simulação de tecido. Ele não estica molde, não altera PatternDocumentV3, não usa collision e não executa XPBD escondido. A responsabilidade desta camada é produzir a melhor configuração rígida/isométrica possível para as relações materiais conhecidas. O XPBD recebe o residual físico legítimo restante e resolve repuxo, tensão, ease, gather e outras deformações.

## Fonte de verdade

`PatternDocumentV3` continua canônico. `PatternDefinitionV3` define geometria material; `PanelInstanceV3` representa cópias físicas. O solver opera sobre instâncias físicas e nunca identifica peças por nome de roupa, template id ou posição na bancada.

A montagem não pode modificar silenciosamente a geometria 2D para fechar uma costura. Escala não uniforme é proibida. As transformações livres do solver são poses rígidas em SE(3): rotação + translação.

## GarmentSpatialConstraintGraph

Cada connected component é convertido em um multigrafo material.

### Nodes

Um node corresponde a uma `PanelInstanceV3` física.

### Relations

Uma relation corresponde a uma relação material específica de `SeamGroup` + par concreto de `EdgeRange`. Relações não são deduplicadas somente pelo par de painéis.

Assim, por exemplo:

```text
A <-> B pela lateral
A <-> B pelo topo
```

são duas relations independentes e ambas influenciam a pose relativa.

Cada relation preserva:

- PanelInstance A/B;
- SeamGroup id;
- EdgeRanges concretos;
- samples de correspondência por arc-length;
- progress material ordenado;
- posições locais representadas pelas referências materiais;
- tangente material local de cada lado;
- orientação lateral do boundary derivada da tangente;
- direção `same`/`opposite` canônica;
- comprimentos característicos;
- treatment, target ratio e slack;
- classificação de residual;
- peso estrutural.

Self-seams também são relations válidas.

## Costuras entre cópias físicas da mesma definição

Algumas construções não podem ser representadas corretamente apenas como `piece A -> piece B` porque duas cópias físicas da mesma definição precisam se unir.

Exemplo central: uma frente de calça é uma `PatternDefinitionV3` cortada duas vezes. O gancho frontal une a curva do gancho da cópia esquerda à mesma curva material da cópia direita. O mesmo ocorre no gancho traseiro.

Para isso, `SeamGroupV3`/`Seam` pode declarar:

```text
physicalPairing: "paired-copies"
```

Nesse caso, ranges materialmente idênticos são válidos desde que existam pelo menos duas `PanelInstanceV3` físicas da definição. A projeção para o assembly resolve as referências em instâncias distintas e nunca cria uma self-seam acidental.

O modelo é genérico. Não existe tratamento especial no solver chamado `pants`, `crotch` ou `gancho`. O template de calça apenas persiste corretamente as relações materiais; dali em diante elas são constraints comuns do grafo.

## Pences e shaping local

O trabalho do Prompt 10.3 é preservado. Relations são classificadas como:

- `structural-alignment`;
- `local-shaping-closure`;
- `intentional-mismatch`.

`structural-alignment` participa fortemente da pose global. `intentional-mismatch` participa com peso reduzido porque pode carregar ease/slack/diferença material intencional. `local-shaping-closure`, incluindo pences, não deve dominar a pose rígida global: seu fechamento pertence principalmente ao XPBD.

Isto evita que uma pence ou pequena faixa local transforme o garment inteiro em um anel, ventilador ou estrela.

## Pose variables

Cada painel de um connected component possui uma pose:

```text
T_i = (q_i, t_i)
```

onde `q_i` é uma rotação unit quaternion e `t_i` uma translação em metros.

Um painel é escolhido deterministicamente como anchor para remover a liberdade global de rotação/translação. A escolha usa assinatura geométrica, quantidade de vértices e id estável como desempate, nunca nome de roupa.

A ancoragem só fixa o gauge matemático. Ela não deve mudar a solução relativa do garment.

## Position constraints

Para cada sample correspondente:

```text
pA = T_A(localA)
pB = T_B(localB)
r = pA - pB
```

Todas as relations relevantes do component participam do objetivo. O solver não encerra a decisão após a primeira seam encontrada.

O residual também é normalizado pelo comprimento característico da seam para permitir comparação entre garments e costuras de escalas diferentes.

## Tangent constraints

A ordem material dos samples define a tangente local de cada lado. As tangentes são preservadas explicitamente no graph e entram no rigid best-fit como pseudo-correspondências simétricas em torno do midpoint da seam.

Isso impede uma solução que apenas cola endpoints enquanto gira um painel transversalmente à costura.

A direção `same`/`opposite` vem da SeamGroup canônica. A construção das correspondências de arc-length já incorpora a orientação correta do lado B; o graph também retém o valor original para diagnóstico e testes.

## Hinge e graus de liberdade

Uma seam isolada funciona como hinge e, sozinha, normalmente deixa um grau de liberdade diedral. O solver não inventa um ângulo de 90, 45 graus ou uma forma cilíndrica por semântica de roupa.

Quando o component é subdeterminado, a solução pode continuar parcialmente aberta. Quando existem cycles independentes ou múltiplas relations entre os mesmos nodes, essas relações adicionais fornecem informação para resolver parte ou toda a ambiguidade.

## Cycle structure

Para cada connected component, o graph calcula:

- número de relations inter-panel;
- relações paralelas materiais;
- cycle rank independente;
- free boundaries.

O cycle rank é calculado sobre o multigrafo, portanto uma segunda relation independente entre o mesmo par de nodes também aumenta a informação de fechamento.

Não existe regra `if four-panel-cycle`, `if upper-band` ou `if shirt-like` no solver geral.

## Candidate initialization

Optimization não depende de uma única seed.

As seeds atuais são determinísticas e limitadas:

1. **legacy geometric seed**: resultado de embeddings/propagações válidos já existentes. A partir do 10.6 eles são seeds, não decisão final.
2. **constraint hinge positive**: propagação por relations com abertura diedral derivada da estrutura do graph.
3. **constraint hinge negative**: hipótese espelhada equivalente.

Self-seam tubes ou embeddings analíticos isométricos conhecidos podem continuar como fast paths/seeds. Um tube group pequeno nunca recebe autoridade para organizar o garment inteiro sozinho.

## Solver global

O solver usa otimização rígida alternada com best-fit do tipo Horn/Kabsch.

Em cada iteração:

1. congela temporariamente as poses vizinhas;
2. reúne todas as correspondências estruturais que atingem o painel;
3. acrescenta constraints de tangente;
4. calcula a melhor rotação/translação rígida ponderada;
5. aplica damping determinístico;
6. repete até convergência ou limite de iterações;
7. avalia o component globalmente.

A abordagem foi escolhida porque:

- não exige dependência numérica grande;
- preserva rigidez por construção;
- aceita múltiplos vizinhos e relações paralelas;
- funciona bem no rebuild, onde dezenas/centenas de ms são aceitáveis;
- é determinística;
- mantém o XPBD fora do initial assembly.

## Global objective

A seleção de seed/solução considera, conceitualmente:

```text
E = normalized material residual
  + coarse overlap/collapse penalty
  + topology-aware planar-degeneracy penalty
  + intrinsic distortion penalty
  + tangent consistency (durante rigid fit)
```

Os pesos são geométricos e independentes de categorias de roupa.

### Overlap/collapse

O assembly não implementa self-collision. Usa apenas proxies geométricos baratos por painel para detectar colapso grosseiro de centroids/volumes. Isso impede que quatro painéis exatamente sobrepostos sejam escolhidos apenas porque algumas seams ficaram próximas.

### Planar degeneracy

Planaridade só é penalizada quando a topologia do graph contém informação espacial adicional, como cycles ou parallel material relations. Uma open chain realmente subdeterminada não é obrigada a virar volume.

### Intrinsic distortion

As constraints estruturais internas do painel monitoram comprimento material. Uma candidate que altera a geometria intrínseca é fortemente penalizada. O solver de pose em si só aplica transforms rígidos.

## Free boundaries

Cava, decote, barra, aberturas e outras bordas livres não viram seams automaticamente.

Free boundary:

- não fecha o graph;
- não invalida uma shell espacial;
- permanece livre até o usuário persistir uma relação material.

## Relações incompatíveis e repuxo

Nem toda rede de costuras possui solução rígida com residual zero. Se duas regiões distantes exigem relações incompatíveis, o assembly encontra um best-fit rígido global e mantém o residual real.

Depois:

```text
assembly -> pose coerente + residual físico
XPBD     -> deformação, tensão e repuxo
```

Isto é deliberado. Zerar toda seam deformando o molde no assembly seria incorreto.

## Determinismo

O resultado não pode depender de:

- display name;
- template id;
- posição no editor;
- ordem de inserção de peças;
- ordem de inserção de SeamGroups.

Relações e nodes são canonicalmente ordenados. Seeds e desempates usam ids/assinaturas estáveis. Casos espelhados matematicamente equivalentes escolhem uma hipótese de forma determinística.

## Diagnostics

Por connected component são registrados:

- strategy;
- reason;
- node ids;
- anchor;
- constraint count;
- cycle count;
- free boundary count;
- candidate count;
- selected seed;
- `assemblySolveMs`;
- `nonPlanarityRad`;
- `coarseOverlapScore`;
- intrinsic distortion;
- normalized residual;
- mean/max residual antes e depois.

Por relation/SeamGroup são registrados classificação, mean/max residual e residual normalizado.

A auditoria Material -> Assembly -> Adapter -> Worker do Prompt 10.3 continua sendo a referência para detectar saltos introduzidos por camadas posteriores.

## Estratégias antigas

A partir do 10.6, os seguintes mecanismos não são arquitetura final:

- BFS first-visit;
- planar rigid fallback como solução preferencial;
- primary tube selection;
- small tube/upper band como núcleo do garment;
- `multipanel-surface-shell` discreto do 10.5 como decisão terminal.

Eles podem produzir uma seed útil ou manter fast paths isométricos conhecidos, mas toda rede multipainel relevante é reconciliada pelo constraint solver global.

## Fora de escopo

Esta arquitetura não implementa:

- body/avatar collision;
- self-collision;
- cloth-cloth collision;
- floor;
- physics mesh reduzida;
- IA/LLM para inferir roupa;
- fitting anatômico final.

Essas etapas devem consumir uma montagem espacial já coerente, não compensar uma topologia inicial errada.

## Limitações matemáticas reais

Uma única seam reta entre dois painéis deixa o diedro subdeterminado. Components com várias soluções geometricamente equivalentes podem continuar espelhados ou parcialmente abertos até existir informação adicional. Relações fortemente incompatíveis preservam residual para a física.

Se futuramente for necessário melhorar convergência em graphs muito grandes/ambíguos, o próximo refinamento natural é um pose-graph optimizer contínuo sobre SE(3). Isso não muda o contrato material descrito aqui.
