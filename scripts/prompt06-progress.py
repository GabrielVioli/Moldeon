from pathlib import Path
import os

run_id = os.environ.get("GITHUB_RUN_ID", "não registrado")
implementation_commit = os.environ.get("IMPLEMENTATION_COMMIT", "não registrado")
head_commit = os.environ.get("GITHUB_SHA", "não registrado")

pattern_library = r'''# Biblioteca de moldes-base

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
'''

progress = f'''# Prompt 6: moldes-base de torso, camiseta, blusa e saias

## Estado

Implementação publicada em `main` em 5 de agosto de 2026.

- commit de implementação: `{implementation_commit}`;
- workflow de validação: `{run_id}`;
- commit que iniciou a execução: `{head_commit}`;
- versões: `bodice-block@2`, `tshirt@2`, `blouse@2`, `straight-skirt@2` e `mini-skirt@2`.

## Arquitetura entregue

`apps/web/src/patterns/basePatternDrafting.ts` concentra os novos geradores puros. O módulo usa o motor de fórmulas seguro do Prompt 5, produz variáveis versionadas, grafo construtivo V2, geometria 2D, fio, linhas de referência, pences, anotações, folgas e metadados de confiança.

O catálogo continua compatível com `GarmentDraft` e `PatternDocumentV3`. Projetos antigos mantêm a geometria e a versão já persistidas. Novos projetos registram sistema de construção, medidas exigidas e estimadas, folgas, limites e estado de revisão em cada `PatternGenerationRecord`.

Conectores V3 agora recebem landmarks determinísticos por papel semântico. A implementação não consulta nome de template ou peça para criar piques.

## Bases superiores

O corpo básico, a camiseta e a blusa compartilham uma construção estrutural versionada, mas usam opções estéticas diferentes. Frente e costas possuem:

- distribuição de busto, cintura e quadril calculada separadamente;
- decotes diferentes;
- comprimentos centrais diferentes;
- ombro calculado por comprimento e inclinação;
- profundidade e curvas de cava diferentes;
- níveis laterais compartilhados para compatibilidade;
- fio, centro na dobra, linhas de busto/cintura/quadril e landmarks.

A manga existente foi preservada para não quebrar as cinco costuras canônicas da montagem. Ela passou a ter assimetria frontal/traseira e landmarks, mas continua classificada como experimental e não é usada para declarar o template manualmente validado.

## Saias

Saia reta e minissaia usam frente/costas diferentes, distribuição de cintura e quadril, altura de quadril, curvas laterais e barras versionadas. A tomada das pences participa da largura aberta da cintura; zerar a tomada muda o contorno e a área, comprovado por teste.

A abertura futura da saia reta está documentada, sem geometria incompleta ou zíper fictício.

## Confiança

- `bodice-block@2`: validado geometricamente, revisão manual pendente;
- `tshirt@2` e `blouse@2`: experimentais no conjunto, corpo validado geometricamente e manga experimental;
- `straight-skirt@2` e `mini-skirt@2`: validados geometricamente, revisão manual pendente;
- nenhum template foi marcado como `manually-reviewed`;
- calça e jaqueta não foram promovidas.

## Verificações executadas

- `npm run typecheck`;
- atualização e repetição dos golden snapshots;
- suíte completa `npm test`;
- `npm run build`;
- invariantes em cinco corpos de proporções diferentes;
- área, perímetro, dimensões-chave, ombros, laterais e cavas;
- contornos degenerados e autointerseções;
- fio, landmarks e conectores V3;
- pences com efeito geométrico;
- continuidade ao alterar busto em passos de 10 mm;
- inspeção 2D de cada template e comparações entre corpos.

Os números finais da suíte e do build estão no log do workflow `{run_id}`. As evidências permanentes ficam em `docs/evidence/prompt06-base-patterns/`.

## Pesquisa e licenças

A pesquisa conceitual está registrada em `docs/PATTERN_LIBRARY.md`. Nenhuma dependência de runtime foi adicionada e nenhum código ou fórmula de projeto GPL/AGPL foi incorporado. FreeSewing e literatura pública foram usados para princípios, terminologia, distinção entre bloco e molde final, medidas, opções e necessidade de mock-up.

## Limitações

A auditoria é geométrica e visual em Chromium automatizado. Não houve toile, comparação externa de vestibilidade, aparelho físico, Safari, impressão 1:1 ou revisão presencial por modelista. O 3D foi explicitamente excluído como prova de correção.
'''

readme_path = Path("README.md")
readme = readme_path.read_text(encoding="utf-8")
readme = readme.replace(
    "- Biblioteca paramétrica com camiseta, blusa, saia, minissaia e calça; a jaqueta aparece como **Em desenvolvimento** até possuir bloco próprio validado.\n- Geração por altura, busto/tórax, cintura e quadril explícitos.\n",
    "- Biblioteca versionada com corpo básico, camiseta, blusa, saia reta e minissaia reconstruídos por fórmulas; calça permanece experimental e jaqueta indisponível.\n- Geração por perfil corporal expandido, com medidas informadas, estimadas e derivadas identificadas e substituíveis.\n- Estado de confiança separado entre experimental, validado geometricamente e revisado manualmente; nenhum template é promovido somente por compilar ou triangular.\n",
)
readme = readme.replace(
    "- Projetos com frente, costas, manga, quantidade de corte e corte na dobra.\n",
    "- Projetos com frente e costas distintas, quantidade de corte, dobra, fio, pences, conectores e landmarks; mangas atuais permanecem experimentais até sua fase dedicada.\n",
)
readme = readme.replace(
    "- Camiseta, blusa, saias e calça são bases paramétricas editáveis com fio, bordas semânticas e linhas construtivas; a jaqueta permanece indisponível enquanto não houver bloco próprio validado.\n- As saias incluem pences persistentes de cintura. Transferência de pence, graduação, cós, vistas e aviamentos ainda não foram implementados.\n",
    "- Corpo básico, corpos de camiseta/blusa e saias `@2` passaram por validação geométrica automatizada, mas ainda exigem toile e revisão manual; isso não equivale a validação industrial.\n- As mangas de camiseta/blusa, a calça `@1` e qualquer jaqueta permanecem experimentais ou indisponíveis.\n- As saias incluem pences estruturais de cintura. Transferência de pence, gradação, cós, vistas, aberturas funcionais e aviamentos ainda não foram implementados.\n",
)
readme = readme.replace(
    "Ampliar a montagem estrutural e sua validação antes de conectar física XPBD, autocolisão ou alegações de caimento físico ao viewport.\n",
    "Validar manualmente os blocos `@2` em toile e executar as fases próprias de manga e calça antes de ampliar alegações de vestibilidade ou conectar física XPBD.\n",
)
readme_path.write_text(readme, encoding="utf-8")

Path("docs/PATTERN_LIBRARY.md").write_text(pattern_library, encoding="utf-8")
Path("docs/progress/PROMPT_06_BASE_PATTERNS.md").write_text(progress, encoding="utf-8")
print("Prompt 6 documentation written")
