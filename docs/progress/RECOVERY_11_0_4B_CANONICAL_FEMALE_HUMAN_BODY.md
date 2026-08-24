# Recovery 11.0.4B — Canonical female HumanBodyModel

Status: **PRONTO PARA VALIDAÇÃO VISUAL MANUAL**. O manequim não foi
autoaprovado.

Branch: `recovery/11.0.4b-canonical-female-human-body`

## Resultado

`HumanBodyModel` deixou de gerar a superfície anatômica por campos implícitos,
gaussianas, cápsulas e marching tetrahedra. A fonte da anatomia agora é o asset
real `apps/web/public/models/human/canonical-female.glb`; a topologia permanece
fixa e somente posições, normais e dados derivados mudam entre perfis.

Fluxo implementado:

```text
canonical-female.glb
  -> auditoria e transformação única para o frame canônico
  -> weld de duplicatas de UV e fechamento interno das aberturas faciais
  -> pose neutra com braços abaixados
  -> bindings estáveis de landmarks e regiões suaves
  -> deformação regional orientada por medidas
  -> correção métrica local iterativa
  -> HumanBodyModel.visualMesh
  -> HumanBodyModel.collisionMesh (mesma superfície final nesta etapa)
```

## Auditoria do GLB

- SHA-256: `f308a288de3f4747072e8bd3b955baaf03cd0255dabdbe0f0b30cd225f059176`.
- 1.003.000 bytes; GLB 2.0 válido.
- 3 meshes / 3 primitives / 1 material / 9 nodes glTF (10 objetos na cena
  carregada).
- Sem animações, skin/skeleton ou morph targets.
- `Body__0`: 17.922 vértices, 32.216 triângulos indexados `Uint32`, com normals.
- `leye__0` e `reye__0` são ignoradas como meshes separadas da superfície
  corporal.
- Metadados do asset: Dori Mur, licença CC BY 4.0, fonte documentada no README
  junto ao modelo.
- Bounds corporais após world transform: aproximadamente X
  `[-0,831427, 0,831427]`, Y `[-0,000566, 1,797225]`, Z
  `[-0,125756, 0,139010]` m.
- O world transform do asset já resolve em metros, +Y para cima e +Z para a
  frente. A origem é deslocada uma única vez para o centro do chão.

O asset contém 1.590 duplicatas posicionais de seams de UV. Após weld espacial
existem 32 pequenas aberturas internas concentradas na região facial/ocular.
Elas são fechadas apenas na representação canônica em memória. O arquivo GLB
original não é alterado.

## Topologia canônica

- 16.364 vértices.
- 32.508 triângulos.
- Signature: `canonical-female:16364:32508:e990129c`.
- 0 boundary edges.
- 0 non-manifold edges.
- 0 triângulos degenerados.
- 0 triângulos invertidos nos três perfis de teste.
- Volume assinado positivo; perfil padrão: `0,0612977 m³`.
- Normals coerentes.

Vertex count, index buffer, topology signature, landmark vertex bindings,
region vertex indices e region weights são idênticos entre os perfis.

## Deformação e precisão

A altura e as estações longitudinais usam mapeamento monotônico por landmarks.
Braços usam mapeamento esquelético rígido ao longo do eixo, com falloff suave na
axila. Medidas de busto, cintura, quadril e membros atuam em regiões locais:

- busto prioriza projeção anterior/mamária e preserva costas/axila;
- cintura possui falloff até ribcage e high hip;
- quadril distribui largura e maior projeção posterior/glútea;
- coxa, joelho, panturrilha e tornozelo possuem correções independentes;
- braço, cotovelo e punho usam eixos anatômicos próprios.

O medidor intersecta diretamente os triângulos da superfície final com o plano
de cada seção. A correção usa o comprimento de arco medido, não bounding boxes.
A máscara de cada perna inclui o loop medial completo; isso eliminou a inflação
em losango que o medidor de arco parcial produzia.

| Perfil | Altura | Maior erro de circunferência | Maior erro de comprimento | Inversões |
|---|---:|---:|---:|---:|
| compact | 1550 mm | 2,501 mm | 2,149 mm | 0 |
| curvy | 1650 mm | 2,491 mm | 2,844 mm | 0 |
| tall | 1820 mm | 3,038 mm | 3,266 mm | 0 |

No perfil padrão, o maior erro de seção é `2,654 mm` (busto) e o maior erro de
comprimento é `2,564 mm` (waist-to-hip). Todos estão dentro do gate de 5 mm ou
1%.

## Landmarks e regiões

Os landmarks P0 estão ligados por índices/pesos à topologia e acompanham a
deformação: neck base, ombros, ápices do busto, cintura frontal/traseira/lateral,
high/full hip, glúteos, crotch frontal/traseiro, inseams, coxas, joelhos,
panturrilhas, tornozelos, armholes, cotovelos e punhos.

As regiões possuem pesos suaves, incluindo neck, shoulders, chest, bust L/R,
ribcage, waist, abdomen, high/full hip, pelvis, glute L/R, crotch, membros
inferiores e superiores.

## Visual, collision e integração

- `AvatarVisual` usa `HumanBodyModel.visualMesh` no caminho padrão.
- `visualMesh` e `collisionMesh` são derivados do mesmo array final de posições
  e do mesmo index buffer.
- Nesta etapa o collision/fitting mesh mantém a mesma topologia do visual para
  garantir verdade geométrica e paridade exata. A redução final pertence à
  11.0.5.
- O plugin Vite lê o GLB de modo read-only e o expõe ao runtime sem alterar
  source durante build/CI; isso preserva a API síncrona atual.
- O CI não executa mais scripts Python que reescrevem `HumanBodyModel.ts`.

## Evidência visual

- [front](../validation/human-body-11.0.4b/front.png)
- [side](../validation/human-body-11.0.4b/side.png)
- [back](../validation/human-body-11.0.4b/back.png)
- [front three-quarter](../validation/human-body-11.0.4b/front-three-quarter.png)
- [back three-quarter](../validation/human-body-11.0.4b/back-three-quarter.png)
- [front silhouette](../validation/human-body-11.0.4b/front-silhouette.png)
- [side silhouette](../validation/human-body-11.0.4b/side-silhouette.png)
- [back silhouette](../validation/human-body-11.0.4b/back-silhouette.png)
- [runtime metadata](../validation/human-body-11.0.4b/smoke.json)

O Chrome headless abriu todas as vistas no localhost com WebGL2/SwiftShader,
sem console error ou page error. O runner também exige no runtime: asset
canônico, paridade visual/collision, tolerância métrica, manifold, zero
degenerações, zero inversões e normals coerentes.

## Verificações

- `node scripts/audit-canonical-female.mjs`: PASS.
- `npm run typecheck --workspace @moldeon/web`: PASS.
- Focused tests (`CanonicalFemaleMesh`, `HumanBodyModel`, metrics,
  `AvatarParametricModel`, `AvatarVisual`): 11/11 PASS.
- Browser visual smoke: 8/8 vistas PASS.
- `npm run build`: PASS.
- Suíte global: 601 PASS, 31 FAIL, 3 skipped. As falhas restantes estão em
  suites de assembly/XPBD/cós e registro corporal legado. Elas não foram
  corrigidas nesta branch porque o escopo proíbe alterar assembly, roupa, XPBD
  e a collision final da 11.0.5. Portanto a suíte global não está verde, embora
  o gate focado obrigatório desta etapa esteja verde.

## Validar manualmente

1. Comparar as oito imagens com a referência prioritária, especialmente ombro,
   axila, busto, cintura, high/full hip, glúteos, crotch e raízes das coxas.
2. Conferir as silhouettes sem depender de shading ou wireframe.
3. Abrir o localhost e girar o manequim, procurando dobras, buracos,
   autointerseções estruturais ou partes com normal invertida.
4. Alterar medidas de busto, cintura, quadril, coxa e panturrilha e confirmar
   que a alteração permanece local e suave.
5. Confirmar que o resultado visual está próximo o suficiente da referência
   para aprovar o gate. Esta decisão permanece manual.

Não houve alteração em XPBD, assembly, roupa, PatternDocumentV3 ou collision
final. Não foi iniciado o Prompt 11.0.5 e não houve merge na main.
