# Implementação XPBD no Moldeon

## Escopo e fronteira arquitetural

O `PatternDocumentV3` continua sendo a fonte canônica. A simulação nunca grava posições físicas no documento nem altera a geometria 2D. O pipeline é:

```text
PatternDocumentV3
→ ResolvedAssemblyInput
→ initial assembly isométrico
→ GarmentXpbdAdapter
→ TypedArrays transferíveis
→ Web Worker XPBD
→ frame validado por revision + generation
→ BufferGeometry existente no Three.js
```

O initial assembly fornece uma pose espacial válida. Gravidade, deformação e fechamento físico das `SeamGroups` pertencem ao XPBD. O reset sempre volta às posições 3D derivadas novamente do estado canônico.

## Unidades e estado físico

- editor, `PatternDocumentV3` e source mapping: milímetros;
- solver: metros, segundos, quilogramas e m/s²;
- conversão: `1 mm = 0,001 m`, somente no adaptador de entrada;
- gravidade padrão: `[0, -9,81, 0] m/s²`;
- tolerância diagnóstica de costura: `0,0025 m`;
- velocidade defensiva máxima: `12 m/s`.

O estado é SoA e usa `Float32Array`, `Uint32Array` e `Uint8Array` para positions, previous/predicted/rest positions, velocities, inverse masses, material coordinates, triangles, constraints, compliances e lambdas. Não existe partícula em React ou Zustand.

## Timestep e constraints

O Worker usa accumulator com timestep fixo de `1/120 s`, delta de frame limitado a `1/20 s`, até 6 substeps e 8 iterations por padrão. Configurações V3 de substeps, iterations e gravidade são aplicadas na fronteira.

Stretch usa as arestas da tesselação e compliance anisotrópica calculada pela projeção da aresta material no fio. Para algodão padrão, os extremos warp/weft são aproximadamente `3,8e-7` e `5,6e-7`. Shear é uma constraint angular independente por triângulo; no algodão padrão usa aproximadamente `2,875e-6`. Bend usa molas entre vértices opostos de triângulos adjacentes e, no algodão padrão, compliance aproximada de `1,43e-3`.

Os comprimentos de repouso discretos de stretch, shear e bend são medidos na pose 3D inicial. As coordenadas 2D continuam sendo usadas para massa, fio e anisotropia. Isso evita injetar energia artificial ao iniciar uma peça já curvada pelo embedding isométrico.

## Costuras físicas

Cada `SeamGroup` é convertida em referências interpoladas de até dois vértices por lado, com pesos baricêntricos. A amostragem vem da parametrização acumulada por comprimento de arco já produzida pelo assembly e preserva:

- `1↔1`, `1↔N`, `N↔1` e `N↔M`;
- ordem dos ranges;
- `same/opposite`;
- treatment, distribution, ratio e slack;
- `PanelInstanceV3` e source mapping.

A distância de repouso de uma costura standard é zero; slack explícito é distribuído entre suas amostras. As compliances são `8e-8` para standard, `8e-7` para ease, `1,5e-6` para gather, `4e-6` para stretch/elastic e `8e-6` para mismatch intencional.

Residuais grandes convergem progressivamente dentro do trust region local. A fração de correção por iteration é 1 para autocostura e residual grande, e 0,35 para costuras que já começam dentro da tolerância. Isso não muda o molde nem teleporta painéis: cada partícula continua limitada pela menor aresta estrutural ao longo de vários steps.

## Segurança numérica e correção do blocker P0

A explosão ao adicionar um retalho tinha três causas combinadas:

1. o solver limitava `deltaLambda` diretamente, embora a correção real seja `inverseMass × gradient × deltaLambda`; partículas leves podiam saltar dezenas de metros;
2. stretch/bend recebiam comprimentos de repouso planos para uma pose inicial curva, gerando tensão artificial imediata;
3. rebuilds não possuíam uma geração monotônica independente da assinatura, permitindo risco de um frame A antigo encontrar uma nova topologia A após A→B→A.

A correção limita a correção posicional efetiva por partícula. O trust region é o menor entre 35 mm e 10% da menor aresta estrutural local. O estado estável anterior é preservado; NaN, Infinity ou magnitudes inseguras não são publicados.

Antes do Worker, o adaptador valida contagem e offsets por painel, finitude, `positions.length`, índices locais e `maxTriangleIndex < particleCount`. Cada rebuild zera constraints, lambdas, buffers e sequência. `revision + generation` acompanham todas as respostas. O cliente descarta frames antigos e o renderer repete a validação contra a topologia/mesh corrente antes de atualizar o atributo `position`.

## Worker, buffers e Three.js

O protocolo suporta `initialize`, `updateGeometry`, `updateSeams`, `updateFabric`, `start`, `pause`, `resume`, `step`, `reset` e `dispose`. Positions usam `ArrayBuffer` transferível, com dois buffers iniciais e reciclagem limitada a três. O cliente mantém somente o frame válido mais recente, devolvendo o anterior ao Worker.

O Three.js reutiliza mesh, material e `BufferGeometry` quando a identidade/topologia permite. Por frame, somente positions e normais são atualizadas. A reconciliação continua baseada em `PanelInstance.id`.

## Lifecycle e diagnóstico

`Provar` sempre solicita simulação, inclusive ao entrar diretamente no modo de prova. Pausar interrompe o timer; Passo avança exatamente um timestep; Continuar retoma; Reiniciar restaura o step zero e zera lambdas/velocidades. Ocultar a aba pausa o Worker e restaura o estado anterior ao voltar. Dispose remove timer, listener e buffers.

Em desenvolvimento, o host do viewport expõe revision, generation, topologia, frame recebido/aplicado/rejeitado, contagens de constraints e diagnósticos numéricos. Isso é usado pelo smoke de navegador e não participa da persistência.

## Limites deliberados

Esta etapa não implementa colisão com avatar, chão ou self-collision, corpo humano, multicamadas, zíperes ou GPU compute. Sem colisão, a roupa cai livremente. Bend é o modelo discreto por distância entre opostos, não um modelo contínuo de casca. Mismatch preserva ranges e tratamento, mas a distribuição profissional por piques/anchors permanece futura.
