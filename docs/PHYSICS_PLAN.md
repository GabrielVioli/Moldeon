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


## Implementação do Prompt 10

O núcleo XPBD CPU está implementado em Worker real com passo semi-fixo, buffers SoA tipados, restrições de warp/weft/shear/bend, costuras interpoladas, anchors, rollback estável e pool triplo de `ArrayBuffer`. O viewport atualiza `BufferGeometry` in-place e não usa React no loop por partícula. Colisões corporais, atrito e espessuras de contato permanecem deliberadamente no Prompt 11.
