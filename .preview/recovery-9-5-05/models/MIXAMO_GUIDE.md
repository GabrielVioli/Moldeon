# Guia: Implementando Modelo do Mixamo no Moldeon

## Visão Geral

O Mixamo fornece modelos 3D humanos gratuitos, mas eles não têm morph targets nativos para medidas corporais. Você precisará adicionar os morph targets manualmente no Blender.

## Passo 1: Baixar Modelo do Mixamo

1. Acesse https://www.mixamo.com
2. Faça login com conta Adobe (gratuita)
3. Navegue para "Characters"
4. Escolha um modelo apropriado:
   - Para feminino: Busque por "female" ou "woman"
   - Para masculino: Busque por "male" ou "man"
   - Recomendação: Escolha modelos "X Bot" ou "Y Bot" que são mais simples

5. Clique no modelo desejado
6. Clique em "Download" (seta para baixo)
7. Configure o download:
   - **Format**: FBX
   - **Skin**: Without Skin (reduz tamanho)
   - **Pose**: T-Pose ou A-Pose
   - **Mesh Resolution**: High (para melhor qualidade)
8. Clique em "Download"

## Passo 2: Preparar o Blender

1. Baixe e instale o Blender: https://www.blender.org/download/
2. Abra o Blender
3. Vá em `Edit → Preferences → Add-ons`
4. Habilite "Import-Export: FBX format" se não estiver ativo

## Passo 3: Importar Modelo no Blender

1. No Blender, `File → Import → FBX (.fbx)`
2. Selecione o arquivo baixado do Mixamo
3. Clique "Import FBX"

## Passo 4: Limpar e Preparar o Modelo

1. **Remover rig desnecessário** (opcional, reduz tamanho):
   - Selecione a armature (esqueleto)
   - Delete (X) → Delete
   - Isso remove a animação mas reduz significativamente o tamanho

2. **Ajustar escala e posição**:
   - Selecione o mesh
   - Pressione `N` para abrir o painel de propriedades
   - Verifique as dimensões em "Item" → "Dimensions"
   - Ajuste para que o modelo tenha aproximadamente 1.68m de altura
   - Posicione o modelo na origem (0, 0, 0)
   - Rote para frente para o eixo Z positivo

3. **Aplicar transformações**:
   - Selecione o mesh
   - `Ctrl + A` → "Apply Scale"
   - `Ctrl + A` → "Apply Rotation"

## Passo 5: Adicionar Morph Targets

### 5.1. Configurar Shape Keys

1. Selecione o mesh
2. Vá para "Object Data Properties" (ícone verde, esquerda)
3. Encontre a seção "Shape Keys"
4. Clique no `+` para adicionar uma "Basis" key (já deve existir)

### 5.2. Criar Morph Target para Altura

1. Clique no `+` → "New Shape Key"
2. Renomeie para "height"
3. Clique no ícone de olho para entrar no modo de edição
4. Selecione todos os vértices (`A`)
5. Pressione `S` para escalar
6. Arraste para cima para aumentar altura (ou para baixo para diminuir)
7. Crie uma variação moderada (~10% de aumento)
8. Tab para sair do modo de edição

### 5.3. Criar Morph Target para Busto/Tórax

1. Clique no `+` → "New Shape Key"
2. Renomeie para "bust"
3. Entre no modo de edição
4. Selecione vértices do busto/tórax (use seleção por anel `Alt + Click` nas arestas)
5. Pressione `S` e arraste para fora para aumentar
6. Crie uma variação moderada (~15% de aumento)
7. Tab para sair

### 5.4. Criar Morph Target para Cintura

1. Clique no `+` → "New Shape Key"
2. Renomeie para "waist"
3. Entre no modo de edição
4. Selecione vértices da cintura
5. Pressione `S` e arraste para dentro/out
6. Crie variação (~15% de aumento)
7. Tab para sair

### 5.5. Criar Morph Target para Quadril

1. Clique no `+` → "New Shape Key"
2. Renomeie para "hip"
3. Entre no modo de edição
4. Selecione vértices do quadril
5. Pressione `S` e arraste para fora
6. Crie variação (~15% de aumento)
7. Tab para sair

### 5.6. Criar Morph Target para Ombros

1. Clique no `+` → "New Shape Key"
2. Renomeie para "shoulders"
3. Entre no modo de edição
4. Selecione vértices dos ombros
5. Pressione `S` no eixo X para alargar
6. Crie variação (~10% de aumento)
7. Tab para sair

### 5.7. Criar Morph Target para Tronco

1. Clique no `+` → "New Shape Key"
2. Renomeie para "torso"
3. Entre no modo de edição
4. Selecione vértices do tronco (excluindo pescoço e quadril)
5. Pressione `S` no eixo Z para alongar/encurtar
6. Crie variação (~10% de aumento)
7. Tab para sair

### 5.8. Criar Morph Target para Braços

1. Clique no `+` → "New Shape Key"
2. Renomeie para "arms"
3. Entre no modo de edição
4. Selecione vértices dos braços
5. Pressione `S` no eixo Z para alongar
6. Crie variação (~10% de aumento)
7. Tab para sair

### 5.9. Criar Morph Target para Pernas

1. Clique no `+` → "New Shape Key"
2. Renomeie para "legs"
3. Entre no modo de edição
4. Selecione vértices das pernas
5. Pressione `S` no eixo Z para alongar
6. Crie variação (~10% de aumento)
7. Tab para sair

## Passo 6: Testar Morph Targets

1. No painel "Shape Keys", arraste os sliders para testar cada morph target
2. Verifique se as deformações são suaves e realistas
3. Ajuste se necessário voltando ao modo de edição

## Passo 7: Configurar Material

1. Vá para "Material Properties" (ícone vermelho esfera)
2. Clique `+` para criar novo material
3. Configure:
   - **Base Color`: Cor de pele (ex: #c3aa9a para feminino, #b8a08f para masculino)
   - **Metallic**: 0
   - **Roughness**: 0.94 (para aparência de pele)
4. Atribua o material ao mesh

## Passo 8: Exportar como GLB

1. `File → Export → glTF 2.0 (.glb/.gltf)`
2. Configure:
   - **Format**: glTF Binary (.glb)
   - **Include**: Selected Objects
   - **Mesh**: Apply Modifiers
   - **Shape Keys**: Include (importante!)
3. Clique "Export glTF 2.0"

## Passo 9: Integrar no Projeto

1. Copie o arquivo `.glb` para:
   - `apps/web/public/models/avatar-feminine.glb` (para modelo feminino)
   - `apps/web/public/models/avatar-masculine.glb` (para modelo masculino)

2. Reinicie o servidor de desenvolvimento:
   ```powershell
   npm run dev:fallback
   ```

3. Abra o editor e teste:
   - Selecione o tipo de corpo correspondente
   - Ajuste as medidas no painel "Medidas"
   - Verifique se o avatar carrega e os morph targets funcionam

## Dicas Importantes

### Performance

- Mantenha o modelo abaixo de 50k polígonos
- Remova texturas desnecessárias
- Use draco compression se precisar reduzir tamanho

### Morph Targets

- Crie variações moderadas (10-20%)
- Evite deformações extremas que causam artefatos
- Teste combinações de morph targets

### Troubleshooting

**Modelo não aparece:**
- Verifique o console do navegador para erros
- Confirme que o arquivo está na pasta correta
- Verifique permissões do arquivo

**Morph targets não funcionam:**
- Verifique se "Include Shape Keys" estava marcado na exportação
- Use Blender para reabrir o GLB e verificar os shape keys
- Verifique os nomes dos morph targets (devem ser: height, bust, waist, hip, shoulders, torso, arms, legs)

**Modelo muito grande:**
- Remova o rig/armature
- Reduza polígonos com "Decimate Modifier"
- Comprima texturas

## Alternativa: Usar Modelo Sem Morph Targets

Se não quiser adicionar morph targets manualmente, o sistema usará automaticamente o fallback procedural. O modelo GLB ainda será carregado, mas não responderá às medidas corporais.

Para isso, basta exportar o modelo sem shape keys e o sistema funcionará com a geometria estática.
