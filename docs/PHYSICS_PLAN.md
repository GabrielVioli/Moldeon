# Plano de física XPBD

## Dados mínimos

```text
positions          Float32Array, xyz
previousPositions  Float32Array, xyz
velocities         Float32Array, xyz
inverseMasses      Float32Array
triangles          Uint32Array
stretchConstraints pares de vértices + comprimento inicial
bendConstraints    arestas compartilhadas + compliance
seamConstraints    pares de pontos de bordas distintas
```

## Passo de simulação

1. Aplicar forças.
2. Prever posições.
3. Resolver alongamento.
4. Resolver cisalhamento.
5. Resolver flexão.
6. Resolver costuras.
7. Resolver colisão com avatar.
8. Resolver autocolisão.
9. Atualizar velocidades.
10. Recalcular normais.

## Estratégia

A CPU deve ser a referência de correção. Só depois de testes determinísticos, os gargalos serão movidos para WebGPU compute.
