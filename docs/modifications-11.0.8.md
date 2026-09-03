# 11.0.8 — checkpoint Fase D

## Fonte de verdade

- Base aceita: `c8b341075d3e2fda0b5c979b7ca13fbbfb10c27c`
- Branch: `recovery/11.0.8-sewing-2d-3d-authoring`
- `SeamGroupV3` permanece o único modelo persistido de sewing.
- `EdgeRange { pieceId, edgeId, startT, endT }` é a identidade compartilhada
  entre os viewports.
- `physicalBindings` existentes são reutilizados para resolver
  `PanelInstanceV3`; nenhum schema paralelo foi criado.

## Fases concluídas

- Fase A: auditados SeamGroupV3, EdgeRange, seamDraft, PanelTopology,
  source mapping e compilador físico por arc-length.
- Fase B: bordas canônicas aparecem no 3D e o hit retorna o mesmo EdgeRange do
  2D, incluindo a PanelInstance física tocada.
- Fase C: fluxo Segment Sewing rápido A→B sem botão intermediário obrigatório;
  seleção 2D, 3D e mista usa o mesmo draft global.
- Fase D: proposal e seams confirmadas mostram threads 3D batched. Os threads
  usam diretamente `AssemblyStitchConstraint`, inclusive referências
  interpoladas e bindings produzidos pelo compilador físico existente.

## Arquivos alterados

- `apps/web/src/App.tsx`
- `apps/web/src/editor/PatternCanvasLegacy.tsx`
- `apps/web/src/garment3d/GarmentAssembly.ts`
- `apps/web/src/state/editorStore.ts`
- `apps/web/src/state/assemblyHistory.test.ts`
- `apps/web/src/viewport/GarmentViewport.tsx`
- `apps/web/src/viewport/GlobalThreeViewport.ts`
- `apps/web/src/viewport/SewingViewportOverlay.ts`

## Decisões

- Edge overlay e threads usam dois `THREE.LineSegments` e materiais
  compartilhados; hover apenas atualiza cores e posições de buffers existentes.
- O hit 3D usa source mapping (`sourceSegmentId`/`edgeId`/`t`), nunca índice de
  triangulação como identidade persistente.
- Proposal não muta o documento e não chama assembly worker nem XPBD.
- Confirmação continua pelo editor existente e persiste SeamGroupV3/undo-redo.
- Nenhum arquivo em `physics/**` foi alterado.

## Validação

- Base 11.0.7: build PASS; 31 testes focados de arrangement/mobile PASS.
- Implementação: typecheck PASS; 26 testes focados de authoring, binding e
  constraints PASS.
- Build e `git diff --check`: PASS.
- Browser automatizado: bloqueado porque `agent-browser` não está instalado no
  ambiente; gate visual fica para validação humana deste checkpoint.

## Próximo passo exato

Após aceitação visual das Fases B–D, iniciar Fase E em
`SewingViewportOverlay.ts` e na UI existente: notches direcionais e Reverse
atualizando a mesma correspondence física. Free Sewing, chains N:M e STEP-0
permanecem pendentes para as fases seguintes do prompt.
