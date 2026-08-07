# 9.5-04 — bloqueios da validação manual

Este arquivo registra somente os dois bloqueios reportados durante a validação manual do gate 9.5-04.

## Clique/tap vazio

Critério: um clique ou tap real no fundo do Canvas, sem pan, pinch, box selection ou operação temporária, precisa limpar peça(s), ponto, segmento, pence, costura e caminho interno. Escape executa a mesma limpeza de seleção. Controles fora do Canvas não contam como fundo.

Cobertura: `editorCoreSelection.test.ts`, `editorCoreStore.test.ts` e `recovery-editor-core-blockers-visual.mjs`.

## Rotação por handle visual

Critério: uma única peça selecionada exibe caixa de seleção e handle `↻` fora do canto superior direito. O drag gira continuamente em torno do centro da peça, Shift encaixa em 15°, pointer up produz uma transação de undo, pointer cancel/Escape restaura o estado anterior, e undo/redo reproduzem a transformação.

O handle é UI em coordenadas de tela e não pertence ao Documento V3.

Cobertura: `editorCoreMath.test.ts`, `editorCoreStore.test.ts` e `recovery-editor-core-blockers-visual.mjs`.
