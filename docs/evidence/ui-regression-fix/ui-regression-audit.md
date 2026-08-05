# Auditoria de regressões de UI pós-Prompt 04

Chromium 140.0.7339.16

| Cenário | Resultado | Erros de console |
|---|---|---:|
| single-piece-ownership | passed | 0 |
| multi-selection-drag | passed | 0 |
| empty-and-hand-pan | passed | 0 |
| wheel-trackpad-data | passed | 0 |
| right-panel-lifecycle | passed | 0 |
| desktop-1920-layout | passed | 0 |
| mobile-portrait-panel-and-pinch | passed | 0 |
| mobile-landscape-layout | passed | 0 |

Trackpad físico: **não validado neste executor**. A auditoria usa eventos Wheel reais do Chromium com perfis de delta de trackpad e mouse, mas não substitui hardware físico.
