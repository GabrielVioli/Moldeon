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
- câmera enquadrando avatar e roupa em conjunto;
- máscara semântica das superfícies do manequim totalmente cobertas, evitando que o corpo recorte visualmente painéis posicionados sobre superfícies curvas.

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

## Cobertura permanente de regressão

A execução interrompida havia produzido evidências visuais válidas, mas removeu junto com o workflow temporário o script que as gerava. Isso deixava o Prompt 9 sem uma barreira permanente contra regressões.

A correção final mantém `scripts/prompt09-browser-regression.mjs` e `.github/workflows/prompt09-avatar-regression.yml` na branch `main`. O workflow é somente leitura: ele não altera nem publica a própria branch. Em mudanças do avatar, montagem, viewport ou estilos, ele abre camiseta com mangas, saia e calça em Chrome/WebGL 2, incluindo viewport móvel, verifica anchors, instâncias, enquadramento, overflow, diagnósticos e ausência dos modos legados, e publica screenshots como artifact.

## Licença

Nenhum asset humano externo foi incorporado. O avatar é procedural e coberto pela licença MIT do Moldeon.

## Limitações

Esta entrega não declara física, caimento, colisão, autocolisão ou validação de vestibilidade. Esses pontos permanecem para o próximo ciclo de XPBD.
