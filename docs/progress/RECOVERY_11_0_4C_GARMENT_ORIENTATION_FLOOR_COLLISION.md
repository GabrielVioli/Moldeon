# Recovery 11.0.4C — Garment registration orientation + floor collision

Status: **NOT ready for Prompt 11.0.5**

Branch: `recovery/11.0.4c-garment-orientation-floor-collision`

Base auditada: `88074caeaa1d96f14e525d61f7e3e33f227518bd`

O código específico de registration e floor está funcional e testado. A publicação foi bloqueada pelo gate final porque regressões herdadas de zero-energy/material physics continuam reproduzíveis no commit-base e as fixtures de camiseta/blusa ainda exibem deformação intrínseca alta. Conforme a regra de Git do prompt, não houve commit nem push.

## A. Root cause da orientação

O runtime anterior resolvia `BodyCollisionRegistration` deslocando o corpo até a roupa e mantinha rotação identidade. Assim, não existia uma transformação garment → body que convertesse a base espacial produzida pelo assembly para o frame anatômico. A posição podia parecer plausível em uma vista enquanto frente/costas, top/bottom ou quiralidade permaneciam errados.

O problema era agravado em dois pontos:

- o fluxo Provar podia substituir uma classificação corporal específica já documentada — por exemplo, manga/arm — pela região global selecionada para todo o connected component;
- renderer e física não consumiam necessariamente o mesmo winding depois da correção do lado externo.

O solver geométrico também oferece soluções espaciais espelhadas equivalentes. Antes, a escolha era feita somente pelo objetivo geométrico; não havia desempate pela quiralidade anatômica explícita.

## B. Invariantes implementados

- `HUMAN_BODY_FRAME` é a base canônica única: `+Y` up, `+Z` front, `+X` right, origem no centro do chão entre os pés.
- O HumanBodyModel permanece fixo. Somente a roupa recebe rotação + translação.
- A transformação tem determinante aproximadamente `+1`; escala e reflection não são aceitas.
- Uma pose refletida incompatível retorna `body-placement-required` com diagnóstico de quiralidade, em vez de aplicar escala negativa.
- A autoridade de registration prioriza placements explícitos e regiões estruturais principais; mangas, punhos, cós e outros attachments não redefinem a orientação global.
- O desempate entre branches do assembly usa frente/costas + esquerda/direita + eixo material, sem nomes de peças ou templates e sem alterar a métrica 2D.
- O fluxo Provar preserva regiões específicas obtidas de metadata/semantic roles/connectors.
- `flipWinding` é aplicado de forma idêntica no Three.js e nos triângulos enviados ao XPBD.
- Positions, initialPositions, previousPositions e anchors recebem a mesma transformação rígida; source mapping, PanelInstance e SeamGroup não são alterados.
- Telemetria inclui status/source, eixos body/garment, Euler/translação, determinante, islands, ambiguidades, outward consistency e contagem de flips.
- Há visualização DEV opcional dos frames BODY e GARMENT.

## C. Resultado de registration

Validação automatizada A–J:

- orientação inicial frontal;
- rotação material arbitrária;
- yaw artificial de 180°;
- preservação left/right;
- rejeição de determinant negativo;
- outward/winding renderer ↔ física;
- attachment estreito sem autoridade global;
- cut-on-fold/mirror/paridade;
- reset bit-idêntico;
- independência da câmera.

Fixtures reais automatizadas: self-seam tube, multipanel tube, straight skirt, notched tube + waistband, miniskirt, blouse e pants.

Browser, gravity 0%, body collision OFF:

| Fixture | Status | det(R) | Instances / meshes | Negative transforms | Outward consistency |
|---|---:|---:|---:|---:|---:|
| T-shirt + sleeves | registered | 1.000000 | 6 / 6 | 0 | 1 |
| Blouse + sleeves | registered | 1.000000 | 6 / 6 | 0 | 1 |
| Straight skirt | registered | 1.000000 | 4 / 4 | 0 | 1 |
| Four-panel tube | registered | 1.000000 | 4 / 4 | 0 | 1 |

Cada PanelInstance gerou exatamente uma mesh, com transform de mesh identidade e geometria já registrada nos buffers físicos. Não houve console error nem overlay de erro.

Screenshots:

- [T-shirt front](../../artifacts/recovery-11-0-4c-garment-orientation-floor-collision/tshirt-front.png), [side](../../artifacts/recovery-11-0-4c-garment-orientation-floor-collision/tshirt-side.png), [back](../../artifacts/recovery-11-0-4c-garment-orientation-floor-collision/tshirt-back.png)
- [Blouse front](../../artifacts/recovery-11-0-4c-garment-orientation-floor-collision/blouse-front.png), [side](../../artifacts/recovery-11-0-4c-garment-orientation-floor-collision/blouse-side.png), [back](../../artifacts/recovery-11-0-4c-garment-orientation-floor-collision/blouse-back.png)
- [Skirt front](../../artifacts/recovery-11-0-4c-garment-orientation-floor-collision/skirt-front.png), [side](../../artifacts/recovery-11-0-4c-garment-orientation-floor-collision/skirt-side.png), [back](../../artifacts/recovery-11-0-4c-garment-orientation-floor-collision/skirt-back.png)
- [Multipanel front](../../artifacts/recovery-11-0-4c-garment-orientation-floor-collision/multipanel-front.png), [side](../../artifacts/recovery-11-0-4c-garment-orientation-floor-collision/multipanel-side.png), [back](../../artifacts/recovery-11-0-4c-garment-orientation-floor-collision/multipanel-back.png)
- [Consolidated browser telemetry](../../artifacts/recovery-11-0-4c-garment-orientation-floor-collision/browser-report.json)

## D. Floor collision

Arquitetura:

- plano unilateral canônico `particleY >= floorY + halfThickness + floorContactSkin`;
- `floorY` é compartilhado pelo mesh visual e pelo solver físico;
- skin default de `0,2 mm`, validada como finita e pequena;
- CCD testa `previousPosition → predictedPosition` no mesmo substep;
- contato remove somente velocidade entrando no piso e não injeta restitution;
- atrito Coulomb usa impulso normal estimado pela velocidade incidente + carga gravitacional, nunca a distância da correção posicional;
- toggle de floor é independente de body collision;
- PatternDocumentV3, rest lengths, shear, bend e seams permanecem imutáveis.

Browser real com straight skirt, gravity 100%, body collision OFF, floor ON:

- floor visual: `-0,002 m`;
- floor físico: `-0,002 m`;
- menor Y renderizado: `-0,00159 m` (piso + espessura/skin);
- 803 floor contacts;
- 803 CCD contacts;
- 803 friction contacts;
- penetração máxima residual: `0 mm`;
- penetração média residual: `0 mm`;
- custo observado: aproximadamente `0,06 ms`;
- estado inválido: `false`.

Captura: [loose skirt resting on floor](../../artifacts/recovery-11-0-4c-garment-orientation-floor-collision/floor-skirt-resting.png).

## E. Testes

Verdes:

- `npm run typecheck`;
- `npm run build`;
- 70/70 testes diretamente afetados: domain assembly, SemanticAvatarArrangement, AssemblyWorkerClient, GarmentBodyRegistration, xpbdFloorCollision e XpbdWorkerClient;
- 13/13 testes de floor, incluindo particle, CCD rápido, half-thickness, patch/multipanel surrogate, fixture real de saia solta, friction zero/alta, reset, body OFF e coexistência body ON;
- teste focal `G5/G6 torso shell`: verde em `18,61 s`;
- browser completo: quatro fixtures + floor, sem console errors.

Regressão integral relevante: 100 testes passaram e quatro entradas falharam. Uma era apenas timeout por concorrência do `G5/G6` e passou isoladamente. Três falhas materiais são herdadas:

1. `xpbdMaterialIntegrity`: pence pareada com `maxError ≈ 38,68 mm`, gate `< 10 mm`;
2. `zeroEnergyInitialDressPose / dart-piece`: seam máxima `≈ 40,00 mm`, gate `< 0,5 mm`;
3. `zeroEnergyInitialDressPose / straight-skirt-standard`: stretch máximo `≈ 1,00732`, gate `< 1,001`.

Foi executado A/B restaurando `IsometricSurfaceAssembly.ts` exatamente ao blob do commit-base `88288e6ad910c92b802faab25faddd58f5002da0`. As mesmas três falhas e os mesmos valores permaneceram. Portanto não são regressões do 11.0.4C, mas contradizem o gate de preservação material/zero-energy exigido para avançar.

## F. Blocker visual herdado

Embora registration tenha corrigido frame, quiralidade e winding, as fixtures de T-shirt e blouse continuam chegando do assembly com deformação intrínseca alta:

- T-shirt: `maxRelativeDistortion ≈ 0,31748`, seam estrutural máxima `≈ 81,41 mm`;
- Blouse: `maxRelativeDistortion ≈ 0,18572`, seam estrutural máxima `≈ 6,54 mm`.

As capturas garment-only mostram que essa deformação já existe antes da transformação garment → body. O 11.0.4C não a mascara com escala, collision ou offsets especiais. Saia (`≈ 0,00733`) e tubo multipainel (`≈ 0,000022`) permanecem reconhecíveis e estáveis.

## G. Git e próximo passo

Não houve commit nem push porque o item 29 autoriza publicação apenas quando todos os gates passam. A branch também ainda não possui upstream.

Antes do Prompt 11.0.5 é necessário fechar o blocker herdado de zero-energy/pences e a deformação material de tops com manga, mantendo os invariantes de registration e floor desta etapa.

Conclusão: **NOT ready for Prompt 11.0.5**.
