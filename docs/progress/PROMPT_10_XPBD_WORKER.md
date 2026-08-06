# Prompt 10: XPBD CPU em Worker

## Estado

Implementação concluída quando a suíte, o build e a auditoria visual permanente estiverem verdes na `main`.

## Entregas

- núcleo XPBD determinístico em `physics/clothXpbd.ts`;
- conversor da montagem semântica em `garment3d/ClothSimulationInput.ts`;
- protocolo tipado em `physics/ClothWorkerProtocol.ts`;
- Worker real em `workers/cloth.worker.ts`;
- bridge com descarte de frames antigos e pool triplo em `physics/ClothWorkerBridge.ts`;
- atualização in-place de `BufferGeometry` no viewport;
- controles de pausa, passo, continuação e reset;
- rollback e indicador de instabilidade;
- testes canônicos e auditoria Chrome desktop/mobile.

## Decisões

- React permanece restrito ao estado de alto nível.
- O Worker é dono do estado físico.
- A cena, câmera, avatar, materiais e meshes não são reconstruídos por frame.
- A geometria de repouso 2D não é modificada pela simulação.
- Costuras de contagens diferentes usam referências interpoladas, não pareamento forçado por índice.
- `SharedArrayBuffer` não é requisito para o caminho compatível.

## Validação obrigatória

- typecheck;
- testes do núcleo, conversor e protocolo;
- build de produção;
- camiseta e calça em Chrome/WebGL 2;
- viewport desktop e 390×844;
- Worker avança frames;
- nenhum erro de console ou resposta HTTP;
- ausência de React e JSON no caminho por partícula;
- controles de ciclo de vida disponíveis;
- zero instabilidade nos cenários canônicos.

## Próxima etapa

O Prompt 11 adiciona colisão corporal por proxies, espessuras separadas, atrito e presets físicos completos.
