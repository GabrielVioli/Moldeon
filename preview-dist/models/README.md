# Modelos 3D de Avatar

Esta pasta contém os modelos GLB/GLTF usados para os avatares 3D do Moldeon.

## Requisitos dos Modelos

Os modelos GLB devem incluir:

1. **Morph Targets** para ajuste de medidas corporais:
   - `height`: Altura total do corpo
   - `bust`: Circunferência do busto/tórax
   - `waist`: Circunferência da cintura
   - `hip`: Circunferência do quadril
   - `shoulders`: Largura dos ombros
   - `torso`: Comprimento do tronco
   - `arms`: Comprimento dos braços
   - `legs`: Comprimento das pernas (entreperna)

2. **Escala**: O modelo deve estar em escala real (1 unidade = 1 metro)
3. **Posição**: O modelo deve estar centrado na origem (0, 0, 0)
4. **Orientação**: De frente para o eixo Z positivo
5. **Materiais**: PBR materials com roughness apropriado para pele
6. **Polígonos**: Otimize para performance web (idealmente < 50k polígonos)
7. **Texturas**: Opcionais, mas recomendadas para realismo

## Arquivos Esperados

- `avatar-feminine.glb`: Modelo feminino com morph targets
- `avatar-masculine.glb`: Modelo masculino com morph targets

## Como Obter Modelos

### Opções Gratuitas

1. **Mixamo** (Adobe): https://www.mixamo.com
   - Modeles 3D humanos gratuitos
   - Precisa de adaptação para morph targets

2. **Sketchfab**: https://sketchfab.com
   - Busque por "human base mesh" ou "mannequin"
   - Verifique licença para uso comercial

3. **Ready Player Me**: https://readyplayer.me
   - Avatares customizáveis
   - Exportação em GLB

### Opções Comerciais

1. **TurboSquid**: https://www.turbosquid.com
   - Modelos profissionais de alta qualidade
   - Verifique licença e requisitos de atribuição

2. **CGTrader**: https://www.cgtrader.com
   - Variedade de modelos humanos
   - Filtre por "rigged" e "low poly"

## Adicionando Morph Targets

Se você tiver um modelo sem morph targets, pode adicioná-los usando:

1. **Blender** (gratuito):
   - Importe o modelo GLB
   - Selecione o mesh
   - Em "Object Data Properties" → "Shape Keys"
   - Adicione shape keys para cada medida
   - Exporte como GLB

2. **Maya/3ds Max**:
   - Processo similar usando blend shapes

## Exemplo de Uso

O sistema carrega automaticamente o modelo baseado no tipo de corpo:

```typescript
// Feminino
/models/avatar-feminine.glb

// Masculino
/models/avatar-masculine.glb
```

Se o modelo não for encontrado, o sistema usa o fallback procedural (geometrias primitivas).

## Testando Modelos

Para testar um novo modelo:

1. Coloque o arquivo GLB nesta pasta
2. Reinicie o servidor de desenvolvimento
3. Abra o editor e selecione o tipo de corpo correspondente
4. Ajuste as medidas corporais no painel "Medidas"
5. Verifique se os morph targets respondem corretamente

## Troubleshooting

**Modelo não carrega:**
- Verifique se o arquivo está na pasta correta
- Verifique o console do navegador para erros
- Confirme que o arquivo é um GLB válido

**Morph targets não funcionam:**
- Verifique se os nomes dos morph targets correspondem ao esperado
- Use Blender para inspecionar os shape keys do modelo
- Verifique o console para avisos de morph targets não encontrados

**Modelo muito pesado:**
- Reduza a contagem de polígonos no Blender
- Comprima texturas
- Use draco compression se suportado
