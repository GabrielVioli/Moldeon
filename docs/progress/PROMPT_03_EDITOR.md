# PROMPT 03: editor 2D confiável e interações refatoradas

## Estado

Concluído em `main` em 5 de agosto de 2026.

A etapa restaurou a inserção de pontos, seleção, popovers, costuras removíveis, painel compacto de medidas, undo/redo transacional e gestos touch. O sistema de corte curvo, pences, moldes-base, montagem e física não foram alterados.

## Referências lidas antes da implementação

- `docs/MOLDEON_MASTER_PLAN.md`
- `docs/BASELINE_2026.md`
- `docs/progress/PROMPT_02_DOMAIN.md`
- documentos de arquitetura, domínio, roadmap e formato V3
- fixtures e auditorias determinísticas existentes

## Refatoração progressiva de PatternCanvas

O Canvas 2D continua sendo renderer e coordenador visual, não fonte de verdade. As responsabilidades extraídas e reutilizadas são:

- `editor/camera.ts`: zoom, pan, enquadramento e transformação da câmera;
- `editor/coordinates.ts`: conversão tela, mundo e coordenadas locais de peça;
- `editor/canvasHitTesting.ts`: hit testing de bordas e costuras;
- `editor/canvasGestures.ts`: origem, limiares e conclusão de gestos;
- `editor/workspaceInteractions.ts`: pontos editáveis, caixa de seleção, rotação e edição numérica;
- `domain/patternEditing.ts`: inserção e remoção topológica de pontos, divisão De Casteljau e remapeamento de referências.

Permanecem em `PatternCanvas.tsx` a composição do frame, o agendamento por `requestAnimationFrame`, o ownership de ponteiros e a coordenação dos overlays DOM. Esses pontos continuam candidatos a extração incremental, sem reescrita do renderer.

## Inserção de pontos

- reta e curva usam a topologia V2 canônica;
- zoom, pan, rotação e deslocamento da peça são convertidos antes do hit testing;
- curvas cúbicas são divididas por De Casteljau;
- os dois segmentos resultantes preservam o papel semântico do segmento original;
- costuras parciais são remapeadas para o segmento correto;
- clique cria um comando; drag contínuo permanece uma única transação.

Os testes numéricos comparam a curva amostrada antes e depois da divisão e confirmam equivalência dentro da tolerância definida.

## Seleção e gestos

- clique vazio limpa seleção;
- toolbar e painéis relacionados não limpam a seleção indevidamente;
- Shift, Ctrl/Cmd+A, seleção múltipla e caixa continuam disponíveis;
- clique, drag, pan, box selection e tap usam limiares explícitos;
- touch em peça só inicia movimento depois do limiar de drag;
- a ferramenta de ponto insere no tap intencional, mas pinch e gestos concorrentes cancelam essa intenção;
- o layout mobile agora entrega a largura completa à bancada, com a lista de peças em faixa horizontal.

## Popovers

O menu de três pontos usa um único popover controlado. Ele fecha ao:

- alternar o gatilho;
- clicar fora;
- executar uma ação;
- pressionar Escape;
- trocar peça, ferramenta, modo ou painel.

O foco retorna ao gatilho, os itens usam semântica de menu e o posicionamento é limitado à viewport.

## Costuras removíveis

Costuras podem ser selecionadas na bancada e na lista. A interface permite excluir, desativar, reativar e inverter direção. O nome é exibido no canvas e os dois lados são destacados. Todas as operações participam do histórico.

O estado `active` agora é preservado no round trip entre `GarmentDraft` e `PatternDocumentV3`; costuras inativas não geram restrições de montagem.

## Painel de medidas

- grupos recolhíveis e densidade compacta no desktop;
- largura limitada e redimensionamento horizontal no desktop;
- bottom sheet no mobile;
- campos numéricos com `inputMode=decimal` e fonte de 16 px no mobile;
- alteração de uma medida é agrupada entre foco e blur/Enter, produzindo uma única entrada de histórico.

## Undo e redo

Foram cobertos por testes:

- mover ponto em uma transação;
- inserir ponto canônico;
- remover, desativar, reativar e inverter costura;
- alterar medidas em uma transação;
- undo e redo de cada operação.

Atalhos ignoram inputs, textareas, selects e conteúdo editável.

## Validação automatizada

Execução final:

- commit de implementação: `7a65907f23526b6eb186aee8a1a8bf8658c86046`;
- commit de disparo da auditoria: `2b4d9454c011b38f284378f2e3bfba9b426591bf`;
- workflow run: `31048790852`;
- navegador: Chromium 140.0.7339.16;
- cenários funcionais e visuais: 13/13 aprovados.

| Cenário | Resultado | Avisos/erros de console |
|---|---:|---:|
| point-straight-mouse | aprovado | 0 |
| point-curve-mouse | aprovado | 0 |
| point-zoomed-mouse | aprovado | 0 |
| point-transformed-mouse | aprovado | 0 |
| point-straight-touch | aprovado | 0 |
| touch-does-not-move-piece-on-tap | aprovado | 0 |
| selection-and-shortcuts | aprovado | 0 |
| piece-popover-dismissal | aprovado | 0 |
| seam-lifecycle | aprovado | 0 |
| measurements-desktop-1366 | aprovado | 0 |
| measurements-desktop-1920 | aprovado | 0 |
| measurements-mobile-360 | aprovado | 0 |
| measurements-mobile-390 | aprovado | 0 |

Também foram aprovados no mesmo executor:

- `npm run typecheck`;
- `npm test`;
- `npm run build`.

A CI principal executa ainda as verificações Rust, Clippy e rustfmt.

## Evidências

- `docs/evidence/prompt03/point-curve-mouse.png`
- `docs/evidence/prompt03/point-straight-touch.png`
- `docs/evidence/prompt03/selection-and-shortcuts.png`
- `docs/evidence/prompt03/piece-popover-dismissal.png`
- `docs/evidence/prompt03/seam-lifecycle.png`
- `docs/evidence/prompt03/measurements-desktop-1366.png`
- `docs/evidence/prompt03/measurements-desktop-1920.png`
- `docs/evidence/prompt03/measurements-mobile-360.png`
- `docs/evidence/prompt03/measurements-mobile-390.png`
- relatório bruto em JSON e Markdown na mesma pasta.

## Limitações de inspeção

Mouse e touch foram exercitados em Chromium headless. Eventos de caneta não estavam disponíveis no executor, portanto a compatibilidade de pointer events foi preservada e coberta por código comum, mas não validada com hardware físico. Safari/iOS real também permanece como inspeção manual recomendada.

## Critérios de aceitação

- criar ponto em reta e curva: atendido;
- equivalência geométrica da curva: atendido por teste numérico;
- seleção e gestos sem regressão: atendido;
- popover fecha em todos os gatilhos: atendido;
- costura removível e recuperável: atendido;
- medidas compactas em desktop e mobile: atendido;
- undo/redo transacional: atendido;
- typecheck, testes, build e inspeção visual: atendidos;
- mudanças publicadas em `main`: atendido.
