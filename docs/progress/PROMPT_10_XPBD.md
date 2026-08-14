# Prompt 10 — Solver XPBD CPU + Worker

## Status

**PRONTO PARA VALIDAÇÃO MANUAL.**

Branch: `recovery/10-xpbd-cpu-worker`.

## Entrega

O fluxo público agora executa `desenhar/costurar → Provar → Worker XPBD → Three.js`. A física usa o `PatternDocumentV3`, `PanelInstanceV3`, `SeamGroup` e source mapping existentes, sem criar documento paralelo e sem modificar o 2D.

Foram implementados solver SoA, gravidade, stretch warp/weft, shear, bend, costuras interpoladas/compostas, lifecycle, transferables, backpressure, atualização incremental das meshes e controles Pausar/Passo/Continuar/Reiniciar.

## Blockers resolvidos

### Explosão ao adicionar retalho

O clamp anterior limitava o multiplicador XPBD e ignorava que a correção efetiva ainda era multiplicada pela massa inversa. Além disso, o repouso plano de constraints estruturais conflitava com painéis inicialmente curvos. Em tecidos leves, a combinação gerava correções de dezenas de metros e triângulos gigantes.

Agora o limite atua sobre o deslocamento real, relativo à menor aresta local; repousos discretos vêm da pose 3D inicial; topologia é validada antes do Worker; cada rebuild recebe geração monotônica e frames de geração/revisão antiga são descartados. A→B→A reconstrói buffers e lambdas do zero.

### Simulação que não avançava em Provar

Havia dois fatores: `Provar` só chamava a ação física quando o modo anterior já era assembly, e uma explosão física podia saturar Worker/renderização antes de aparecer progresso útil. `Provar` agora sempre solicita a simulação. O smoke confirmou Worker criado, ready, running, steps, frames aceitos, mesh atualizada e lifecycle completo.

## Regressão da autocostura

A validação passou a comparar identidade material canônica (`piece + edge + intervalo`) em vez de bloquear pelo `PanelInstance` ou peça. Bordas esquerda/direita da mesma instância são válidas; o mesmo range e sobreposição positiva são inválidos; ranges disjuntos ou apenas adjacentes são válidos. A regra vale para todos os pares entre lados compostos e preserva `1↔1`, `1↔N`, `N↔1` e `N↔M`.

## Métricas

Configuração padrão:

- timestep: `1/120 s`;
- max frame delta: `1/20 s`;
- substeps: até 6; smoke V3: 2;
- iterations: 8; integração focada: 5;
- seam tolerance: `0,0025 m`;
- correção defensiva: até 35 mm e no máximo 10% da menor aresta estrutural local;
- maior execução canônica: 720 physics steps;
- determinismo: igualdade exata dos `Float32Array` em duas execuções de 240 steps;
- NaN/Infinity publicados: nenhum.

Smoke Chromium/Three.js final:

| Caso | Partículas | Triângulos | Stretch | Shear | Bend | Seam | Erro médio seam | Erro máximo seam |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A — tubo | 605 | 960 | 1.564 | 960 | 1.316 | 20 | `1,09e-8 m` | `3,45e-8 m` |
| B — tubo + retalho | 850 | 1.344 | 2.192 | 1.344 | 1.840 | 31 | `4,74e-5 m` | `0,00146 m` |
| C — 4 painéis | 1.460 | 2.304 | 3.760 | 2.304 | 3.152 | 41 | `3,55e-8 m` | `1,19e-7 m` |

O caso B foi observado por 191 physics steps. O residual do retalho convergiu para erro médio de 0,047 mm e máximo de 1,46 mm, abaixo da tolerância de 2,5 mm, sem alterar o molde.

Tempo indicativo no ambiente local Windows/Vitest, sem pretensão de benchmark: tubo ~6–7 ms por physics step, tubo + retalho ~9 ms e conjunto de quatro instâncias ~30 ms. O cenário de quatro painéis é o limite atual para 120 Hz neste hardware e deverá ser perfilado antes de colisões.

Compliances do algodão padrão: stretch warp/weft `3,8e-7/5,6e-7`, shear `2,875e-6`, bend `1,43e-3` e seam standard `8e-8`.

## Testes e evidências

- cenas canônicas A–Q: painel livre, pendurado, tubo, tesselações diferentes, transmissão de força, `1↔2`, `2↔1`, `2↔3`, residual, ciclo, ramificação, determinismo, delta grande, lifecycle, rebuild 2D e 4+ painéis;
- integração real: tubo, painel desconectado, retalho costurado, A→B→A e quatro `PanelInstances`;
- domínio: autocostura material, ranges compostos, ordem, same/opposite, undo/redo;
- Worker client: descarte de frame A antigo após A→B→A;
- suíte completa: 67 arquivos / 447 testes;
- typecheck: aprovado;
- build fallback de produção: aprovado;
- `git diff --check`: aprovado;
- smoke desktop 1440×900 e mobile 390×844: aprovado;
- console do navegador: zero erros.

Evidências locais:

- `artifacts/prompt-10-xpbd/report.json`;
- `desktop-running.png`;
- `desktop-tube-with-flap.png`;
- `desktop-four-panel-composite.png`;
- `mobile-paused.png`.

No caso C, quatro meshes permaneceram presentes, `maxTriangleIndex = 1459 < particleCount = 1460`, a costura composta gerou 24 constraints e a segunda SeamGroup gerou 17. No rebuild B→A, a topologia voltou exatamente a 605 partículas e 960 triângulos, sem mesh fantasma.

## Limitações

Não há colisão corporal, avatar físico, chão físico, self-collision, multicamadas, GPU compute ou distribuição profissional de franzido por piques. Sem colisão, peças caem livremente. O smoke foi feito em Chrome headless no desktop e viewport mobile emulado, não em telefone físico, Safari ou Firefox.

## Checklist manual

1. Desenhe um retângulo, costure laterais diferentes da mesma peça e clique em Provar.
2. Confirme gravidade, tubo unido e ausência de triângulos gigantes.
3. Teste Pausar, um Passo, Continuar e Reiniciar.
4. Adicione um retalho, costure-o ao tubo e confirme duas peças visíveis, sem mesh fantasma.
5. Remova/desfaça/refaça o retalho ou a costura durante a sessão e confirme rebuild limpo.
6. Repita com quatro painéis, duas SeamGroups e uma costura composta.
7. Confirme que o 2D não muda durante a física.

Não houve merge na main, Prompt 11, avatar, colisão corporal ou persistência.
