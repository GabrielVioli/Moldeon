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
- undo/redo transacional durante drag e edição numérica.

Não pertencem a este gate: duplicar/espelhar/alinhamento/união/corte/pence/prega,
moldes-base, manga, costuras, classificação corporal, avatar, física ou Prompt 10.

## Fonte de verdade

O Documento V3/`garment.pieces` continua sendo a fonte de verdade. O guard do Canvas
é remontado quando a composição de peças ou a peça ativa muda, preservando a correção
aprovada no gate 9.5-03. A edição numérica trabalha exclusivamente sobre a peça ativa
existente no documento.

## Hit testing

A prioridade normativa deste gate é:

1. handles;
2. pontos/nós;
3. landmarks, piques e marcadores;
4. segmentos;
5. linhas internas;
6. área da peça;
7. fundo.

A tolerância geométrica deve permanecer constante em pixels de tela; a conversão para
milímetros é `tolerânciaPx / zoom`.

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

- `editorCoreMath.test.ts`: tolerância por zoom, prioridade de hit testing, IDs válidos
  e conversão coordenadas ↔ comprimento/ângulo.
- `editorCoreStore.test.ts`: primeira peça ativa, drag como uma transação, edição
  numérica de handle e limpeza de seleção incompatível.
- `patternEditing.test.ts`: inserção em reta, De Casteljau em curva e remapeamento
  paramétrico de referências.
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
6. clicar fora, Escape, undo e redo;
7. repetir toque e pinch no mobile.

A etapa não é aprovada por este documento nem por CI. Ela permanece aguardando
validação manual explícita na URL de preview.
