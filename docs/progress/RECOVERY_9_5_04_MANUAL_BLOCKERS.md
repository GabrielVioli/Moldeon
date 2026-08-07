# 9.5-04 — bloqueios da validação manual

Este arquivo registra somente os bloqueios reportados na validação manual do gate
9.5-04 e o estado técnico da correção. Nenhum item abaixo está manualmente aprovado
até nova confirmação do usuário.

## Clique/tap vazio e Escape

Causa: a limpeza completa estava dividida entre o store principal, o store de caminhos
internos e uma decoração dinâmica de `clearSelection`, enquanto Escape também possuía
mais de um listener.

Correção: `clearEditorSelection()` tornou-se a ação autoritativa de alto nível. Clique
real no fundo e o único fluxo global de Escape convergem nela. Não há monkey patch de
Zustand no Canvas.

## Pontos sobre bordas costuradas

Causa: o hit de costura podia ser resolvido antes do controle geométrico editável.

Correção: costura é ignorada como alvo quando o cursor está dentro da tolerância de um
ponto ou handle. A entidade de costura é preservada e continua selecionável fora dos
controles geométricos.

## Edição numérica de curvas

Causa: o painel numérico existia, mas o fluxo dependia de um ponto previamente
selecionado e não oferecia de forma direta os dois handles de um segmento cúbico.

Correção: segmento selecionado oferece handle de saída e handle de entrada, cada um com
X, Y, comprimento e ângulo.

## Geometria antiga após zoom/pan

Causa: o listener nativo de wheel era instalado uma vez e podia conservar a cadeia de
closures do primeiro render até `drawLatest`. Assim, um redraw de câmera podia executar
uma função de desenho antiga depois de a geometria da mesma peça ter sido editada.

Correção: RAF e wheel delegam para refs de callback atuais e o frame consulta
`useEditorStore.getState()` no instante do desenho. `draw()` renderiza a geometria de
`garment.pieces`; zoom e pan não alteram nem restauram geometria.

## Validação automatizada

No commit `fcf2e3911e5f80546398a90d5405d8efb10f7e24` passaram typecheck, suíte completa,
build e o fluxo real em Chromium cobrindo os quatro bloqueios acima, persistência de
ponto/handle/comprimento após zoom-pan e undo/redo após navegação de câmera.

Status: **aguardando reteste manual do usuário**.
