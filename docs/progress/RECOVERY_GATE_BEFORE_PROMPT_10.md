# Gate de recuperação antes do Prompt 10

## Regra de execução

O Prompt 10 permanece bloqueado. Cada etapa do Prompt 9.5 é desenvolvida em branch própria, recebe validação automatizada e visual, gera uma URL de preview e só pode ser mesclada após validação manual do usuário.

## Estado-base

- Commit-base da etapa de bancada vazia: `8366656d05cadd841a59a4c20029b5ecb4c0e0f2`.
- Branch: `recovery/9.5-03-empty-workspace`.
- Merge em `main`: pendente de validação manual.

## Etapa 03 — bancada vazia

### Regressão reproduzida

A biblioteca oferecia uma opção visual de projeto vazio, mas `parseGarmentDraft`, o Documento V3, o autosave e o store ainda exigiam pelo menos uma peça. Excluir a última peça também era bloqueado. A correção anterior substituiria o Canvas por uma tela vazia, impedindo desenhar a primeira peça.

### Causa

A invariável histórica “sempre existe uma peça ativa” estava duplicada no domínio, na serialização V3, na restauração, no histórico e na interface. O snapshot do motor era usado como fallback visual mesmo quando já não pertencia ao documento atual.

### Correção

- `pieces: []` e `patternDefinitions: []` passam a ser estados válidos.
- Autosave V3 omite `activePatternId` quando a bancada está vazia e restaura `activePieceId` como string vazia.
- Store carrega e restaura zero peças, limpa referências e permite excluir a última peça.
- Undo e redo atravessam corretamente o estado vazio.
- O Canvas permanece montado para permitir desenhar do zero.
- O snapshot antigo não é desenhado como peça fantasma.
- A interface apresenta estado vazio e ações para abrir moldes ou desenhar.
- O inspetor não exibe propriedades de uma peça inexistente.

### Testes

- `emptyWorkspace.test.ts`: carregamento vazio, seleção, exclusão da última peça, undo/redo, criação da primeira peça e remoção de referências.
- `emptyAutosave.test.ts`: round-trip do Documento V3 vazio e restauração de autosave sem peça ativa.
- `recovery-empty-workspace-visual.mjs`: desktop 1366×768 e mobile 390×844, criação vazia, desenho, exclusão, undo e redo.
- Typecheck, suíte completa e build de produção executados na branch.

### Evidência visual

Os screenshots são publicados como artifact do workflow `Recovery 9.5 Empty Workspace`. Eles apoiam a inspeção técnica, mas não substituem o teste manual do usuário.

### Preview e validação manual

- URL de preview: pendente após o commit validado da branch.
- Status: aguardando conclusão do workflow, inspeção visual e teste manual do usuário.

## Manequim visual — decisão preservada no 9.5-07

O visual usa somente GLB/glTF aprovado pelo usuário e só oferece os perfis corporais realmente disponíveis. Cápsulas e elipsoides permanecem colisores invisíveis. O 9.5-07 implementou contrato, `GLTFLoader`, calibração e lifecycle sem escolher, baixar ou incorporar qualquer asset por conta própria.

## Etapa 9.5-07 — fluxo canônico, classificação, montagem e avatar

### Identidade da entrega

- Branch: `recovery/9.5-07-assembly-avatar-final`.
- Commit base aprovado do 9.5-06: `a75107f40c47e29781ea35f603d679b422a1778f`.
- Checkpoint canônico desta etapa: `32437a486d3a65f3f29b5d9da749d070c60b6042`.
- Commit final: o `HEAD` publicado da branch entregue; o hash é informado junto da URL para evitar uma referência circular dentro do próprio commit.
- Prompt 10: bloqueado.

Commits-base dos gates preservados no histórico:

- 9.5-05 operações de modelagem: `637a455` (com correções anteriores no mesmo ramo).
- 9.5-06 moldes/manga e bloqueadores: `5a43bf4`, `c5d105c`, `c4e96c2`, `a75107f`.

### Causa raiz do desacoplamento 2D → 3D

O viewport recebia snapshots criados diretamente de `garment.pieces`, enquanto outras partes da montagem reparavam templates e inferiam placements. A invalidação dependia de identidade de objetos, o renderer limpava e reconstruía toda a scene, e `PanelInstance` não carregava assinatura nem relação por vértice com o 2D. Assim, um documento podia estar matematicamente válido e ainda vestir geometria/semântica antiga, inventada ou incompleta.

### Fonte autoritativa e fluxo

```text
edição Zustand/GarmentDraft
→ PatternDocumentV3
→ ResolvedAssemblyInput
→ PatternDefinitionV3 + PanelInstanceV3 + SeamGroupV3
→ PanelTopology + vertexSources
→ SemanticAvatarArrangement
→ GarmentAssemblyState
→ Three meshes reconciliadas
```

`PatternDefinitionV3` possui a geometria única. `PanelInstanceV3` guarda apenas identidade física, cópia, lado, espelhamento, tecido, status e anchor. `PanelTopology` registra `sourcePatternId`, assinatura e origem/interpolação de cada vértice. Workspace transform não entra na posição corporal nem na assinatura física.

### Classificação corporal e sugestões

- Peças livres, duplicadas e resultados de recorte começam `unclassified`.
- Nome, `templateId`, silhueta e posição na bancada não classificam.
- **Posição no corpo** exige função, região, superfície, lado e anchor; face externa, offsets e rotações ficam em ajustes avançados.
- **Não incluir no 3D** é explícito.
- Sugestões usam apenas papéis semânticos inequívocos de segmentos e ficam somente no estado local do formulário até **Confirmar posição**.
- Confirmar/remover posição participa de undo/redo e autosave V3.
- `canOpenViewport` e `canDressBody` são distintos; vestir exige todas as peças visíveis incluídas confirmadas.

### PanelInstances, anchors e escala

- IDs: `<sourcePatternId>:panel:<copyIndex + 1>`.
- `cutQuantity: 2` com regra de par produz esquerda/direita determinísticas e mesma definição fonte.
- Anchors públicos: torso, ombros, braços, cintura, quadril frontal/traseiro/lateral, pernas e pescoço.
- O anchor confirmado é propagado até `PatternPreviewPlacement.bodyAnchorId` e resolvido exatamente.
- `scale` físico é sempre 1; tamanho vem dos milímetros do molde. Ajustes de posição não redimensionam a roupa.

### Costuras

`SeamGroupV3` é a relação autoritativa entre arrays de `EdgeRange`. Direção, tratamento, distribuição, `targetRatio`, `slackMm` e estado ativo sobrevivem ao round-trip, são editáveis com histórico e chegam às constraints. Comprimentos são calculados por arco. Borda órfã/inválida produz diagnóstico e não é convertida silenciosamente. Nenhum reparo automático de template roda no caminho genérico.

### Avatar e proxies

- Asset visual utilizado: nenhum; não existe GLB/glTF aprovado no repositório.
- UI: “Manequim humano ainda não configurado.”
- Procedural: removido do caminho público; nenhum fallback silencioso.
- Contrato/loader: descritor versionado, licença/atribuição, unidade, escala, eixos, piso, transform, `GLTFLoader`, inspeção e fetch cancelável.
- Modelo paramétrico: preservado para medidas, landmarks, joints e anchors.
- Proxies: 12 descritores internos de colisão, invisíveis e fora da scene pública; sem alegação de física.
- Estado do gate visual: pendente de asset aprovado e validação manual.

### Reconciliação e lifecycle

- Mesh key: `PanelInstance.id`; invalidação: `geometrySignature`.
- Mesma identidade/geometria pode reutilizar buffers; geometria alterada atualiza/recria; instância ausente é removida e descartada.
- Alterar roupa preserva câmera, OrbitControls, iluminação e avatar.
- Fechar desmonta o viewport e cancela RAF/load, desconecta `ResizeObserver`, remove listeners, descarta controles, geometrias, materiais, texturas, listas/contexto, renderer e canvas.
- Auditoria de 20 ciclos: 0 canvases e 0 RAFs após fechar; observers retornaram ao baseline 2 em todos os ciclos; 0 erros de console. O heap após GC estabilizou próximo de 45–48 MB depois da primeira criação, com pequena variação/caches do navegador entre ciclos.

### Jornadas obrigatórias

| # | Resultado | Evidência |
|---|---|---|
| 1 peça livre | PASS | browser desktop: nenhuma classificação automática |
| 2 vestir sem classificação | PASS | bloqueio, foco e zero canvas/mesh |
| 3 classificação completa | PASS técnico | `torso-front`, uma instância; visual humano pendente do asset |
| 4 fidelidade de ponto | PASS | +250 mm, signature mudou; undo/redo restaurou/reaplicou |
| 5 fidelidade de curva | PASS | handle numérico mudou signature/mesh |
| 6 exclusão | PASS | 2→1 mesh, undo 1→2 |
| 7 custom em outra região | PASS | peça arbitrária em `leg-right`, sem inseam/outseam |
| 8 par | PASS | teste V3: duas instâncias determinísticas left/right |
| 9 costura | PASS | browser mobile + testes de edição/inversão/ativação/exclusão/undo |
| 10 editar após costurar | PASS | arco recalculado e remap/invalidação explícita testados |
| 11 recorte | PASS | V transacional; filhos unclassified, zero instâncias até confirmar; undo/redo |
| 12 pence/prega | PASS técnico | fechamento chega à topologia; prega mantém metadados sem física |
| 13 vazio | PASS | zero garment meshes e nenhuma roupa fantasma |
| 14 reload | PASS | 2 peças + costura + mesmos instance IDs após autosave/reload |
| 15 viewport | PASS técnico | orbit/zoom, 20 ciclos, recursos retornam ao baseline |
| 16 mobile | PASS | 390×844: criar, classificar, vestir, editar, costurar, orbit/pinch, fechar/reabrir, sem overflow |

Evidências locais:

- `artifacts/recovery-9-5-07-baseline/`
- `artifacts/recovery-9-5-07-flow/`
- `artifacts/recovery-9-5-07-journeys/`
- `artifacts/recovery-9-5-07-mobile/`
- `artifacts/recovery-9-5-07-lifecycle/`

### Bugs encontrados e corrigidos

- `canDressBody` confundia triangulação com possibilidade de vestir.
- Nomes “Costas”/“Calça” e template podiam influenciar placement/migração.
- V3 inventava defaults corporais para não classificados.
- Viewport ignorava assinatura primitiva e reconstruía scene/avatar a cada update.
- Escala de arrangement alterava dimensão física.
- Topologia não expunha origem por vértice nem assinatura da definição.
- Cut mantinha classificação/anchors que precisavam ser revalidados.
- Runtime perdia distribuição, proporção e slack de `SeamGroup`.
- Painel genérico oferecia reparo automático de costuras de template.
- Fechar apenas escondia o viewport, mantendo recursos montados.
- Piso, material e contexto WebGL não eram descartados explicitamente.
- Procedural era mostrado como avatar final sem asset aprovado.

### Regressões e limitações

- Bancada vazia, seleção, ponto, handle, curva, numérico, duplicar/espelhar, recorte, pence, prega, fechar, Escape, undo/redo, zoom/pan e mobile permanecem cobertos pela suíte e pelos browsers de auditoria.
- Templates continuam ocultos/deferred e não são fallback público.
- Sem XPBD, gravidade, colisão, autocolisão, física de pence/prega ou Prompt 10.
- Sem asset humano aprovado: aparência, pose, skin/bones/morphs, licença e calibração visual não puderam ser validados.
- WebGPU não estava disponível no Chrome headless; fallback WebGL 2 foi o backend efetivamente exercitado.
- Não houve aparelho móvel físico nem Safari.

Validação técnica final local:

- `npm run typecheck`: PASS;
- `npm test`: PASS, 63 arquivos / 380 testes;
- `npm run build`: PASS (`vite build --mode fallback`);
- browsers: 1366×768, 1920×1080, 390×844 e 844×390 sem erros de console; mobile sem overflow horizontal.

### Status

**NÃO APTO** para liberação do Prompt 10 enquanto o usuário não fornecer/aprovar o asset humano e validar visualmente o resultado. A arquitetura, montagem estática e jornadas técnicas estão prontas para validação manual.
