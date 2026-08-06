# Implementação XPBD no navegador

## Objetivo

O Prompt 10 substitui os solvers demonstrativos por um único núcleo XPBD determinístico, executado em um Web Worker real. O molde 2D e a montagem semântica continuam sendo a fonte de verdade; a física recebe apenas buffers derivados e devolve posições simuladas.

## Fluxo de dados

1. `GarmentAssembly` produz partículas, topologia, costuras interpoladas e anchors.
2. `ClothSimulationInput` converte o estado para estruturas SoA tipadas e independentes da cena.
3. `ClothWorkerBridge` transfere os buffers ao Worker por `ArrayBuffer`, sem JSON e sem React por partícula.
4. `cloth.worker.ts` mantém o relógio semi-fixo, o ciclo de vida e o estado XPBD.
5. Cada frame devolvido atualiza somente o atributo `position` das `BufferGeometry` existentes por `refreshMeshFromAssembly`.
6. Frames obsoletos são descartados e o buffer de saída é devolvido ao Worker para reutilização tripla.

## Estado SoA

O núcleo mantém:

- `positions`;
- `previousPositions`;
- `predictedPositions`;
- `velocities`;
- `inverseMasses`;
- `restPositions2D` e coordenadas materiais;
- triângulos globais;
- buffers de warp, weft, shear, bend, stitches e anchors;
- lambdas persistentes por restrição.

A integração usa passo fixo de 1/120 s, acumulador limitado, máximo de subpassos e teto de delta de renderização. Isso evita que uma aba lenta injete um salto arbitrário na simulação.

## Restrições

- Warp e weft são classificados pela direção no molde 2D e recebem compliances distintas a partir do tecido.
- Shear cobre diagonais estruturais.
- Bend liga vértices opostos de triângulos adjacentes, preservando uma medida validável e independente do nome da peça.
- Costuras usam referências lineares interpoladas de até duas partículas por lado, permitindo contagens de pontos diferentes e `ease` explícito.
- Anchors estabilizam os componentes sobre a montagem semântica sem alterar a geometria de repouso.

## Robustez

O solver valida finitude e dimensões dos buffers, limita velocidade e correção, mantém um estado estável anterior e faz rollback quando detecta NaN, infinito ou deslocamento fora do limite. O Worker pausa após uma instabilidade, mantém a última malha válida e exibe diagnóstico no viewport.

## Ciclo de vida

O protocolo tipado implementa:

- `initialize`;
- `update-geometry`;
- `update-seams`;
- `update-fabric`;
- `start`;
- `pause`;
- `step`;
- `reset`;
- `release-frame`;
- `dispose`.

O viewport expõe Continuar/Pausar, Passo e Reiniciar. Ao desmontar, o Worker é encerrado, listeners são removidos e os buffers visuais são descartados.

## Memória compartilhada

`SharedArrayBuffer` é detectado apenas como melhoria futura quando o contexto está isolado. O caminho obrigatório usa buffers transferíveis e funciona sem cabeçalhos especiais.

## Limites desta fase

O Prompt 10 não declara colisão corporal, autocolisão ou caimento final. Os proxies e materiais já entram na arquitetura, mas a projeção de colisão e o atrito pertencem ao Prompt 11.
