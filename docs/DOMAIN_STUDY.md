# Estudo de domínio: costura, modelagem e roupa digital

Este documento registra as decisões de domínio que orientam o Moldeon. Ele não
substitui formação profissional em modelagem, prova de roupa ou engenharia
têxtil. O objetivo é impedir que o produto trate moldes como desenhos
genéricos sem relação com a construção de uma peça real.

## 1. O que é um molde utilizável

Uma roupa cortada e costurada é descrita por mais do que um contorno. O modelo
mínimo precisa conter:

- medidas corporais que serviram de base;
- folga de vestibilidade e folga de design separadas das medidas do corpo;
- um ou mais painéis 2D fechados;
- segmentos retos ou curvos de cada painel;
- linha de costura e linha de corte;
- margem de costura, que pode variar por segmento;
- quantidade a cortar, espelhamento e corte na dobra;
- fio do tecido;
- piques, pences, linhas internas e marcações;
- relações de costura entre intervalos de bordas;
- orientação e posição inicial dos painéis ao redor do avatar;
- tecido e propriedades físicas;
- ordem ou instruções de montagem.

Essa estrutura coincide com a representação usada em pesquisa de roupa
digital: painéis 2D, curvas, pontos, relações de costura e posicionamento 3D
são entidades explícitas, não um efeito colateral do renderer.

## 2. Medidas, tamanho e folga

### Medidas do corpo

As medidas do corpo são a entrada. A ISO 8559-1 define medidas
antropométricas para bases físicas e digitais e para a criação de perfis de
tamanho e forma. A identificação de tamanho deve partir dessas medidas, não
das dimensões finais da roupa.

O Moldeon deve usar nomes estáveis para as medidas e milímetros internamente.
O conjunto inicial será:

- altura;
- busto ou tórax;
- cintura;
- quadril;
- pescoço;
- largura de ombros;
- comprimento ombro-cintura;
- comprimento do braço;
- bíceps;
- gancho;
- entrepernas.

Medidas adicionais entram conforme a categoria exigir. Um molde não deve pedir
uma medida exclusiva quando uma medida equivalente já existe no sistema.

### Tamanho não é medida

Não existe um tamanho `M` universal. Sistemas, públicos e marcas distribuem
medidas e folgas de formas diferentes. Por isso:

- o catálogo poderá mostrar presets convenientes;
- todo preset exibirá as medidas corporais usadas;
- a geometria paramétrica será regenerada a partir de medidas explícitas;
- o arquivo continuará guardando as medidas, mesmo depois de edições livres.

### Folga

Devem existir dois conceitos separados:

- **folga funcional**: espaço necessário para respirar, sentar e se mover;
- **folga de design**: volume intencional que cria a silhueta.

A dimensão final da roupa é consequência de medida corporal, folga funcional e
folga de design. A folga não deve ficar escondida dentro de constantes
inexplicáveis do gerador.

## 3. Bloco-base, molde e modelo

- **Bloco-base** é uma fundação ajustada a um conjunto de medidas e com folga
  controlada. Serve para derivar outros desenhos.
- **Molde** é a geometria preparada para cortar e montar uma roupa, com peças,
  margens e marcações.
- **Modelo** é uma variação de estilo: comprimento, volume, gola, manga,
  recortes e outros detalhes.

A biblioteca do Moldeon deve ser paramétrica e componentizada. Camiseta,
blusa e jaqueta podem compartilhar componentes de corpo, cava, manga e gola,
mas cada modelo mantém seus próprios parâmetros e regras.

## 4. Princípios de transformação do molde

As operações fundamentais de modelagem plana são:

- deslocar pontos e ajustar curvas sem perder continuidade;
- cortar e abrir para acrescentar volume;
- fechar e transferir pences preservando a soma de suas aberturas;
- contornar para aproximar o tecido de volumes do corpo;
- espelhar e desdobrar peças;
- prolongar, encurtar, alargar e estreitar em linhas controladas;
- conferir comprimentos que serão costurados;
- adicionar e remover folga localmente;
- graduar ou, de preferência no fluxo sob medida, regenerar a partir das
  medidas.

Pences transformam excesso plano em volume tridimensional. Elas precisam ser
entidades próprias, não triângulos desenhados sem significado.

## 5. Curvas e encaixe entre peças

Curvas de cava, decote, quadril, gancho e cabeça de manga têm função
construtiva. Uma curva não deve ser avaliada apenas pela aparência:

- o comprimento costurável precisa ser medido ao longo da curva;
- tangentes devem poder ser contínuas nos encontros;
- duas bordas relacionadas precisam informar a diferença de comprimento;
- piques dividem e orientam relações de costura sem obrigar a dividir o
  contorno visual;
- a cabeça de manga não é uma cópia da cava: sua forma e seu comprimento
  controlam o ângulo de repouso e o caimento.

O editor mantém Bézier cúbica, mas passa a identificar semanticamente bordas e
intervalos de borda.

## 6. Linha de costura, corte e marcações

A linha de costura é a referência geométrica do modelo. A linha de corte é
derivada da margem de costura. Essa separação evita acumular erros ao alterar a
margem.

O formato futuro precisa suportar:

- margem padrão por peça;
- substituição por segmento, inclusive bainha;
- tipos de canto e limite de miter;
- margem zero em dobra;
- linha de fio;
- dobra, piques simples/duplos, furos e pontos de montagem;
- etiquetas com nome, quantidade, material e orientação;
- linha interna, pence, bolso, prega e posição de aviamentos.

Tipos de ponto e de costura devem ser metadados normalizados. ISO 4915 e ISO
4916 classificam pontos e costuras; ASTM D6193 também descreve categoria,
formação e finalidade. O primeiro protótipo não precisa implementar todas as
classes, mas o arquivo não deve bloquear essa evolução.

## 7. Peças essenciais do catálogo

O catálogo inicial prioriza topologias simples e reconhecíveis:

| Modelo | Peças mínimas | Variações iniciais |
|---|---|---|
| Camiseta | frente, costas, manga | comprimento do corpo e manga, folga |
| Blusa | frente, costas, manga | folga, comprimento, decote |
| Saia reta | frente, costas | comprimento e folga de quadril |
| Minissaia | frente, costas | comprimento e leve abertura |
| Calça reta | frente, costas | comprimento, largura de perna e folga |
| Jaqueta básica | duas frentes, costas, manga | comprimento e folga |

Na primeira versão, esses moldes são bases editáveis e não prometem ajuste
industrial pronto para produção. Cada cartão deve dizer isso claramente.

## 8. Representação 2D e 3D

O documento de roupa será composto por:

```text
GarmentDraft
  measurements
  designParameters
  pieces[]
    contour
    annotations
    grainline
    cutInstruction
    previewPlacements[]
  seams[]
    first edge interval
    second edge interval
    direction
  fabric
```

O posicionamento inicial ao redor do corpo é obrigatório para uma prévia
coerente. Ferramentas como CLO usam pontos e volumes de arranjo antes da
simulação. Uma relação de costura conecta duas bordas e precisa preservar sua
direção; inverter a direção pode torcer o resultado.

O 3D não pode continuar duplicando automaticamente uma única peça como
“frente” e “costas”. Ele deve renderizar as instâncias declaradas por cada
painel e, depois, aplicar as relações de costura.

## 9. Física do tecido

A malha física será separada da geometria de edição. O caminho planejado:

1. amostrar curvas com erro ou espaçamento limitado;
2. gerar uma malha 2D com densidade adaptável;
3. posicionar painéis ao redor do avatar;
4. criar restrições de costura;
5. aplicar gravidade;
6. resolver alongamento na direção do urdume e da trama;
7. resolver cisalhamento e flexão;
8. resolver colisão com o avatar;
9. atualizar a malha visual.

XPBD é apropriado para a referência em tempo real porque a compliance reduz a
dependência da rigidez em relação ao passo de tempo e ao número de iterações.
Autocolisão, espessura, atrito e aviamentos continuam etapas posteriores.

## 10. Desempenho no celular

As regras de produto são:

- abrir sempre no editor 2D;
- carregar catálogo, 3D, avatar e física sob demanda;
- não simular com a aba 3D oculta;
- limitar DPR, resolução da malha e iterações por perfil;
- atualizar Canvas e gestos no máximo uma vez por frame;
- armazenar geometria em estruturas pequenas e transferir buffers ao Worker;
- manter um nível de prévia rápido e um nível de qualidade manual;
- evitar bibliotecas para operações geométricas simples;
- validar cada molde no momento da geração, não dentro do renderer.

## 11. Impressão e fabricação

Milímetros permanecem como unidade interna. SVG e PDF devem declarar dimensões
físicas. O padrão CSS relaciona `mm`, `cm`, `in`, `pt` e `px`, mas o usuário
ainda pode pedir ao driver da impressora para ajustar a página. Toda exportação
para fabricação deve incluir:

- quadrado de calibração;
- instrução para imprimir a 100% ou “tamanho real”;
- paginação com sobreposição e marcas de montagem;
- identificação de cada página e peça;
- opção de folha inteira para plotter.

## 12. Referências consultadas

- [ISO 8559-1: definições antropométricas para roupas](https://www.iso.org/standard/61686.html)
- [ISO 8559-2: tamanho baseado em medidas corporais](https://www.iso.org/standard/64075.html)
- [ISO 4915: classificação de tipos de ponto](https://www.iso.org/standard/10932.html)
- [ISO 4916: classificação de tipos de costura](https://www.iso.org/standard/10934.html)
- [ASTM D6193: prática para pontos e costuras](https://store.astm.org/d6193-16r25.html)
- [FreeSewing: medidas usadas](https://freesewing.eu/docs/measurements/)
- [FreeSewing: boas práticas de desenho paramétrico](https://freesewing.dev/guides/best-practices/)
- [FreeSewing: milímetros, SVG e Bézier](https://freesewing.dev/guides/prerequisites/)
- [CLO: costura entre segmentos e conferência de comprimento](https://support.clo3d.com/hc/en-us/articles/115012381248-Segment-Sewing)
- [CLO: posicionamento de painéis ao redor do avatar](https://support.clo3d.com/hc/en-us/articles/115001999287-Arrange-Pattern-with-Arrangement-Points-Flip-Wrap-Direction)
- [GarmentCode: moldes paramétricos componentizados](https://arxiv.org/html/2306.03642)
- [Dataset of 3D Garments: painéis, curvas, costuras e posição](https://arxiv.org/abs/2109.05633)
- [XPBD: simulação por restrições com compliance](https://matthias-research.github.io/pages/publications/XPBD.pdf)
- [W3C: unidades físicas para impressão](https://www.w3.org/TR/css-values-3/#absolute-lengths)

