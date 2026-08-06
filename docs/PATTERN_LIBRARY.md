# Biblioteca de moldes-base

## Escopo e nível de confiança

Esta biblioteca produz bases paramétricas editáveis em milímetros. Ela não substitui prova em toile, ajuste corporal, preparação industrial, revisão de margens ou conferência de montagem por profissional de modelagem.

A palavra **validado geometricamente** significa apenas que o gerador passou pelos invariantes automatizados descritos neste documento: contorno não degenerado, ausência de autointerseção detectável, dimensões-chave, compatibilidade entre bordas relacionadas, landmarks, fio, round trip V3, corpos de proporções variadas e snapshots 2D. Ela não significa validação de vestibilidade.

| Template | Versão | Sistema | Estado | Revisão manual |
|---|---|---|---|---|
| Corpo básico | `bodice-block@2` | Moldeon Reference Upper Block 2026 | validado geometricamente | pendente |
| Camiseta | `tshirt@2` | derivação da base superior | experimental no conjunto; corpo validado geometricamente; manga experimental | pendente |
| Blusa | `blouse@2` | derivação da base superior | experimental no conjunto; corpo validado geometricamente; manga experimental | pendente |
| Saia reta | `straight-skirt@2` | Moldeon Reference Skirt Block 2026 | validado geometricamente | pendente |
| Minissaia | `mini-skirt@2` | derivação da base de saia | validado geometricamente | pendente |
| Calça reta | `straight-pants@1` | gerador legado | experimental e fora do escopo desta etapa | pendente |
| Jaqueta | `basic-jacket@1` | não disponível | em desenvolvimento | pendente |

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

A camiseta e a blusa preservam uma manga compatível com o fluxo existente. A manga expõe cabeça frontal, cabeça traseira, pique frontal, dois piques traseiros, marca de ombro, bíceps e fio. Ela permanece **experimental** até a fase de manga derivada diretamente do comprimento das cavas e revisão manual.

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

- Nenhum dos templates `@2` foi provado em toile por esta execução.
- Nenhum recebeu comparação dimensional contra um bloco comercial ou industrial externo.
- Não há alegação de equivalência com FreeSewing ou com qualquer método editorial.
- Manga, calça, jaqueta, cós, vistas, revel, forro, gradação industrial e aberturas funcionais permanecem em fases próprias.
- As curvas são plausíveis e geometricamente testadas, mas ajuste de cava, balanço e distribuição de pence ainda precisam de revisão humana em corpos reais.
- Alterações livres feitas pelo usuário continuam pertencendo à geometria do projeto existente; uma nova versão de template não reescreve essas alterações.
