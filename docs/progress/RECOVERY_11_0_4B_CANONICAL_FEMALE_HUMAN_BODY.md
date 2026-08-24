# Recovery 11.0.4B — Shape-preserving female body calibration

Status: **PRONTO PARA VALIDAÇÃO VISUAL MANUAL**. O resultado não foi
autoaprovado visualmente.

Branch: `recovery/11.0.4b-canonical-female-human-body`

Base confirmada no início: `041e7aae40b1f84b99e3fa5073d65464fff46977`

## Resultado

O `HumanBodyModel` continua usando exclusivamente o
`canonical-female.glb` como anatomia. A continuação desta etapa corrige a
calibração que preservava medidas, mas destruía ombros, busto, cintura,
quadril, glúteos e pernas.

O pipeline final é:

```text
GLB bruto
  → normalização canônica (sem alteração anatômica)
  → shape canônico em T-pose/rest
  → precondicionamento uniforme e suave do volume
  → cage RBF compacto + correção métrica no shape de repouso
  → FINAL BODY SHAPE
  → pose opcional articulada clavícula → úmero
  → visualMesh e collisionMesh derivados da mesma superfície final
```

Shape e pose não alimentam um ao outro. Circunferências e raios são medidos no
shape de repouso; centros, normais e joints espaciais acompanham a pose de
apresentação.

## Causas da falha visual anterior

1. A pose era aplicada cedo demais e contaminava medições e correções de shape.
2. Medidas de fita/superfície, como shoulder-to-bust e waist-to-hip, eram usadas
   como deslocamentos verticais literais.
3. `highBust` era tratado como underbust, criando prateleira e dobra horizontal
   sob o busto.
4. Medidas estimadas eram tratadas como se tivessem sido fornecidas pelo
   usuário, afastando desnecessariamente a malha da anatomia canônica.
5. Bandas de correção sequenciais e largas se sobrescreviam; a última estação
   podia desfazer cintura, quadril ou transição de perna.
6. A correção de busto concentrava volume em profundidade frontal e produzia
   projeção pendular em vez de preservar largura, caixa torácica e costas.
7. A rotação de braço usava o landmark externo do ombro como dobradiça. Isso
   deixava o deltoide medial do lado errado do eixo e formava um shoulder pad.
8. Perfis extremos começavam longe demais da solução; o line search de
   segurança recusava correções posteriores e o measurement plane da pose
   mascarava o erro do shape real.

## Shape preservation

- O perfil nativo é medido diretamente na própria base, sem assumir que o
  profile padrão é a canonical.
- Para o perfil nativo, o pipeline retorna praticamente a mesma malha:
  RMS `0,6762 mm`, P95 `1,9640 mm`, máximo `3,5885 mm`.
- O precondicionamento usa um único scale radial suave para o tronco e uma
  spline radial contínua ao longo dos membros. No perfil nativo todos os fatores
  são `1`, portanto não há drift de identidade.
- As estações finais são resolvidas simultaneamente a partir de um estado
  imutável da iteração, com regularização somente do campo de deslocamento.
- O shape canônico nunca é suavizado destrutivamente.
- Line search rejeita inversões, áreas degeneradas e ratios extremos.

## Pose articulada

A pose neutra usa uma hierarquia virtual curta:

- rotação pequena de clavícula para criar shoulder slope;
- rotação principal do úmero no centro glenoumeral;
- acrômio continua sendo a referência externa de largura do ombro;
- pesos suaves próprios de pose, separados dos pesos de shape;
- braços permanecem afastados do tronco, mãos para baixo e cotovelos neutros.

Não existe scaling regional de peito/deltoide nem deslocamento posicional para
“empurrar” o braço. A transformação inversa recupera o shape canônico com RMS
`0,0000126 mm` e máximo `0,0000596 mm`.

## Auditoria da base

- Asset: `apps/web/public/models/human/canonical-female.glb`.
- SHA-256: `f308a288de3f4747072e8bd3b955baaf03cd0255dabdbe0f0b30cd225f059176`.
- Asset bruto: 17.922 vértices e 32.216 triângulos.
- Sem skeleton, skin, animação ou morph target no arquivo.
- Topologia normalizada fixa: 16.364 vértices e 32.508 triângulos.
- Signature: `canonical-female:16364:32508:e990129c`.
- 0 boundary edges, 0 non-manifold edges, 0 degenerações e 0 inversões.
- Visual e collision usam o mesmo index buffer e a mesma superfície final.

Medição independente do GLB bruto:

| Medida | Valor |
|---|---:|
| altura | 1797,79 mm |
| busto | 944,50 mm |
| cintura | 746,78 mm |
| quadril | 1120,76 mm |
| coxa | 490,35 mm |
| joelho | 325,35 mm |
| panturrilha | 292,84 mm |
| tornozelo | 230,82 mm |

## Gates numéricos finais

No profile de referência atual:

- maior erro corporal: `3,5841 mm`;
- máximo edge stretch ratio: `1,1124`;
- máximo area ratio: `1,1947`;
- maior mudança de normal: `10,8013°`;
- boundary/non-manifold/inverted triangles: `0 / 0 / 0`.

Os três profiles obrigatórios (`1680/920/760/1000`,
`1600/840/680/920` e `1750/1050/900/1120`) e os três profiles explícitos
compact/curvy/tall passam a tolerância de `5 mm` ou `1%`, mantêm a mesma
topologia e não produzem inversões.

## Evidência visual

Vistas finais smooth-shaded:

- [front](../validation/human-body-11.0.4b-calibration/front.png)
- [side](../validation/human-body-11.0.4b-calibration/side.png)
- [back](../validation/human-body-11.0.4b-calibration/back.png)
- [front 3/4](../validation/human-body-11.0.4b-calibration/front-three-quarter.png)
- [back 3/4](../validation/human-body-11.0.4b-calibration/back-three-quarter.png)
- [front silhouette](../validation/human-body-11.0.4b-calibration/front-silhouette.png)
- [side silhouette](../validation/human-body-11.0.4b-calibration/side-silhouette.png)
- [back silhouette](../validation/human-body-11.0.4b-calibration/back-silhouette.png)

Diagnóstico por estágio:

- [stage 0 — GLB bruto, front](../validation/human-body-11.0.4b-calibration/stages/stage-0-raw-glb-front.png)
- [stage 1 — normalized, front](../validation/human-body-11.0.4b-calibration/stages/stage-1-normalized-front.png)
- [stage 2 — posed, front](../validation/human-body-11.0.4b-calibration/stages/stage-2-posed-front.png)
- [stage 3 — pre-metric, front](../validation/human-body-11.0.4b-calibration/stages/stage-3-deformed-before-metric-correction-front.png)
- [stage 4 — final, front](../validation/human-body-11.0.4b-calibration/stages/stage-4-final-front.png)
- [runtime metadata](../validation/human-body-11.0.4b-calibration/smoke.json)

O Chrome real abriu 21 combinações de vista/estágio com WebGL2 via
ANGLE/SwiftShader, sem console error ou page error. O smoke também valida
asset, topologia, paridade visual/collision, medidas, identidade e mesh quality.

## Verificações

- Testes focais: `7 files / 19 tests` — **PASS**.
- `npm run typecheck --workspace @moldeon/web` — **PASS**.
- `npm run build --workspace @moldeon/web` — **PASS**.
- Browser visual smoke: `21/21` vistas — **PASS**.
- Suíte global executada uma única vez: `610 passed`, `28 failed`, `3 skipped`.

As 28 falhas globais restantes estão em 18 arquivos de assembly, XPBD, cós,
registro corporal e performance/timeout. Nenhum teste de
`CanonicalFemaleMesh`, `HumanBodyModel`, `AvatarParametricModel`,
`AvatarCollisionCoverage` ou `AvatarVisual` falhou. Esses blockers permanecem
separados porque o escopo proíbe alterar roupa, assembly, XPBD ou iniciar a
collision final da 11.0.5.

## Validar manualmente

1. Comparar front/side/back e 3/4 com a referência visual anexada.
2. Confirmar que neck-to-shoulder e shoulder slope são suaves, sem shoulder pad.
3. Conferir que busto está alto e integrado ao tórax, sem prateleira de
   underbust ou dobra pendular.
4. Conferir cintura, high hip, full hip e glúteos em continuidade anatômica.
5. Conferir raiz das coxas, taper de joelho/panturrilha e tornozelo.
6. Conferir as silhouettes, que não dependem de shader para esconder defeitos.
7. Girar o manequim no navegador e procurar folds, gaps, interseções ou normals
   invertidas na axila/ombro.
8. Alterar busto, cintura, quadril e membros e confirmar resposta local e suave.

Não houve alteração em garment, assembly, XPBD, PatternDocumentV3 ou collision
final. Não foi iniciada a 11.0.5 e não houve merge na `main`.
