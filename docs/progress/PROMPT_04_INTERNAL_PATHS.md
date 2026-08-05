# PROMPT 04: linhas internas, corte curvo e pences reais

## Estado

Concluído em `main` em 5 de agosto de 2026.

A etapa substituiu o corte reto temporário por caminhos internos editáveis e versionáveis. O mesmo caminho pode funcionar como referência, dobra, marcação, corte, corte com costura ou pence. Corte e fechamento de pence são operações geométricas transacionais: produzem um documento completo válido ou não alteram o documento.

## Referências lidas antes da implementação

- `docs/MOLDEON_MASTER_PLAN.md`
- `docs/BASELINE_2026.md`
- `docs/progress/PROMPT_02_DOMAIN.md`
- `docs/progress/PROMPT_03_EDITOR.md`
- `docs/ARCHITECTURE.md`
- `docs/PATTERN_DOCUMENT_V3.md`
- tipos, migrações, histórico, triangulação, costuras e fixtures atuais de `main`

## Modelo canônico InternalPath

Foi criado um modelo único para caminhos internos com:

- ID e referência estável à peça proprietária;
- nós em milímetros;
- segmentos retos e cúbicos;
- alças Bézier editáveis;
- finalidade `reference`, `fold`, `marking`, `cut`, `cut-and-sew` ou `dart`;
- visibilidade e bloqueio;
- metadados versionados;
- preferência de snapping;
- conversão de finalidade sem redesenho.

Linhas internas legadas continuam aceitas. Elas são normalizadas quando entram no fluxo novo, sem descarte silencioso do projeto existente.

## Sessão de edição e interação

A sessão da ferramenta foi isolada em `state/internalPathEditorStore.ts`. Ela guarda seleção e rascunho temporário, enquanto o documento 2D continua no store principal e no histórico transacional.

O fluxo implementado permite:

- clicar para adicionar vários nós;
- mover o cursor de prévia sem criar estado persistente adicional;
- `Enter` para confirmar;
- `Backspace` para remover o último nó fixo;
- `Escape` para cancelar e restaurar exatamente o documento anterior;
- selecionar caminho, nó, segmento e alça posteriormente;
- mover nós e alças;
- converter segmentos entre reta e curva;
- alterar finalidade, visibilidade e bloqueio;
- excluir o caminho por uma única transação.

O Canvas exibe nós, alças, interseções, finalidade por cor e seleção do caminho. O feedback contextual apresenta os diagnósticos e somente habilita a operação quando a análise é válida.

## Análise geométrica e diagnósticos

`domain/internalPaths.ts` é uma camada pura, sem React, DOM ou Three.js. Ela recebe a peça, o caminho e as costuras relacionadas e retorna:

- interseções ordenadas por arco;
- segmentos do contorno tocados;
- áreas estimadas das regiões resultantes;
- costuras afetadas;
- avisos e erros com código e mensagem;
- elegibilidade para aplicar a operação.

São rejeitados antes de qualquer mutação:

- menos de duas interseções para corte;
- mais de duas interseções;
- tangência ou sobreposição com a borda;
- caminho degenerado;
- região resultante abaixo da área mínima;
- pence sem ápice ou sem ligação válida à borda;
- referências que não podem ser atualizadas sem ambiguidade.

A aplicação é atômica. Nenhum erro deixa peça parcial, ponto órfão, costura pela metade ou histórico inconsistente.

## Corte reto e curvo

O corte aceita caminhos com vários segmentos retos ou cúbicos. A análise usa amostragem determinística, mas a geometria persistida não é achatada sem necessidade.

Quando o corte atravessa um contorno Bézier, o segmento externo é dividido por De Casteljau. Quando o caminho de corte é cúbico, as novas bordas mantêm segmentos cúbicos. As duas peças resultantes preservam:

- fio;
- anotações;
- tecido atribuído;
- quantidade de corte e dobra;
- metadados da peça;
- transform da bancada;
- referências de contorno que continuam válidas.

A soma das áreas resultantes é comparada à área original dentro da tolerância dos testes.

## Corte e manter costurado

A finalidade `cut-and-sew` executa o mesmo corte geométrico e cria as relações de costura entre as novas bordas.

As partes da relação compartilham um `groupId` estável. Na projeção para `PatternDocumentV3`, elas formam um único `SeamGroupV3` multifaixa, preservando:

- direção;
- ordem ao longo do arco;
- correspondência entre os lados;
- comprimentos e intervalos;
- tratamento e estado ativo.

Undo restaura exatamente a peça anterior, incluindo caminho, tecido, transforms, costuras e metadados. Redo produz novamente as mesmas peças e a mesma relação.

## Pences estruturais

A finalidade `dart` não produz apenas uma linha decorativa. Ao fechar a pence, o documento recebe:

- perna A e perna B;
- ápice;
- centro na borda;
- largura;
- comprimento;
- IDs dos segmentos das pernas;
- estado aberto ou fechado;
- relação estrutural `paired-legs` com distância-alvo zero quando fechada.

Essa relação é persistida e mantém dados suficientes para triangulação e futura montagem física. A fase não simula o volume da pence no avatar, conforme o escopo definido.

## Fronteira TypeScript e Rust/WASM

O fallback geométrico foi implementado em TypeScript e coberto por testes determinísticos. A decisão foi explícita: o núcleo Rust atual ainda recebe `PatternPiece` legado e não representa o documento V3 raiz nem `SeamGroupV3` multifaixa.

Migrar esta operação para Rust/WASM continua permitido, mas o substituto deve manter o mesmo contrato de entrada, saída, diagnósticos, tolerâncias e fixtures. Não foi criada uma segunda fonte de verdade.

## Tolerâncias e limites

Tolerâncias atuais:

- interseção e deduplicação: `0,08 mm`;
- área mínima de região: `4 mm²`;
- amostragem de curvas somente para análise, hit testing e estimativa;
- divisão Bézier persistente por De Casteljau.

Limites deliberados desta fase:

- um corte aberto deve atravessar o contorno exatamente duas vezes;
- tangências, sobreposição de borda, ilhas e mais de duas interseções são rejeitadas;
- operações booleanas universais e autointerseções arbitrárias não foram implementadas;
- bolsos funcionais, elástico, pesponto físico e simulação volumétrica da pence permanecem fora do escopo;
- costuras afetadas são remapeadas apenas quando a referência continua inequívoca; nos demais casos a operação é bloqueada ou a relação é invalidada com diagnóstico explícito.

## Testes automatizados

A cobertura adicionada inclui:

- corte reto;
- corte curvo;
- caminho com múltiplos segmentos;
- contorno externo com Bézier;
- tangência inválida;
- mais de duas interseções;
- corte e manter costurado;
- projeção para um único SeamGroup multifaixa;
- pence estrutural;
- triangulação após fechamento de pence;
- undo e redo completos;
- cancelamento sem resíduos;
- conservação de área;
- preservação de tecido, fio, anotações e transform;
- ausência de IDs, pontos, segmentos e costuras órfãos.

No executor final foram aprovados:

- `npm run typecheck`;
- `npm test`;
- `npm run build`.

## Auditoria funcional e visual

Execução final:

- commit do núcleo geométrico: `545ef92038048823615a14cde51584524d109450`;
- commit da integração do editor: `69b17342bb710fd68b800e2cd268283cae1a6906`;
- commit da correção de interação e evidências: `2db64af9c872e824b37942b11d12498cebcf7f71`;
- commit de disparo da auditoria final: `a3bc3edb3264914b7b392142597ac239d86fd63d`;
- workflow run: `31054901402`;
- navegador: Chromium `140.0.7339.16`;
- cenários visuais: `3/3` aprovados;
- avisos ou erros de console: `0`.

Cenários exercitados:

| Cenário | Resultado |
|---|---:|
| caminho curvo, edição de nó, corte e manter costurado, undo e redo | aprovado |
| desenho e fechamento de pence estrutural, undo e redo | aprovado |
| rascunho por touch em viewport móvel e cancelamento por Escape | aprovado |

## Evidências

- `docs/evidence/prompt04/curved-path-edited.png`
- `docs/evidence/prompt04/curved-cut-and-sew.png`
- `docs/evidence/prompt04/dart-path.png`
- `docs/evidence/prompt04/structural-dart.png`
- `docs/evidence/prompt04/internal-path-mobile.png`
- `docs/evidence/prompt04/prompt04-audit.json`
- `docs/evidence/prompt04/prompt04-audit.md`

## Critérios de aceitação

- desenhar e editar caminho interno curvo: atendido;
- converter finalidade sem redesenhar: atendido;
- corte curvo produzir peças válidas: atendido;
- corte e costura criar SeamGroup correta: atendido;
- pence alterar o documento de forma estrutural e persistente: atendido;
- operações transacionais e reversíveis: atendido;
- diagnósticos explícitos e falha atômica: atendido;
- testes, typecheck, build e inspeção visual: atendidos;
- mudanças publicadas em `main`: atendido.
