# Arquitetura

## Regra principal

React controla interface e estado de alto nível. Ele não deve guardar ou rerenderizar cada partícula do tecido.

```text
React + Zustand
    ↓ comandos e snapshots
Pattern engine Rust/WASM
    ↓ contornos e malhas
Web Worker XPBD
    ↓ buffers de posições
Three.js WebGPURenderer
    ↓
WebGPU ou WebGL 2
```

## Editor 2D

O editor usa Canvas 2D para interação imediata. Toda geometria é armazenada em milímetros. O Canvas é somente uma visualização, não a fonte da verdade.

## Núcleo Rust

Responsabilidades:

- Pontos, segmentos e peças.
- Fórmulas paramétricas.
- Interseções.
- Área e perímetro.
- Margens de costura.
- Validação.
- Triangulação determinística de contornos amostrados.
- Preparação de costuras.

## Viewport 3D

Antes do renderer existe uma camada de montagem pura: `analyzeSeamCompatibility`, `buildAssemblyGraph` e `evaluateGarment3DEligibility`. Ela é testável sem DOM/Three.js e decide quais componentes conectados podem ser exibidos. `AssemblyPlacement` define papel, lado externo, posição e rotação iniciais; templates fornecem valores explícitos e peças livres recebem inferência editável.

Three.js é responsável por:

- Câmera e OrbitControls.
- Avatar.
- Materiais e iluminação.
- Malhas da roupa.
- Picking e visualizações técnicas.
- WebGPU/WebGL 2.

Three.js não deve conter regras de modelagem.

O viewport é carregado por `import()` somente após pedido explícito e elegibilidade positiva. Na Montagem, a malha corporal compartilhada funciona como referência de colisão invisível; o corpo visual aparece apenas na Prova. WebGL 2 é o fallback explícito; o módulo WebGPU é baixado apenas quando `navigator.gpu` existe. A renderização ocorre sob demanda e reconcilia painéis por assinatura para preservar câmera e controles quando só uma peça muda.

## Física

O solver deve ser independente do renderer. Entradas e saídas serão `Float32Array`, `Uint32Array` e estruturas compactas.

Primeira implementação: XPBD em CPU dentro de Web Worker.

Evolução: restrições mais pesadas e colisões em compute shaders WebGPU.

## Persistência

- OPFS: autosave e cache local.
- Arquivo `.moldeon`: exportação portátil.
- Laravel + PostgreSQL: projetos, versões, usuários e compartilhamento.
- MinIO/S3: avatares, texturas, previews e arquivos binários.
