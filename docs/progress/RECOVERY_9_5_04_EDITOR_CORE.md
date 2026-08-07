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
moldes-base, manga, costuras como funcionalidade nova, classificação corporal, avatar,
física ou Prompt 10.

## Fontes de verdade

O Documento V3 é o formato persistente canônico. No runtime atual,
`garment.pieces` determina quais peças existem e fornece a geometria que pode ser
renderizada ou atingida pelo hit testing. `PatternSnapshot` permanece apenas como
compatibilidade legada e não pode reintroduzir geometria ausente ou anterior.

Zoom, pan e pinch alteram somente a câmera. Todo frame agendado pelo Canvas consulta o
estado atual no momento do desenho. O listener nativo de wheel delega para o handler
mais recente, evitando closures do primeiro render. O `draw()` percorre
`garment.pieces`; o snapshot recebido por compatibilidade não é fonte de geometria.

## Limpeza autoritativa de seleção

`clearEditorSelection()` é a única ação de alto nível para limpar a seleção persistente
do editor. Ela converge os estados do store principal e do store de caminhos internos,
sem monkey patch de métodos Zustand e sem listener de teclado adicional no wrapper.

Ela limpa:

- peça e seleção múltipla;
- ponto/nó;
- segmento/borda;
- pence;
- costura;
- primeira borda e proposta temporária de costura;
- sugestão de costura próxima;
- caminho interno, nó interno e segmento interno.

Clique/tap real no fundo e Escape convergem para essa mesma ação. O App possui o
listener global de Escape; o Canvas não instala um segundo listener concorrente para
limpar seleção.

## Hit testing

A prioridade normativa continua:

1. handles Bézier;
2. pontos/nós;
3. landmarks, piques e marcadores;
4. segmentos;
5. linhas internas;
6. peça;
7. fundo.

Costuras nunca podem roubar o hit de um ponto ou handle que esteja sobre a própria
borda costurada. `findNearestSeamHit` rejeita o hit de costura dentro da tolerância de
um controle geométrico editável, preservando a costura e permitindo a edição do ponto.

A tolerância geométrica permanece em pixels de tela e é convertida para milímetros por
zoom.

## Edição numérica de curvas

O painel numérico aceita tanto um nó selecionado quanto um segmento selecionado.
Quando o segmento possui geometria cúbica, o fluxo expõe explicitamente:

- handle de saída do ponto inicial;
- handle de entrada do ponto final;
- X e Y do vetor;
- comprimento em milímetros;
- ângulo em graus.

Cada foco abre uma transação; Enter/blur confirma e Escape cancela a edição local.
A geometria resultante é gravada no documento atual e continua idêntica após zoom/pan.

## Rotação

Uma única peça selecionada pode exibir o controle `↻` fora da caixa de seleção. O
controle é UI em coordenadas de tela, não entidade do Documento V3. Ele mantém pivô no
centro local, Shift para 15°, uma transação por gesto e cancelamento sem persistir
transformação parcial.

O bridge de câmera do wrapper existe somente para posicionar esse overlay. Ele não é
fonte de geometria e não participa do redraw autoritativo do Canvas.

## Regressões cobertas

A suíte cobre, entre outros:

- criação da primeira peça;
- drag e edição numérica como transações;
- limpeza integral entre stores;
- ponto/handle sobre borda costurada com prioridade sobre costura;
- divisão de reta e curva por De Casteljau;
- RAF e wheel delegando para callbacks atuais;
- `draw()` consumindo `garment.pieces`, não `snapshot.piece`;
- edição numérica de handles a partir de segmento selecionado.

O fluxo de navegador `recovery-editor-core-live-regression.mjs` comprovou no commit
`fcf2e3911e5f80546398a90d5405d8efb10f7e24`:

- peça selecionada → clique no fundo → nenhuma seleção;
- ponto → Escape → nenhuma seleção;
- handle → Escape → nenhuma seleção;
- ponto sobre borda costurada selecionável;
- X/Y de ponto persistindo após zoom e pan;
- X/Y/comprimento/ângulo de handle persistindo após zoom e pan;
- comprimento de reta persistindo após zoom e pan;
- undo e redo preservados após zoom e pan.

Na mesma execução passaram `npm run typecheck`, `npm test` e `npm run build`.

## Roteiro manual obrigatório

1. selecionar peça e clicar/tocar em área realmente vazia;
2. selecionar ponto e usar Escape;
3. selecionar handle e usar Escape;
4. selecionar ponto localizado sobre borda costurada;
5. selecionar uma curva/segmento e editar handle de entrada e saída por X, Y,
   comprimento e ângulo;
6. editar X/Y de ponto e repetir zoom/pan;
7. editar comprimento de reta e repetir zoom/pan;
8. editar handle e repetir zoom/pan;
9. executar undo e redo e depois zoom/pan;
10. repetir os gestos essenciais no mobile.

A etapa não é aprovada por este documento, pela suíte ou pelo navegador automatizado.
Permanece aguardando validação manual explícita do usuário. Não avançar para 9.5-05
antes dessa aprovação.
