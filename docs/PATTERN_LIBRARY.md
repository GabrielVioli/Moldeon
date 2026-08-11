# Biblioteca de moldes-base

## Decisão de produto para o fechamento do 9.5-06

Nenhum molde automático desta biblioteca está disponível na experiência pública. Todos os itens possuem `visibility: internal` e `releaseStatus: deferred`. A biblioteca continua visível, mas oferece somente a criação de uma bancada vazia.

Esta decisão é deliberada: os testes matemáticos e computacionais confirmam integridade da geometria, não validade de modelagem para corte, costura ou vestibilidade. A revisão visual manual reprovou as formas disponíveis, em especial camiseta e calça, e isso invalida qualquer apresentação delas como soluções prontas. Rótulos como “experimental” ou “validado geometricamente” não tornam um molde tecnicamente reconhecível.

Os geradores, fórmulas, metadados, conectores, testes e registros metodológicos permanecem no código para pesquisa, compatibilidade e revisão futura. Projetos antigos preservam a geometria já salva; abrir um arquivo antigo não depende da visibilidade pública nem provoca regeneração silenciosa.

## Escopo e nível de confiança

Internamente, esta biblioteca produz bases paramétricas editáveis em milímetros. Nenhuma delas está pronta para uso de produção. Ela não substitui prova em toile, ajuste corporal, preparação industrial, revisão de margens ou conferência de montagem por profissional de modelagem.

A palavra **validado geometricamente** significa apenas que o gerador passou pelos invariantes automatizados descritos neste documento: contorno não degenerado, ausência de autointerseção detectável, dimensões-chave, compatibilidade entre bordas relacionadas, landmarks, fio, round trip V3, corpos de proporções variadas e snapshots 2D. Ela não significa validação de vestibilidade.

| Template | Versão | Sistema | Estado | Revisão manual |
|---|---|---|---|---|
| Corpo básico | `bodice-block@3` | adaptação Brian/Teagan 2026.3 | interno e adiado | reprovado para publicação |
| Camiseta | `tshirt@4` | adaptação Brian/Teagan + `guided-sleeve@1` | interno e adiado | reprovado para publicação |
| Blusa | `blouse@4` | adaptação Brian/Teagan + `guided-sleeve@1` | interno e adiado | reprovado para publicação |
| Saia reta | `straight-skirt@3` | adaptação Penelope 2026.3 | interno e adiado | não aprovada para publicação |
| Minissaia | `mini-skirt@3` | adaptação Penelope 2026.3 | interno e adiado | não aprovada para publicação |
| Calça reta | `straight-pants@3` | adaptação Titan 2026.3 | interno e adiado | reprovado para publicação |
| Jaqueta | `basic-jacket@1` | método pendente | interno e adiado | indisponível |

Projetos já gerados continuam armazenando a geometria e a versão usadas. Abrir um projeto antigo não troca `@1` por `@2` nem regenera o molde silenciosamente.

## Fontes e método de pesquisa

As referências abaixo foram usadas para princípios, vocabulário, separação de medidas e opções, necessidade de mock-up e critérios de qualidade. Não houve cópia de código, AST, coordenadas ou fórmulas de FreeSewing, Seamly2D, Valentina ou material proprietário.

1. FreeSewing, **Pattern design best practices**: reutilização de medidas e opções, marcações completas, preferência por parâmetros escaláveis e testes em diferentes escalas. <https://freesewing.dev/guides/best-practices/>
2. FreeSewing, **Measurements**: nomes padronizados para medidas como frente/costas de cintura e assento, inclinação de ombro, profundidade de gancho e alturas corporais. <https://freesewing.dev/reference/measurements/>
3. FreeSewing, **Bent body block instructions**: um bloco é base de transformação, não produto final, e deve passar por mock-up e ajustes. <https://freesewing.eu/docs/designs/bent/instructions/>
4. FreeSewing, **Brian body block** e catálogo de blocos: referência conceitual para separar bloco, medidas e opções. <https://freesewing.eu/designs/brian/>
5. FreeSewing, **Teagan T-shirt**, **Sarah Skirt Block** e **Penelope pencil skirt**: referências conceituais para derivação de peça, folga e componentes, sem transposição de código. <https://freesewing.eu/designs/teagan/> <https://freesewing.eu/docs/designs/sarah/> <https://freesewing.eu/designs/penelope/>
6. Natalie Bray, **Dress Pattern Designing: The Basic Principles of Cut and Fit**, edição catalogada como domínio público no Google Books: referência histórica de terminologia e processo de bloco, sem reprodução de texto ou tabelas. <https://books.google.com/books/about/Dress_Pattern_Designing_the_Basic_Princi.html?id=7wymzgEACAAJ>

O método Moldeon é original e deliberadamente conservador:

- medidas reais são autoritativas;
- medidas ausentes usam somente estimativas versionadas do perfil corporal;
- frente e costas são calculadas separadamente;
- folgas são entradas explícitas;
- fórmulas estruturais e regras estéticas são identificadas separadamente;
- curvas Bézier são construídas a partir de landmarks calculados;
- resultados são verificados em cinco corpos de proporções diferentes;
- nenhuma forma recebe estado `manually-reviewed` sem prova externa registrada.

## Base superior

### Medidas usadas

Busto/tórax, cintura, quadril, largura frontal, largura traseira, largura de pescoço, comprimento e inclinação do ombro, profundidade de cava, comprimento frontal de cintura, comprimento traseiro de cintura e altura do quadril.

Pescoço, ombro, cava, larguras frontal/traseira e alturas podem vir do perfil estimado, mas continuam substituíveis. A origem de cada medida é persistida.

### Fórmulas estruturais principais

Todas as fórmulas são avaliadas pelo motor seguro V1, com unidades e dependências registradas.

| Variável | Fórmula resumida | Natureza |
|---|---|---|
| participação frontal | `clamp(larguraFrente / (larguraFrente + larguraCostas), 0,46, 0,54)` | construção |
| meio busto vestido | `(busto + folgaBusto) / 2` | construção |
| largura frontal no busto | `meioBustoVestido * participaçãoFrontal` | construção |
| largura traseira no busto | `meioBustoVestido - larguraFrontal` | construção |
| projeção horizontal do ombro | `comprimentoOmbro * cos(inclinaçãoOmbro)` limitada pela largura disponível | construção |
| queda do ombro | `max(8 mm, comprimentoOmbro * sin(inclinaçãoOmbro))` | construção |
| linha lateral de cintura | média entre comprimentos frontal e traseiro de cintura | construção/equilíbrio |
| linha de quadril | cintura lateral + altura do quadril | construção |
| largura de barra | largura de quadril da peça × fator de barra | estética versionada |
| profundidade de decote | mínimo entre opção estética e fração da profundidade de cava | estética com limite estrutural |

Frente e costas têm profundidades de decote, larguras, comprimentos centrais, pontos de cava e controles Bézier diferentes. Os ombros partem do mesmo comprimento medido, e as laterais compartilham níveis verticais para manter compatibilidade dentro da tolerância.

### Folgas

| Base | Busto | Cintura | Quadril | Observação |
|---|---:|---:|---:|---|
| Corpo básico | 40 mm | 20 mm | 35 mm | bloco de referência, não molde final |
| Camiseta | 100 mm | 120 mm | 100 mm | folga estética regular |
| Blusa | 160 mm | 180 mm | 160 mm | volume mais solto |

Esses valores são regras estéticas versionadas. Eles não são apresentados como padrão industrial universal.

### Landmarks e conectores

Frente e costas possuem centro na dobra, decote, ombro, cava frontal ou traseira, lateral, cintura, quadril, barra e fio. O V3 gera landmarks de início/fim, marca de ombro, um pique frontal e dois piques traseiros a partir do papel semântico do conector, sem consultar nome de template.

A camiseta `tshirt@4` e a blusa `blouse@4`, mantidas apenas internamente, nascem com uma manga `guided-sleeve@1` derivada dos arcos reais das cavas. A cabeça possui frente e costas independentes, ápice, um pique frontal, dois piques traseiros e duas instâncias espelhadas. Projetos de versões anteriores já salvos preservam a geometria legada; a troca continua exigindo confirmação explícita no assistente. Consulte `docs/SLEEVE_SYSTEM.md`.

## Saia reta e minissaia

### Fórmulas estruturais principais

| Variável | Fórmula resumida | Natureza |
|---|---|---|
| meio quadril vestido | `(quadril + folgaQuadril) / 2` | construção |
| meio cintura vestido | `(cintura + folgaCintura) / 2` | construção |
| quadril frontal | meio quadril × participação frontal | construção |
| quadril traseiro | meio quadril − quadril frontal | construção |
| supressão | `max(0, larguraQuadril − larguraCintura)` | construção |
| pence frontal | `min(30 mm, supressãoFrontal × 0,34)` | construção versionada |
| pence traseira | `min(40 mm, supressãoTraseira × 0,46)` | construção versionada |
| largura aberta da cintura | largura final + tomada da pence | construção estrutural |
| altura de quadril | medida direta ou estimada versionada | construção |
| comprimento | máximo entre limite mínimo e altura × proporção | estética versionada |
| barra | largura de quadril × fator de barra | estética versionada |

A pence não é uma anotação isolada. Sua tomada aumenta a largura aberta da cintura e o documento registra pernas, ápice, centro, largura, comprimento e fechamento estrutural. Remover a tomada muda área e contorno do molde.

Frente e costas usam distribuições, pences, alturas centrais e curvas laterais diferentes. Ambas possuem centro na dobra, cintura, lateral, quadril, barra e fio.

A saia reta documenta uma abertura traseira como extensão futura. Nenhum recorte, zíper ou abertura incompleta é persistido nesta versão.

## Tolerâncias e golden datasets

Os testes usam os corpos `small`, `medium`, `large`, `tall-narrow` e `short-wide`.

| Verificação | Tolerância ou regra |
|---|---|
| comprimento de ombro frente/costas | diferença máxima de 0,8 mm |
| laterais superiores | diferença máxima de 8 mm |
| laterais de saia | diferença máxima de 6 mm |
| área mínima por painel | 4.000 mm² |
| pontos e alças | valores finitos |
| contorno | sem autointerseção ou degeneração detectada |
| atualização de busto | crescimento monotônico, sem inversão e sem salto acima do limite de auditoria |
| golden metrics | área, perímetro, largura, altura, ombro, lateral, cavas e pences em snapshot versionado |

Snapshots visuais 2D mostram frente e costas lado a lado e comparam as cinco proporções corporais. O viewport 3D não participa da aprovação.

## Limitações registradas

- Nenhum dos templates atuais foi provado em toile por esta execução.
- Nenhum recebeu comparação dimensional contra um bloco comercial ou industrial externo.
- Não há alegação de equivalência com FreeSewing ou com qualquer método editorial.
- Jaqueta, cós, vistas, revel, forro, gradação industrial e aberturas funcionais permanecem em fases próprias.
- As curvas são plausíveis e geometricamente testadas, mas ajuste de cava, balanço e distribuição de pence ainda precisam de revisão humana em corpos reais.
- Alterações livres feitas pelo usuário continuam pertencendo à geometria do projeto existente; uma nova versão de template não reescreve essas alterações.

<!-- PROMPT07_TROUSERS_START -->

## Calça reta paramétrica `straight-pants@3` (infraestrutura interna adiada)

### Estado e escopo

A calça usa duas definições 2D autoritativas, `straight-pants-front` e `straight-pants-back`. Cada definição declara `cutQuantity: 2` e placements explícitos para esquerda e direita. A expansão física resulta em quatro instâncias determinísticas, sem duplicar a geometria:

```text
straight-pants-front:panel:1  → frente esquerda
straight-pants-front:panel:2  → frente direita espelhada
straight-pants-back:panel:1   → costas esquerda
straight-pants-back:panel:2   → costas direita espelhada
```

O status **validado geometricamente** significa que frente e costas passaram por invariantes de contorno, área, perímetro, dimensões, conectores, pences, golden datasets e continuidade paramétrica. A montagem lógica prova duas pernas tubulares e a continuidade do gancho. Não significa validação de vestibilidade, gradação ou produção industrial.

### Referências comparadas

1. FreeSewing Paco, Charlie, Titan e Crux: esses projetos separam medidas verticais e circunferências, incluindo cintura, assento/quadril, entreperna, joelho, alturas até níveis corporais e medidas traseiras. Paco e Charlie são derivados do bloco Titan, reforçando a separação entre bloco e derivação de estilo. Fontes: <https://freesewing.org/designs/paco/> <https://freesewing.org/designs/charlie/> <https://freesewing.org/designs/crux/> <https://freesewing.dev/blog/2024/05/15/beta-titan>
2. Threads, *How to Draft a Basic Pants Pattern*: referência conceitual para usar profundidade de gancho, comprimentos frontal e traseiro distintos, linha de vinco e níveis de joelho e barra. Fonte: <https://www.threadsmagazine.com/project-guides/fit-and-sew-pants/how-to-draft-a-basic-pants-pattern>
3. NuriaMo, *Trouser Foundation*: exemplo público acessível de construção com linhas de cintura, quadril, gancho, joelho e extensões frontal/traseira diferentes. Foi usado apenas para comparação visual e terminologia, não para copiar coordenadas ou fórmulas. Fonte: <https://nuriamo.com/trouser-foundation-pattern-drafting/>

A abordagem adotada é original e conservadora. Ela combina a riqueza de medidas diretas vista nos sistemas paramétricos com uma construção própria, auditável e versionada. Nenhum código, AST ou fórmula de FreeSewing foi incorporado. Valores ausentes continuam sendo estimativas identificadas pelo perfil corporal do Moldeon.

### Medidas

Medidas principais: cintura, quadril, altura do quadril, altura de gancho sentado, profundidade do gancho, profundidade do assento, queda de cintura, coxa, joelho, tornozelo, gancho ao joelho, comprimento lateral e entrepernas.

Altura de quadril, gancho sentado, profundidades, coxa, joelho, tornozelo e comprimentos podem ser estimados pelo perfil versionado quando não forem informados. A origem de cada valor é persistida e pode ser substituída pelo usuário.

### Fórmulas estruturais principais

| Variável | Fórmula resumida | Natureza |
|---|---|---|
| meio quadril vestido | `(quadril + 55 mm) / 2` | construção |
| distribuição frontal de quadril | `meioQuadril × 0,48` | construção versionada |
| distribuição traseira de quadril | restante do meio quadril | construção versionada |
| meio cintura vestido | `(cintura + 30 mm) / 2` | construção |
| distribuição frontal de cintura | `meioCintura × 0,47` | construção versionada |
| linha de gancho | altura sentada limitada entre quadril + margem e 430 mm | construção |
| extensão frontal | parcela menor de profundidade de gancho e assento | construção |
| extensão traseira | parcela maior de profundidade de gancho e assento | construção |
| elevação traseira | queda de cintura + participação da profundidade do assento | construção |
| linha de joelho | gancho + distância gancho-joelho limitada pela entreperna | construção |
| largura de coxa | circunferência da coxa + 40 mm, distribuída entre frente/costas | construção/folga |
| largura de joelho | joelho + 50 mm, distribuído entre frente/costas | construção/folga |
| barra reta | `max(380 mm, tornozelo + 120 mm)` | regra estética versionada |

A extensão frontal e traseira não é classificada como entreperna. Ela pertence ao conector de gancho. A entreperna cobre apenas a linha que une frente e costas de cada perna.

### Geometria e landmarks

A frente contém cintura inclinada, pence opcional, quadril, gancho frontal, lateral, entreperna, joelho, barra, centro da perna e fio. As costas possuem cintura elevada, pence traseira, maior distribuição de quadril, extensão e curva de gancho próprias, lateral e entreperna diferentes.

As linhas internas persistidas são:

- linha do quadril;
- linha do gancho;
- linha do joelho;
- centro/vinco da perna.

Anotações identificam quadril, joelho, gancho, fio e quantidade de corte. Os conectores V3 são derivados dos papéis semânticos `waist`, `outseam`, `inseam`, `frontCrotch`, `backCrotch` e `hem`, sem consultar o nome da peça.

### Montagem lógica das quatro instâncias

O módulo `domain/trouserLogicalAssembly.ts` expande as duas definições e cria seis relações lógicas:

- lateral esquerda e lateral direita;
- entreperna esquerda e entreperna direita;
- gancho frontal entre as duas frentes;
- gancho traseiro entre as duas costas.

Cada perna é tubular quando sua frente e costas estão ligadas simultaneamente por lateral e entreperna. O caminho do gancho é contínuo quando os ganchos frontal e traseiro ligam os lados e as duas entrepernas formam as junções inferiores. As quatro cinturas e quatro barras permanecem abertas.

O runtime legado de `Seam` recebe somente os intervalos de lateral e entreperna que consegue representar sem perda. Os ganchos entre cópias ficam no grafo de instâncias até a montagem e o solver consumirem relações diretamente por `PanelInstanceV3`. Isso evita a autocostura incorreta de cada cópia consigo mesma.

### Diagnósticos

A validação informa IDs de instância e conectores ao detectar:

- quatro painéis no mesmo lado;
- espelhamento igual nas cópias esquerda e direita;
- conector ausente;
- lateral ou entreperna cruzando lados;
- gancho frontal/traseiro torcido;
- perna incompleta;
- continuidade de gancho incompleta;
- ID de instância duplicado.

Selecionar uma instância lógica permite localizar sua definição 2D por `sourcePatternId`. A assinatura da geometria confirma que editar a frente atualiza somente as duas frentes e editar as costas atualiza somente as duas costas.

### Tolerâncias e validação

| Verificação | Regra |
|---|---|
| área mínima por definição | 30.000 mm² |
| diferença de lateral frente/costas | até 18 mm |
| diferença de entreperna frente/costas | até 22 mm |
| contorno | sem degeneração ou autointerseção detectada |
| instâncias | quatro IDs determinísticos e únicos |
| pernas | dois componentes tubulares |
| gancho | frontal e traseiro contínuos no grafo |
| aberturas | cintura e barras não costuradas |
| atualização paramétrica | crescimento contínuo, sem inversões |

Golden datasets cobrem corpos pequeno, médio, grande, alto-estreito e baixo-largo. A evidência visual mostra frente/costas lado a lado, comparação dos cinco corpos e o grafo das quatro instâncias.

### Limitações

- Nenhuma toile foi confeccionada.
- Não houve revisão presencial por modelista, comparação com bloco industrial ou impressão 1:1.
- Braguilha, zíper, cós, bolsos, vistas, forro, pregas, modelagem jeans e gradação permanecem fora do escopo.
- A montagem validada é topológica e semântica. Gravidade, colisão, autocolisão, distribuição de folga e caimento ficam para XPBD.
- A auditoria visual usa Chromium automatizado, não aparelho físico ou Safari.

<!-- PROMPT07_TROUSERS_END -->

<!-- PROMPT08_SLEEVES_START -->

## Sistema guiado de mangas `guided-sleeve@1`

O sistema mede as cavas frontal e traseira da geometria atual, resolve uma cabeça assimétrica por comprimento de arco e cria uma definição com duas instâncias. Ele não depende do nome do template ou da posição das peças na bancada.

A compatibilidade é avaliada separadamente para frente e costas. A cabeça contém ápice, pique frontal, dois piques traseiros e axilas; a manga longa acrescenta linha de cotovelo. Costuras e landmarks são persistidos semanticamente e a criação completa participa de undo/redo.

O assistente foi validado em fluxo Chrome desktop e mobile emulado. A validação de vestibilidade continua pendente. Fórmulas, tolerâncias, pesquisa e limitações estão em `docs/SLEEVE_SYSTEM.md`.

<!-- PROMPT08_SLEEVES_END -->
