# Plano de física XPBD

## Estado atual — Prompt 10

A referência física CPU está integrada ao produto real e roda em Web Worker. A descrição detalhada está em [XPBD_IMPLEMENTATION.md](XPBD_IMPLEMENTATION.md).

```text
Documento V3 → assembly inicial → adapter SI/SoA → Worker XPBD
→ frame revisionado → ponte Three.js → positions/normais da mesh existente
```

Implementado:

- timestep fixo com accumulator, substeps, iterations e delta clamp;
- gravidade, massa por área e damping;
- stretch anisotrópico warp/weft, shear independente e bend discreto;
- SeamGroups interpoladas e compostas `N↔M`;
- residual inicial progressivo e transmissão de força;
- lifecycle completo e rebuild limpo por revision/generation;
- transferables, double buffering, reciclagem e backpressure;
- proteção contra topologia incompatível, NaN, Infinity e correções explosivas;
- atualização da `BufferGeometry` sem passar partículas por React.

## Ordem das próximas etapas físicas

1. proxies de colisão do avatar aprovados, sem alterar o solver estrutural;
2. contato tecido-corpo e atrito;
3. colisão com chão como opção de diagnóstico;
4. self-collision e multicamadas;
5. anchors/notches e distribuição piecewise de ease/gather;
6. validação e profiling em dispositivos reais;
7. somente depois, avaliar GPU/WebGPU mantendo a CPU como referência.

O initial assembly permanece geométrico. Não deve voltar a fechar costuras por deformação estática nem absorver responsabilidades físicas.
