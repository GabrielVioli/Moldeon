# Avatar humano e montagem semântica

> **Nota de arquitetura (Prompt 10.6):** este documento preserva o histórico do arranjo/avatar da Fase 9.5-07. A partir do 10.6, a solução final de pose relativa entre `PanelInstanceV3` é definida por `docs/ASSEMBLY_ARCHITECTURE.md`. Anchors anatômicos e mappings descritos abaixo podem fornecer contexto/seed, mas não substituem o `GarmentSpatialConstraintGraph` nem o global rigid-pose solve.

## Estado do gate 9.5-07

A montagem estática usa geometria 2D atual, classificação corporal explícita e anchors paramétricos. Não há asset GLB/glTF aprovado no repositório. Portanto o avatar visual final não está configurado e a interface informa:

> Manequim humano ainda não configurado.

O boneco procedural de esferas/cápsulas não é importado pelo caminho público. Nenhum modelo externo foi baixado ou escolhido automaticamente. O gate permanece pendente de validação visual quando o usuário fornecer um asset aprovado.

## Separação obrigatória

1. `AvatarParametricModel`: medidas, landmarks, joints, regiões, pose e anchors em metros.
2. `ApprovedAvatarAsset`/`ApprovedAvatarLoader`: descritor, GLB/glTF aprovado, inspeção, calibração e lifecycle visual.
3. `AvatarCollisionModel`: proxies simplificados internos, invisíveis por padrão.
4. `SemanticAvatarArrangement`: posicionamento estático das instâncias confirmadas.

O GLB visual não se torna fonte das medidas. Anchors e proxies continuam derivados do modelo paramétrico e precisam ser calibrados para o mesmo sistema do asset aprovado.

## Contrato do asset aprovado

Cada descritor registra:

- `assetId`, URL/origem e perfil corporal disponível;
- unidade de origem e escala explícita para metros;
- eixos vertical e frontal;
- offset do piso e transform raiz;
- versão, licença e autor/atribuição.

O loader usa `GLTFLoader`, fetch cancelável e inspeciona scene/nodes, skins, skeleton/bones, morph targets, materiais, texturas e bounding box. Nomes de bones não são codificados antes dessa inspeção. Trocar perfil cancela carregamento anterior e mantém somente um root visual.

## Anchors

Cada anchor contém ID estável, posição, outward normal, eixo, tangente e margem inicial. Catálogo atual:

```text
torso-front      torso-back
shoulder-left    shoulder-right
arm-left         arm-right
waist-front      waist-back
hip-front        hip-back
hip-left         hip-right
leg-left         leg-right
neck             head (interno)
```

O usuário escolhe um rótulo compreensível em **Posição no corpo**. O documento guarda o ID técnico. Uma peça personalizada pode usar qualquer anchor coerente sem possuir conectores de camiseta ou calça.

## Arrangement estático

`ResolvedAssemblyInput` contém apenas `PanelInstanceV3` confirmadas e incluídas. Para cada instância, o arrangement:

- resolve exatamente o `bodyAnchorId` confirmado;
- preserva dimensão física (`scale = 1`);
- aplica lado, superfície, outward normal, eixo, margem, offsets e rotação;
- posiciona torso/quadril por superfície corporal e braços/pernas por eixos locais;
- não usa nome, template, geometria ou transform da bancada para descobrir semântica.

Conectores enriquecem costura e alinhamento, mas não são pré-requisito para posicionar uma peça custom.

## Proxies de colisão

`AvatarCollisionModel` produz elipsoides e cápsulas finitos e alinhados ao modelo paramétrico. Eles não são adicionados à scene pública e não alegam colisão/física nesta etapa. Uma visualização futura só pode existir sob flag DEBUG explícita.

## Lifecycle e reconciliação

Meshes usam `PanelInstance.id` + assinatura da geometria fonte. Geometria igual pode reutilizar mesh; geometria alterada recria/atualiza; instância removida é descartada. Câmera, controles, iluminação e avatar não são recriados em edição de roupa.

Ao fechar, o viewport cancela RAF e carregamento, desconecta `ResizeObserver`, remove listeners, descarta `OrbitControls`, garment/GLTF, geometrias, materiais, texturas, listas/contexto e renderer, e remove o canvas. A auditoria automatizada de 20 ciclos retornou canvases, RAFs e observers ao baseline sem erros de console.

## Limitações

- Asset humano visual aprovado ausente; não há validação de pose, aparência, licença ou alinhamento visual final.
- Não há XPBD, gravidade, colisão de tecido, autocolisão ou física de pence/prega.
- Proxies são somente contrato para etapa futura.
- WebGPU é opcional; WebGL 2 é o fallback validado nesta branch.
