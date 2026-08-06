# Prompt 9: avatar humano e montagem semântica

## Estado

Entrega concluída na branch `main` após validação de domínio, frontend, build e navegador.

## Implementação

- modelo paramétrico humano em `avatar/AvatarParametricModel.ts`;
- proxies futuros em `avatar/AvatarCollisionModel.ts`;
- visual low-poly separado em `viewport/AvatarVisual.ts`;
- montagem determinística em `garment3d/SemanticAvatarArrangement.ts`;
- viewport único com avatar sempre visível;
- diagnóstico e omissão de instâncias inválidas;
- câmera enquadrando avatar e roupa em conjunto.

O molde 2D continua sendo a fonte de verdade. Os painéis 3D são reconstruídos das topologias trianguladas e dos placements semânticos.

## Comportamentos removidos

- `showBody`;
- `setBodyVisible`;
- modo explodido;
- botões Montada/Explodida;
- viewport legado duplicado;
- inicialização cilíndrica global de painéis;
- inferência de posição por nome de peça.

## Compatibilidade

Projetos com `previewPlacements` continuam usando esses metadados. `assemblyPlacements` antigos são convertidos quando possuem papel, superfície e orientação explícitos. Projetos sem anchor não são alterados silenciosamente: a peça é omitida do 3D e recebe `missing-anchor`.

## Validação

Foram executados:

- typecheck;
- suíte completa de testes;
- build fallback;
- CI Rust existente em `main`;
- auditoria do fluxo real no Chrome para camiseta, saia e calça;
- desktop 1440×960;
- mobile emulado 390×844;
- inspeção das capturas publicadas.

A auditoria verifica avatar sempre visível, quantidade esperada de instâncias, zero diagnóstico de erro nos templates, ausência de overflow, ausência de controles explodidos ou corpo ocultável e ausência de erros de navegador.

## Licença

Nenhum asset humano externo foi incorporado. O avatar é procedural e coberto pela licença MIT do Moldeon.

## Limitações

Esta entrega não declara física, caimento, colisão, autocolisão ou validação de vestibilidade. Esses pontos permanecem para o próximo ciclo de XPBD.
