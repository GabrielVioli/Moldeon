# Recovery 11.0.5 — Exact Human Surface Contact

Status: **PRONTO PARA VALIDAÇÃO MANUAL DA COLISÃO; SEM NOVO COMMIT DE FECHAMENTO**

Branch: `recovery/11.0.5-exact-human-surface-contact`

Base da etapa: `18287c6294c2ea6e66a95074f634a192d42a3a30`

HEAD observado ao final dos gates: `0fa0a85cd65ca28b38d28766be26cce59c4af1d5`

Observação: durante a execução dos gates, o worktree foi externamente commitado e publicado como `wip(11.0.5): checkpoint exact human surface contact`. Esta finalização não criou outro commit nem fez outro push.

## Resultado principal

A colisão usa a superfície final do manequim como fonte geométrica única. Visual e collision mesh possuem os mesmos buffers, topologia e transformação. O caminho exato executa contatos de vértice, aresta, interior de triângulo e CCD no Worker, sem Three.js e sem retornar para capsules.

A regressão que desligava toda a colisão por causa de uma região profundamente penetrada foi removida. Overlaps profundos existentes no step 0 agora são protegidos localmente; o restante da roupa continua consultando a BVH e resolvendo contatos normais.

## Causa raiz exata da regressão

O primeiro desvio ocorria em `solveExactBodySurfaceCollisions`, em `apps/web/src/physics/bodyCollision.ts`.

Antes da correção, `body.assemblyContactBlocked` executava um `return` global antes das consultas e constraints. No fechamento do passo, a mesma flag também impedia a resolução de arestas e triângulos. Assim, uma única região com overlap profundo transformava toda a peça em um garment sem body contact.

Durante o gate prolongado foi encontrada uma segunda variante da mesma falha: `newlyTooDeep` promovia uma penetração criada durante a dinâmica para `deepInitialOverlapMask`/`initialOverlapGuardMask`. Uma falha transitória passava a ser tratada permanentemente como defeito do step 0.

## Before / after

Antes:

`cloth -> inicialização detecta deep overlap -> assemblyContactBlocked -> return global -> zero correções`

Também antes:

`contato normal durante a simulação -> profundidade > 5 mm -> promove para initial overlap -> contato local permanentemente ignorado`

Depois:

`cloth -> BVH -> candidatos locais -> vertex/edge/triangle/CCD -> correção XPBD limitada`

Para overlap profundo real no step 0:

`região inicial inválida -> máscara material local + diagnóstico -> restante da roupa continua ativo -> truth audit continua reportando residual`

`assemblyContactBlocked` é diagnóstico. Não é mais interruptor global da colisão.

## Arquitetura final

1. `HumanBody.visualMesh` é empacotada em `PackedBodyMesh`.
2. A malha é validada antes do uso: finitude, degenerados, boundary edges, non-manifold edges, winding, volume e normais externas.
3. Uma BVH estática de typed arrays é criada uma vez.
4. Positions, normals, indices e metadados são transferidos ao Worker.
5. O Worker resolve closest point assinado, pseudo-normal segura, inside/outside robusto, vertex contact, edge crossing, triangle crossing e swept CCD.
6. O full triangle truth audit roda no fechamento do passo/gate, separado das queries locais do hot loop.
7. O ghost de debug renderiza a mesma exact mesh; ele não usa um proxy invisível.

## Paridade e validação da malha

- Vértices: `16.364`
- Triângulos: `32.508`
- Nós da BVH: `8.191`
- Delta máximo visual/collision: `0 mm`
- Boundary edges: `0`
- Non-manifold edges: `0`
- Triângulos degenerados: `0`
- Inconsistência de winding: `0`
- Violações de normal externa: `0`
- Malha watertight, volume orientado para fora e validação final: PASS

## Gates funcionais

Passaram:

- ponto `0,5 mm` dentro do torso;
- ponto `2 mm` dentro do torso;
- penetração transitória de `20 mm`, recuperada em correções limitadas sem virar overlap inicial;
- CCD de ponto rápido outside-to-inside;
- aresta atravessando superficialmente;
- triângulo com interior intersectando e vértices externos;
- busto, cintura, abdômen, quadril, glúteo, virilha, coxa interna, ombro e braço na malha humana real;
- overlap profundo no step 0 isolado localmente junto com contato recuperável na mesma peça;
- floor collision sem regressão nos testes focalizados;
- collision OFF produz zero contatos corporais.

O contact skin padrão é `0,05 mm`; o limite de produto validado é `0,15 mm`.

## Gate real no navegador — fixture válida

Fixture: `exact-contact-tube`, 20 passos, gravity 100%, body collision ON.

- `bodyCollisionMode`: `exact-human-surface`
- Contatos totais: `18`
- Vertex contacts: `17`
- Edge contacts: `5`
- Triangle contacts: `11`
- CCD hits: `3`
- `bodyTriangleIntersectionCount`: `0`
- `bodyCompleteCrossings`: `0`
- Penetração assinada máxima: `0,260 mm`
- Global early returns: `0`
- Local initial-overlap skips: `0`
- Overlaps profundos: `0`
- Stretch máximo: `1,0058x`
- Compression mínima: `0,9964x`
- Triângulos invertidos: `0`
- Body collision: `173,35 ms` no passo capturado
- Collision OFF: `0` body contacts e `0` queries de colisão

Artefatos:

- `artifacts/recovery-11-0-5-exact-human-surface-contact/exact-contact-tube/exact-collision-front.png`
- `artifacts/recovery-11-0-5-exact-human-surface-contact/exact-contact-tube/exact-collision-three-quarter.png`
- `artifacts/recovery-11-0-5-exact-human-surface-contact/exact-contact-tube/exact-collision-side.png`
- `artifacts/recovery-11-0-5-exact-human-surface-contact/exact-contact-tube/exact-collision-back.png`
- `artifacts/recovery-11-0-5-exact-human-surface-contact/exact-contact-tube/collision-off.png`
- `artifacts/recovery-11-0-5-exact-human-surface-contact/exact-contact-tube/browser-report.json`

## Gate real no navegador — initial arrangement inválido

Fixture: `straight-skirt-standard`, 1 passo, gravity 0%, body collision ON.

Este caso **não é collision PASS**:

- Interseções iniciais: `626`
- Overlaps profundos: `517`
- Penetração máxima: `33,20 mm`
- Interseções de triângulo residuais: `670`
- Complete crossings: `514`
- Local skips: `17.917`
- Motivo: `initial-overlap-too-deep`
- Global early returns: `0`
- Stretch máximo após o passo: `1,0424x`, em vez da explosão observada de aproximadamente `86x`
- Triângulos invertidos: `0`

O resultado correto aqui é `initial-overlap-too-deep`, com interseção residual explicitamente visível na telemetria. A correção do placement/assembly desta saia pertence ao 11.0.6 e não foi iniciada.

Artefatos:

- `artifacts/recovery-11-0-5-exact-human-surface-contact/straight-skirt-standard/browser-report.json`
- `artifacts/recovery-11-0-5-exact-human-surface-contact/straight-skirt-standard/exact-collision-front.png`
- `artifacts/recovery-11-0-5-exact-human-surface-contact/straight-skirt-standard/exact-collision-three-quarter.png`
- `artifacts/recovery-11-0-5-exact-human-surface-contact/straight-skirt-standard/exact-collision-side.png`
- `artifacts/recovery-11-0-5-exact-human-surface-contact/straight-skirt-standard/exact-collision-back.png`
- `artifacts/recovery-11-0-5-exact-human-surface-contact/straight-skirt-standard/collision-off.png`

## Performance

Benchmark isolado da BVH humana:

- Construção fria: `246,08 ms`
- 1.000 closest-point queries aquecidas: `23,89 ms`
- Visitas médias a nós: `58,06`
- Testes médios de triângulo: `47,65`
- 200 segment crossings: `14,55 ms`

No caso real profundamente inválido, o body collision caiu do caso observado de aproximadamente `975 ms` para `686,11 ms` no gate final (`29,6%` menor), mesmo preservando o truth audit e os `670` residuais. O custo continua alto porque esta fixture nasce com 626 interseções e exige auditoria exata ampla; ele não foi escondido desativando contato.

## Testes executados

- Suíte focal: `8` arquivos, `76/76` testes PASS.
- Regressão direta de body collision: `9/9` PASS.
- Typecheck: PASS.
- Build de produção: PASS; apenas warning de chunk grande já conhecido.
- Gate amplo: `18/22` arquivos PASS, `74` testes PASS, `2` SKIP, `4` falhas durante execução paralela.
- `xpbdBodyCollisionPerformance.test.ts` passou isoladamente em `1,91 s`; a falha ampla foi contenção do runner paralelo contra timeout de 5 s.

## Blockers herdados

Continuam fora do core exato:

1. `bodyCollisionCoordinateAudit.test.ts`: timeout de 120 s no assembly/audit de documentos.
2. `bodyCollisionRegistration.test.ts`: timeout de 60 s no pants unclassified/assembly.
3. `bodyCollisionStabilizationFinal.test.ts`: teste legado espera `metric-instability`, mas o bodice proxy antigo permanece finito enquanto acumula stretch de `57,5x`; é um problema anterior de registro/placement, não do exact human surface.

## O que validar manualmente

1. Abrir `exact-contact-tube`, clicar em Prova e selecionar parte inferior/referência frontal.
2. Ligar `Body collision`, `Floor collision`, visual body e `Mostrar malha exata de colisão`.
3. Confirmar em frente, 3/4, lado e costas que o ghost ciano coincide com o corpo sem offset invisível.
4. Com gravidade 100%, usar `Passo` e confirmar que contatos superficiais são repelidos, sem atravessar o quadril e sem explosão do tecido.
5. Confirmar na telemetria que vertex/edge/triangle contacts aparecem, global early returns permanece `0` e residual intersections/crossings termina em `0`.
6. Reiniciar, desligar Body collision e repetir. Confirmar `bodyContactCount = 0` e que o comportamento difere do caso ON.
7. Abrir a saia padrão apenas para confirmar o diagnóstico: ela deve mostrar `initial-overlap-too-deep` e residuais; não deve afirmar PASS nem explodir a métrica.
8. Confirmar que Floor collision continua ativa independentemente do diagnóstico corporal local.

Não foi iniciado o Prompt 11.0.6 e nenhuma mudança de assembly geral foi feita nesta finalização.

## Fechamento urgente de estabilização

O congelamento observado em `physicsStep = 0` era uma regressão de lifecycle introduzida em `bd81ee9`. A criação e o reset do estado promoviam `body.initialOverlapUnresolved` para `state.invalid = true`; `advanceXpbd` e `stepXpbd` então retornavam antes de executar qualquer passo ou contato. O diagnóstico continua exposto, mas não invalida mais o XPBD. `invalid` voltou a ser reservado para corrupção física real, como valores não finitos ou instabilidade métrica.

Gate funcional no navegador, fixture `exact-contact-tube`:

- Continuar: avançou do step 0 ao step 9;
- Pausar: permaneceu no step 9;
- Passo: avançou exatamente ao step 10;
- Reiniciar: retornou ao step 0;
- collision ON: 18 contatos, vertex/edge/triangle/CCD ativos e zero interseções/crossings residuais;
- collision OFF: zero contatos e zero queries corporais;
- console e rede: zero erros no modo fallback.

## Initial arrangement responsibility boundary

- Exact body contact, BVH, signed classification, vertex/edge/triangle contact e CCD pertencem à colisão.
- Placement espacial inicial válido pertence ao Arrangement.
- Recovery profundo multi-panel foi investigado e rejeitado: `bodyCollision` não contém nem deve se tornar um mini assembly solver.
- Deep overlap não resolvido é um diagnóstico (`initial-overlap-unresolved`), não uma invalidação global do XPBD.
- O recovery inicial permanece limitado e não altera `restPositions`, PatternDocumentV3 ou a métrica material 2D.
- A 11.0.6 deverá impedir que garments com placement canônico inválido entrem na física nesse estado; orientação de mangas e front/back também permanecem deliberadamente nessa etapa futura.
