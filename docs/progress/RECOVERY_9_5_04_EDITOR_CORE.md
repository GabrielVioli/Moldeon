# Recovery 9.5-04 — Editor 2D essencial

Branch: `recovery/9.5-04-editor-core`

Base aprovada: `510ec523122b1cce767fcc42b1d7efc94627ab8f`

## Escopo

Este gate permanece restrito à interação essencial do editor 2D:

- seleção previsível de peça, nó, segmento e handles;
- desenho da primeira peça em bancada vazia;
- inserção de ponto em reta e curva;
- edição de segmento já existente;
- curvas Bézier e edição numérica exata de ponto/handle;
- zoom, pan, pinch e limpeza de seleção sem IDs incompatíveis;
- rotação direta de uma peça selecionada por handle visual de editor;
- undo/redo transacional durante drag, rotação e edição numérica.

Não pertencem a este gate: duplicar/espelhar/alinhamento/união/corte/pence/prega,
moldes-base, manga, costuras, classificação corporal, avatar, física ou Prompt 10.

## Fonte de verdade

O Documento V3/`garment.pieces` continua sendo a fonte de verdade. O guard do Canvas
é remontado quando a composição de peças ou a peça ativa muda, preservando a correção
aprovada no gate 9.5-03. A edição numérica trabalha exclusivamente sobre a peça ativa
existente no documento.

O handle de rotação é exclusivamente UI em coordenadas de tela. Ele não cria ponto,
segmento, dimensão ou qualquer entidade no Documento V3.

## Limpeza integral da seleção

O gesto legado do Canvas continua decidindo quando um pointer down/up constitui um
clique ou tap real no fundo. O gate 9.5-04 decora somente a ação de limpeza para que,
quando esse gesto é confirmado, todos os domínios de seleção sejam limpos juntos:

- peças selecionadas;
- ponto/nó;
- segmento/borda;
- pence;
- costura e borda temporariamente escolhida para costura;
- caminho interno, nó interno e segmento interno;
- sugestão de costura próxima.

Pan real, pinch, box selection e controles fora do Canvas não chamam essa ação. Escape
também executa a mesma limpeza após cancelar a operação temporária tratada pelo App.

## Hit testing

A prioridade normativa deste gate é:

1. handles Bézier;
2. pontos/nós;
3. landmarks, piques e marcadores;
4. controle de rotação, quando a peça inteira está selecionada;
5. segmentos;
6. linhas internas;
7. área da peça;
8. fundo.

A tolerância geométrica deve permanecer constante em pixels de tela; a conversão para
milímetros é `tolerânciaPx / zoom`. O controle de rotação possui alvo de toque maior no
mobile, sem aumentar o círculo visual.

## Rotação

Uma única peça selecionada exibe uma caixa de seleção e um controle circular com `↻`
no canto superior direito, ligeiramente fora da caixa. O controle:

- permanece em coordenadas de tela ao alterar zoom, pan ou viewport;
- possui área de interação maior do que o círculo visual;
- usa cursor de arraste em desktop;
- gira continuamente ao redor do centro local da peça;
- preserva o centro em coordenadas de mundo durante o gesto;
- exibe o ângulo enquanto o pointer está capturado;
- usa Shift para snapping de 15°;
- abre uma transação no pointer down e a confirma uma única vez no pointer up;
- cancela e restaura a transformação anterior em Escape/pointer cancel;
- fica oculto quando ponto, segmento, caminho interno, pence ou costura assumem a seleção.

A câmera do Canvas legado ainda é interna ao componente antigo. Para manter o controle
de rotação como DOM/UI e não geometria autoritativa, um bridge observa somente o par
`translate/scale` usado pelo draw do Canvas e replica a câmera para posicionar o overlay.
Esse bridge não altera desenho, Documento V3 ou hit testing da geometria.

## Curvas e inserção

A inserção usa `findNearestPatternSegment` e `insertPatternPoint`. Segmentos cúbicos são
divididos por De Casteljau, preservando a forma e remapeando referências por parâmetro
`t`. A suíte de domínio existente valida a preservação da curva amostrada.

O painel numérico do Canvas permite:

- X/Y do nó em milímetros;
- seleção individual de handle de entrada e saída;
- X/Y do vetor do handle;
- comprimento em milímetros;
- ângulo em graus;
- Escape para cancelar;
- Enter ou blur para confirmar.

Cada foco inicia uma transação e cada confirmação encerra uma transação, de modo que
uma edição numérica corresponda a um único passo de undo.

## Evidência automatizada prevista

- `editorCoreMath.test.ts`: tolerância por zoom, prioridade de hit testing, IDs válidos,
  conversão coordenadas ↔ comprimento/ângulo, posição do handle de rotação em zoom/pan,
  alvo mouse/touch e rotação centro-preservada;
- `editorCoreStore.test.ts`: primeira peça ativa, drag como uma transação, edição
  numérica de handle, limpeza completa entre stores, rotação transacional,
  cancelamento e undo/redo;
- `patternEditing.test.ts`: inserção em reta, De Casteljau em curva e remapeamento
  paramétrico de referências;
- `recovery-editor-core-blockers-visual.mjs`: clique/tap vazio, Escape, seleção múltipla,
  ponto/handle, zoom alto/baixo, handle visual de rotação e undo/redo em desktop/mobile;
- typecheck;
- suíte completa;
- build;
- roteiro visual desktop/mobile.

## Roteiro manual obrigatório

1. começar vazio e desenhar polígono fechado;
2. selecionar área, ponto, segmento e handles;
3. inserir ponto em reta e curva;
4. editar X/Y e handles numericamente;
5. aplicar zoom e pan e repetir as seleções;
6. selecionar uma peça, arrastar `↻`, verificar pivô/ângulo e undo/redo;
7. clicar/tocar no fundo após peça, múltiplas peças, ponto e handle selecionados;
8. usar Escape e confirmar que nenhum destaque/ID de seleção permanece;
9. repetir toque, pinch e rotação no mobile.

A etapa não é aprovada por este documento nem por CI. Ela permanece aguardando
validação manual explícita na URL de preview.
