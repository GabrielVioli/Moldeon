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

`GarmentDraft` continua como projeção temporária para o runtime atual. A projeção de V3 para esse formato rejeita recursos que sofreriam perda, como costuras com múltiplos intervalos, slack ou estado inativo.

## Migrações e arquivos

A sequência de migração é explícita:

```text
legado → PatternProjectV2 → PatternDocumentV3
```

Autosaves V1 e V2 recebem cópia recuperável antes da migração. Arquivos portáteis são importados por `storage/patternProjectIO.ts` e exportados sempre como V3 validado.

## Editor 2D

O editor usa Canvas 2D para interação imediata. Toda geometria é armazenada em milímetros. O Canvas é somente uma visualização, não a fonte da verdade.

Durante a compatibilidade temporária, o editor ainda trabalha com `PatternPiece`. O adaptador V3 preserva pontos, nós, segmentos, contornos, curvas, linhas internas, pences, guias e transforms da bancada.

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

## Viewport 3D

Antes do renderer existe uma camada de montagem pura: `analyzeSeamCompatibility`, `buildAssemblyGraph` e `evaluateGarment3DEligibility`. Ela é testável sem DOM/Three.js e decide quais componentes conectados podem ser exibidos.

O modelo V3 prepara a substituição de `AssemblyPlacement` por `PanelInstanceV3.arrangementAnchor`. Enquanto a migração não termina, o adaptador projeta o primeiro anchor compatível de cada definição para o placement legado.

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
