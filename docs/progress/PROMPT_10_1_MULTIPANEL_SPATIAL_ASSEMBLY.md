# Prompt 10.1 — Initial assembly espacial multipainel

## Status

**PRONTO PARA VALIDAÇÃO MANUAL.**

Branch: `recovery/10.1-multipanel-spatial-assembly`.

Base exata aprovada do Prompt 10: `f256d360b7d6b512d2f732869dad919c9bf14261`.

## Causa raiz

O self-seam antigo funcionava porque possuía um embedding analítico dedicado. O caso com dois painéis só era reconhecido quando duas costuras simples ligavam exatamente o mesmo par. Ciclos maiores não eram analisados: o código escolhia uma única subestrutura tubular por connected component e o restante caía no posicionamento local, uma seam por vez. Esse fallback não tinha fechamento global, dependia da pose semântica inicial e podia produzir uma faixa coplanar, uma dobra arbitrária ou residual grande para o XPBD.

Havia ainda duas causas secundárias:

- instâncias espelhadas criadas por `cut-on-fold` eram ligadas por constraints físicas, mas essa aresta não participava do reconhecimento do ciclo espacial;
- a triangulação em leque de um retângulo self-seam deixava triângulos atravessarem aproximadamente 90° do cilindro. A geometria material era válida, mas os patches largos apareciam como ondulações e mordidas permanentes na rest pose.

Na validação manual posterior apareceu um terceiro caso: uma seam diagonal local adicionava uma terceira aresta aos nós do ciclo. Como o primeiro detector exigia grau exatamente dois no connected component inteiro, a seam de pence invalidava a casca principal e devolvia todos os painéis ao fallback planar.

Um quarto caso combinava o corpo tubular, a seam local, uma faixa superior autocosturada e uma união superior composta. O seletor antigo aceitava somente uma subestrutura tubular por connected component. Quando a casca corporal não era reconhecida, o pequeno loop superior vencia sozinho e os painéis restantes eram desenvolvidos como abas radiais ao redor dele.

## Algoritmo adotado

O assembly constrói um multigrafo por `PanelInstance`, usando SeamGroups simples e ligações materiais de dobra. A solução não consulta nomes de peças.

Um connected component só é aceito como casca tubular multipainel quando:

- possui ao menos três instâncias; o caso de duas continua no algoritmo analítico aprovado;
- todos os vértices têm grau dois e `arestas = instâncias`;
- cada painel oferece os dois ranges incidentes em lados materiais opostos;
- as direções das bordas têm um eixo dominante coerente;
- `same/opposite` pode ser propagado de forma consistente ao fechar o ciclo.

O ciclo de casca agora é extraído do grafo completo. Para cada `PanelInstance`, o algoritmo seleciona deterministicamente o par de ranges incidentes que ocupa lados materiais opostos e apresenta o eixo dominante mais coerente, priorizando a extensão estrutural acumulada. Ligações locais, pences e retalhos permanecem no Seam Graph, mas não aumentam artificialmente o grau da subestrutura usada para definir o volume principal.

A largura material de cada painel determina seu arco e a soma define a circunferência. Os painéis são distribuídos em torno de um eixo comum sem escalar as coordenadas 2D. Diferenças de comprimento axial e costuras incompatíveis permanecem como residual para o XPBD.

Subestruturas tubulares que disputam as mesmas `PanelInstances` continuam mutuamente exclusivas. Subestruturas fechadas materialmente disjuntas podem coexistir no mesmo componente: a maior casca é a raiz global e loops auxiliares são alinhados rigidamente a ela pela média das correspondências de seam entre os grupos. Isso preserva corpo e faixa superior como volumes reconhecíveis, sem transformar o corpo em flaps nem achatar o loop auxiliar.

Componentes abertos usam uma árvore determinística. Cada filho é alinhado rigidamente ao range correspondente e desenvolvido para o lado oposto ao interior do pai. Nenhum fechamento inexistente é inventado e constraints adicionais não deformam painéis já posicionados.

Costuras compostas `1↔N`, `N↔1` e `N↔M` continuam no pipeline canônico por comprimento de arco acumulado. Elas não são reduzidas a arestas simples para forçar um cilindro; recebem o fallback rígido e preservam ordered ranges, mismatch, slack/ease e source mapping.

Para o retângulo convexo de quatro segmentos retos com self-seam material válida, a topologia passa a usar uma grade regular de aproximadamente 20 mm. O contorno, os edge paths e os mapeamentos de origem são preservados. Curvas, pences, quadriláteros côncavos e geometrias gerais continuam no tessellator canônico.

## Arquivos principais

- `apps/web/src/garment3d/SemanticAvatarArrangement.ts`: detecção de ciclos, propagação de orientação, embeddings multipainel e fallback aberto determinístico;
- `apps/web/src/garment3d/GarmentAssembly.ts`: seleção segura da malha estruturada para self-seam quadrilateral;
- `apps/web/src/garment3d/PanelRefinement.ts`: remesh regular com edge paths e source mapping;
- `apps/web/src/viewport/GlobalThreeViewport.ts`: diagnósticos do assembly e marcador de identidade do Worker resistente à reconciliação rápida;
- `apps/web/src/testFixtures/baselineGarments.ts`: fixtures públicas de tubo com dois/quatro painéis e cadeia aberta;
- `scripts/audit-prompt10-1-spatial-assembly.mjs`: smoke visual desktop/mobile antes, depois de steps e após reset.

## Testes e evidências

- testes focados de topologia, assembly semântico/físico/resolvido, histórico, fixtures e XPBD: 8 arquivos / 110 testes;
- suíte completa: 67 arquivos / 461 testes;
- lifecycle público: 10 ciclos, sequências rápidas, desktop/mobile, reset pausado e imutável;
- XPBD/Worker: A→B→A, self-seam, retalho, quatro painéis, costura composta, geração/revisão/epoch e meshes globais válidas;
- typecheck, build e `git diff --check`: aprovados;
- console do navegador: zero erros.

Smoke espacial:

| Caso | Instâncias | Mapping | Distorção intrínseca máxima | Reset |
| --- | ---: | --- | ---: | --- |
| self-seam | 1 | seam-derived | `5,01e-6` | exato |
| tubo 2 painéis | 2 | seam-derived | `2,29e-5` | exato |
| tubo 4 painéis | 4 | seam-derived | `2,29e-5` | exato |
| cadeia aberta | 3 | rigid | `2,29e-5` | exato |
| tubo + retalho | 2 | seam-derived + rigid | `3,38e-5` | exato |
| seam composta 2↔3 | 4 | rigid | `2,29e-5` | exato |
| corpo recortado + faixa superior | 5 | 2 cascas seam-derived | `1,88e-5` | exato |

Caso A/B adicional, usando o mesmo documento:

- A: quatro arestas laterais no Seam Graph, quatro meshes tubulares;
- B: cinco arestas após adicionar a seam diagonal, ainda quatro meshes tubulares;
- IDs, vértices, triângulos, bounding boxes, transforms, geometry signatures, normals e `material.side` permaneceram iguais na pose resetada;
- assinatura da pose inicial A/B: idêntica;
- residual máximo da seam caiu de `0,07639 m` para `0,06231 m` em seis steps, sem colapsar o volume;
- erros de console: zero.

No caso com faixa superior, as quatro instâncias corporais continuaram na casca tubular principal e a faixa autocosturada permaneceu uma quinta mesh tubular auxiliar, alinhada ao topo pelo Seam Graph composto. Nenhuma instância virou flap radial, desapareceu ou voltou ao fallback planar.

Evidências ficam em `artifacts/prompt-10-1-spatial-assembly/`, incluindo capturas antes da física, depois de seis steps, reset restaurado e viewport mobile. Os relatórios de regressão permanecem em `artifacts/prompt-10-xpbd/` e `artifacts/prompt-10-lifecycle/`.

## Limitações

- ciclos compostos `N↔M` e topologias que não atendem aos critérios geométricos conservadores não são forçados a uma casca tubular;
- componentes abertos recebem uma pose rígida limpa, não uma previsão de caimento;
- mismatch de comprimento continua como residual espacial e físico;
- não há self-collision, chão, avatar físico ou garantia contra interpenetração depois que a simulação começa;
- mobile foi validado em viewport Chrome emulado, não em aparelho físico, Safari ou Firefox.

## Checklist manual

1. Crie um retângulo, costure laterais opostas da mesma instância e confirme um tubo limpo antes de `Continuar`.
2. Monte tubos de duas e quatro instâncias e confirme que todas aparecem distribuídas espacialmente, sem faixa plana.
3. Remova a seam que fecha o ciclo e confirme uma cadeia aberta, sem colapso ou meshes fantasmas; use undo/redo.
4. Troque nomes e ordem de criação e confirme a mesma estrutura.
5. Costure um retalho a um range parcial e confirme que ele nasce inteiro e do lado externo.
6. Abra um projeto com seam composta `N↔M` e confirme ranges, meshes e topologia preservados.
7. Em cada caso, teste `Pausar`, `Passo`, `Continuar` e `Reiniciar`; reset deve voltar à pose espacial inicial e permanecer pausado.
8. Confirme que nenhuma operação 3D altera o `PatternDocumentV3` ou a geometria 2D.

Não houve merge na main, Prompt 11, avatar, chão ou self-collision.
