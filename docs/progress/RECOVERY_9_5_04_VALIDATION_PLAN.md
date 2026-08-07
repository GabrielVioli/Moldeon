# 9.5-04 blocker validation plan

A validação automatizada é somente leitura sobre o commit da branch. Ela não aprova o
gate e não autoriza merge.

## Reteste manual obrigatório

1. selecionar uma peça e clicar/tocar em fundo realmente vazio: nenhuma seleção deve permanecer;
2. selecionar um ponto e pressionar Escape: nenhuma seleção deve permanecer;
3. selecionar um handle e pressionar Escape: nenhuma seleção deve permanecer;
4. selecionar um ponto que esteja sobre uma borda costurada: o ponto deve vencer o hit da costura;
5. selecionar uma curva/segmento e acessar handle de entrada e saída;
6. editar X, Y, comprimento e ângulo do handle;
7. editar X/Y de um ponto, aplicar zoom e pan e confirmar que a geometria não volta;
8. editar o comprimento de uma reta, aplicar zoom e pan e confirmar que a geometria não volta;
9. editar um handle, aplicar zoom e pan e confirmar que a geometria não volta;
10. executar undo, depois zoom/pan: o estado de undo deve permanecer;
11. executar redo, depois zoom/pan: o estado de redo deve permanecer;
12. confirmar que toolbar, painel, zoom e popovers continuam sem limpar seleção indevidamente;
13. repetir seleção, Escape, pinch/pan e edição essencial em viewport mobile.

## Evidência automatizada atual

Commit funcional validado: `fcf2e3911e5f80546398a90d5405d8efb10f7e24`.

A execução passou:

- `npm run typecheck`;
- `npm test`;
- `npm run build`;
- fluxo Chromium com clique vazio, Escape em ponto/handle, ponto em borda costurada,
  edição X/Y de ponto, X/Y/comprimento/ângulo de handle, comprimento de reta,
  zoom/pan e undo/redo.

A aprovação final continua exclusivamente manual.
