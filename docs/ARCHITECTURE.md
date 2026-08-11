# Arquitetura

## Regra principal

React controla interface e estado de alto nível. Ele não deve guardar ou rerenderizar cada partícula do tecido.

```text
React + Zustand
    ↓ comandos e projeções de interface
PatternDocumentV3
    ↓ geometria 2D autoritativa em milímetros
Pattern engine Rust/WASM
    ↓ contornos e malhas derivadas
Web Worker XPBD
    ↓ buffers de posições
Three.js
    ↓
WebGPU ou WebGL 2
```

## Domínio canônico

`PatternDocumentV3` é o formato persistido canônico. O contrato completo está em `docs/PATTERN_DOCUMENT_V3.md`.

As principais fronteiras são:

```text
PatternDocumentV3
├── PatternDefinitionV3     molde técnico editável
├── PanelInstanceV3         cópia física derivada
├── PatternConnectorV3      semântica de intervalos de borda
├── SeamGroupV3             relação topológica entre lados
├── FabricSource            tecido e propriedades
├── MeasurementSetV3        medidas corporais
├── WorkspaceStateV3        bancada 2D persistente
└── SimulationSettingsV3    preferências, nunca partículas
```

Invariantes:

- Milímetros são a unidade autoritativa.
- `PatternDefinitionV3` possui toda geometria 2D autoritativa.
- `PanelInstanceV3` referencia uma definição e não duplica geometria.
- Conectores e costuras referenciam IDs estáveis de molde e borda.
- Estado temporário do renderer, câmera, buffers e partículas não é persistido.
- Migrações inválidas falham antes de substituir qualquer projeto existente.

`GarmentDraft` continua como projeção temporária para partes do runtime atual, mas não é mais uma entrada independente da montagem. `ResolvedAssemblyInput` é criado imediatamente a partir do V3, recorta somente instâncias confirmadas/incluídas e produz uma projeção legada derivada. Campos canônicos de costura (`SeamGroup`, distribuição, proporção, slack e tratamento) são preservados nessa projeção e chegam às constraints.

## Migrações e arquivos

A sequência de migração é explícita:

```text
legado → PatternProjectV2 → PatternDocumentV3
```

Autosaves V1 e V2 recebem cópia recuperável antes da migração. Arquivos portáteis são importados por `storage/patternProjectIO.ts` e exportados sempre como V3 validado.

## Editor 2D

O editor usa Canvas 2D para interação imediata. Toda geometria é armazenada em milímetros. O Canvas é somente uma visualização, não a fonte da verdade.

Durante a compatibilidade temporária, o editor ainda trabalha com `PatternPiece`. O adaptador V3 preserva pontos, nós, segmentos, contornos, curvas, linhas internas, pences, guias e transforms da bancada.

## Operações geométricas de caminhos internos

`InternalPath` é a representação canônica de linhas internas editáveis. Um caminho possui nós em milímetros, segmentos retos ou cúbicos, finalidade, visibilidade, bloqueio e metadados. A finalidade pode ser alterada sem reconstruir a geometria.

A fronteira da operação é:

```text
Ferramenta Canvas / sessão Zustand
    ↓ comando transacional
InternalPath autoritativo em PatternPiece / PatternDocumentV3
    ↓ análise pura
interseções + regiões + costuras afetadas + diagnósticos
    ↓ aplicação atômica
novos contornos, pence estrutural ou SeamGroup
```

Responsabilidades:

- `state/internalPathEditorStore.ts` guarda somente a sessão da ferramenta, seleção e transação atual.
- `domain/internalPaths.ts` analisa e aplica corte, corte com costura e fechamento estrutural de pence sem depender de React, Canvas ou Three.js.
- `PatternCanvas.tsx` faz hit testing, desenho de nós/alças e encaminha gestos. Ele não decide validade geométrica.
- `PatternDocumentV3` continua sendo o formato persistido. Caminhos, pences e grupos de costura são projetados sem perda nos recursos suportados.
- A aplicação retorna um novo documento completo ou falha sem alterar o documento anterior. Não existe estado intermediário de “meio corte”.

O fallback geométrico desta fase está em TypeScript e possui testes determinísticos. Essa escolha é explícita porque o núcleo Rust atual ainda recebe `PatternPiece` e não implementa o schema raiz V3 nem grupos de costura multifaixa. A migração para Rust/WASM deve preservar os mesmos contratos, diagnósticos e fixtures antes de substituir o fallback.

Tolerâncias atuais:

- interseção e deduplicação: `0,08 mm`;
- área mínima de uma região resultante: `4 mm²`;
- curvas são divididas com De Casteljau e amostradas somente para análise e hit testing;
- o contorno persistido continua usando segmentos cúbicos quando a curva original ou o caminho de corte é cúbico.

Limites geométricos deliberados:

- um corte aberto deve atravessar o contorno exatamente duas vezes;
- tangências, sobreposição com a borda, mais de duas interseções e regiões degeneradas são rejeitadas;
- a fase não oferece operações booleanas universais, ilhas internas, bolsos funcionais ou autointerseções arbitrárias;
- costuras afetadas são remapeadas quando a referência continua inequívoca e invalidadas com diagnóstico quando não pode ser preservada com segurança.

## Núcleo Rust

Responsabilidades pretendidas:

- Pontos, segmentos e definições de molde.
- Fórmulas paramétricas.
- Interseções.
- Área e perímetro.
- Margens de costura.
- Validação geométrica.
- Triangulação determinística de contornos amostrados.
- Preparação de conectores e costuras.

A fronteira Rust/WASM atual ainda recebe `PatternPiece`. O documento V3 permanece autoritativo no TypeScript até que o schema equivalente seja implementado no núcleo sem perda.

## Fluxo canônico 2D → 3D

```text
Zustand / GarmentDraft editável
    ↓ conversão imediata
PatternDocumentV3
    ↓ buildResolvedAssemblyInput
PatternDefinitionV3 + PanelInstanceV3 + SeamGroupV3
    ↓ assinatura geométrica e mapeamento de origem
PanelTopology
    ↓ arrangement por anchor corporal confirmado
GarmentAssemblyState
    ↓ reconciliação por PanelInstance.id + geometrySignature
Three meshes
```

`PatternDefinitionV3` é a única fonte da geometria. Cada vértice de topologia registra `sourcePatternId`, ponto/segmento/edge e parâmetro ou os vértices dos quais foi derivado. Transform da bancada nunca participa da assinatura ou da posição corporal. Alterar ponto ou controle Bézier muda a assinatura; excluir uma definição remove suas instâncias e meshes.

## Viewport 3D

Antes do renderer existe uma camada de montagem pura: `analyzeSeamCompatibility`, `buildAssemblyGraph` e `evaluateGarment3DEligibility`. Abrir o viewport e vestir são decisões diferentes. O viewport pode abrir vazio, mas `canDressBody` exige classificação corporal completa para toda peça visível incluída no 3D.

`PanelInstanceV3.arrangementAnchor` é derivado exclusivamente da classificação confirmada. Peças livres começam `unclassified`; sugestões por papéis explícitos de segmentos são efêmeras e somente viram documento após confirmação do usuário. Nome, `templateId`, geometria e transform da bancada não inferem posição corporal.

Three.js é responsável por:

- Câmera e OrbitControls.
- Avatar.
- Materiais e iluminação.
- Malhas da roupa.
- Picking e visualizações técnicas.
- WebGPU/WebGL 2.

Three.js não deve conter regras de modelagem nem ser fonte de verdade do documento.

O viewport é carregado por `import()` somente após pedido explícito e elegibilidade positiva. WebGL 2 é o fallback explícito; o módulo WebGPU é baixado apenas quando `navigator.gpu` existe. A renderização ocorre sob demanda e reconcilia painéis por assinatura para preservar câmera e controles quando só uma peça muda.

## Física

O solver deve ser independente do renderer. Entradas e saídas serão `Float32Array`, `Uint32Array` e estruturas compactas.

Primeira implementação planejada: XPBD em CPU dentro de Web Worker.

Evolução: restrições mais pesadas e colisões em compute shaders WebGPU.

`SimulationSettingsV3` contém somente preferências. Posições, velocidades, multiplicadores de Lagrange, colisões e buffers nunca são persistidos como estado autoritativo.

## Persistência

- OPFS: autosave V3, backup pré-migração e cache local.
- Arquivo `.moldeon`: exportação portátil V3.
- Laravel + PostgreSQL: projetos, versões, usuários e compartilhamento.
- MinIO/S3: avatares, texturas, previews e arquivos binários.

## Separação entre camadas

```text
Domínio
  PatternDocumentV3, validação, migração e IDs

Geometria
  amostragem, triangulação, offsets e análise de contorno

Montagem e física
  instâncias, conectores, SeamGroups, constraints e colisões

Renderização
  Three.js, materiais, câmera e buffers de GPU

Interface
  React, Zustand, ferramentas e feedback ao usuário
```

React não entra no loop por partícula. Three.js não decide a semântica de costura. O solver não modifica a geometria 2D autoritativa.

## Avatar e arranjo semântico

A camada 3D é dividida em quatro partes:

1. `avatar/AvatarParametricModel.ts`: medidas, landmarks, articulações e anchors, sem Three.js.
2. `avatar/AvatarCollisionModel.ts`: elipsoides e cápsulas futuros, sem renderização.
3. `avatar/ApprovedAvatarAsset.ts` + `ApprovedAvatarLoader.ts`: contrato, carregamento e calibração de GLB/glTF explicitamente aprovado.
4. `garment3d/SemanticAvatarArrangement.ts`: expansão, validação, associação aos anchors e estabilização geométrica limitada.

`GlobalThreeViewport` coordena renderer, asset visual aprovado, malhas de roupa, câmera e descarte. O antigo `AvatarVisual.ts` permanece apenas isolado por testes legados e não é importado pelo caminho público. Sem asset aprovado, a interface informa “Manequim humano ainda não configurado.” e o gate permanece pendente.

O pipeline ativo não contém projeção cilíndrica global, modo explodido ou corpo ocultável. `previewPlacements` são metadados de arranjo; transforms da bancada 2D não determinam a posição no corpo.

Nenhum asset externo de avatar é usado nesta branch. Proxies de colisão continuam descritores internos invisíveis e nunca entram na scene pública. O lifecycle cancela RAF/carregamento, desconecta observer/listeners, descarta controles, geometrias, materiais, texturas, listas/contexto do renderer e remove o canvas.

