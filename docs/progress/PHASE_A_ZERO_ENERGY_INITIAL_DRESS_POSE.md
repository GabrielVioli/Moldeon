# PHASE A — Zero-energy initial dress pose

## Resultado

O STEP 0 passa a representar a pose de montagem em repouso. O XPBD não é
usado para montar a roupa: quando métrica, shear e seams já estão satisfeitos,
o solver preserva a forma relativa exatamente e integra apenas a translação
comum da queda livre.

## Contrato implementado

- Comprimentos estruturais e shear usam a geometria material 2D como rest
  state imutável.
- Curvatura/dobra usa o ângulo diedro da pose de montagem como rest state; isso
  não redefine comprimento, área ou orientação material.
- Costuras físicas compatíveis fecham em distância zero. O clearance legado de
  1,5 mm permanece restrito à estratégia visual antiga.
- Pences fechadas são materializadas na topologia e recebem uma semente
  desenvolvível: as pernas coincidem, o ápice continua materialmente contínuo
  e nenhuma aresta é encurtada para fechar a intake.
- O coarse mesh é aninhado no fine mesh. A transferência usa os triângulos
  coarse realmente resolvidos, preservando ownership e source mapping.
- Candidatos de assembly com forte auto-sobreposição não podem vencer apenas
  por terem um custo escalar menor.
- O polish geométrico de STEP 0 alterna closures e barras materiais, mas faz
  rollback se a aproximação da seam comprar fechamento por dano material.
- Um estado realmente em equilíbrio, sem body collision e sem pins, usa o
  caminho analítico de free flight. Nenhuma iteração XPBD adiciona ruído,
  rotação ou energia interna.
- Fora do equilíbrio, seams usam o trust region físico completo. Isso corrige
  a abertura transitória do gancho real da calça sem alterar compliance nem
  afrouxar os gates.

## Gates automatizados

Fixtures representativas:

1. tubo de uma única PanelInstance com self-seam;
2. tubo de quatro painéis;
3. peça com pence fechada;
4. casca de quatro painéis com faixa estreita/cós fechado.

Para cada fixture:

- STEP 0: seam máxima < 0,5 mm;
- stretch máximo < 1,001 e compressão mínima > 0,999;
- shear máximo < 0,001;
- área por triângulo entre 0,998 e 1,002;
- gravity 0, collision OFF, 500 steps: delta relativo < 0,5 mm;
- gravity 100%, collision OFF, 500 steps: delta relativo < 0,5 mm e queda do
  centroide > 1 m;
- reset × 10: STEP 0 e trajetória de 32 passos bit a bit idênticos.

Regressão adicional real de calça composta:

- passo 240: seam frontal média 3,16 mm, traseira 3,12 mm;
- passo 480: seam frontal média 0,64 mm/máxima 8,01 mm; traseira média
  0,08 mm/máxima 0,81 mm.

## Validação visual executada

- tubo de uma peça: estrutura fechada e regular no STEP 0;
- tubo de quatro painéis: volume fechado sem painéis ausentes;
- gravity 0 por mais de 500 passos: assinatura geométrica inalterada;
- reset × 10: assinatura do STEP 0 idêntica;
- gravity 100% sem colisão: queda livre sem alteração perceptível da forma
  relativa.

## Preservações

PatternDocumentV3, PanelInstanceV3, SeamGroup, composite edge ranges, source
mapping, Worker generation/epoch/revision e as otimizações de body collision
da 11.0.2 permanecem preservados. Não foi implementado novo avatar, placement
corporal ou collision mesh nesta fase.
