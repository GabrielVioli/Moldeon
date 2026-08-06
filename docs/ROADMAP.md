# Roadmap

## Fase 0: baseline técnico concluído

- Ambiente e comandos registrados em `docs/BASELINE_2026.md`. ✅
- Fixtures determinísticas para templates, curvas, pences, costuras, tecidos e legado. ✅
- Auditoria de Chromium desktop e mobile. ✅
- Bundle fallback e WASM medido. ✅
- Problemas do editor, 3D, lifecycle e responsividade reproduzidos sem correções fora de escopo. ✅

## Fase 1: domínio e formato de projeto

- `PatternDocumentV3` como formato raiz versionado. ✅
- Milímetros como unidade autoritativa. ✅
- Separação entre `PatternDefinitionV3` e `PanelInstanceV3`. ✅
- Instâncias determinísticas por quantidade de corte. ✅
- Conectores semânticos por intervalos de borda. ✅
- `SeamGroupV3` com múltiplos intervalos, direção, tratamento, distribuição, proporção, slack e estado ativo. ✅
- Migrações sequenciais legado → V2 → V3. ✅
- Backup recuperável antes da migração de autosave. ✅
- Importação e exportação portátil V3 no domínio. ✅
- Projeção temporária para `GarmentDraft` com rejeição de perda. ✅
- Round trip de curvas, costuras parciais, pences, linhas internas, tecidos, medidas e bancada. ✅
- Documento de contrato em `docs/PATTERN_DOCUMENT_V3.md`. ✅

Compatibilidades temporárias ainda ativas:

- `GarmentDraft` continua sendo o estado consumido pela interface.
- `PatternPiece.points` continua sincronizado com nós e segmentos.
- `Seam` simples continua sendo consumido pela montagem atual.
- `previewPlacements` e `AssemblyPlacement` continuam projetados a partir de instâncias.
- O Rust/WASM ainda recebe `PatternPiece`, não o documento raiz V3.

## Próxima fase: núcleo geométrico e editor confiável

Prioridades permitidas após a estabilização do V3:

- Fazer Zustand e comandos operarem sobre o documento canônico.
- Remover inferências semânticas por nome nos consumidores restantes.
- Corrigir criação e inserção de pontos com IDs topológicos estáveis.
- Separar câmera, hit testing, ferramentas e renderização do `PatternCanvas` monolítico.
- Fazer transformações da bancada usarem somente `workspace.patterns`.
- Preservar conectores e intervalos durante divisão, corte e edição de segmentos.

A próxima fase não deve introduzir física antes de a edição 2D preservar corretamente as referências topológicas.

## Marco: CAD 2D útil

- Inserção e remoção de pontos no contorno.
- Criação livre de linhas e peças.
- Curvas Bézier cúbicas em segmentos existentes. ✅
- Réguas e guias. ✅
- Snap e restrições geométricas. ✅
- Pence persistente. ✅
- Espelhamento. ✅
- Margem de costura básica com offset e exportação SVG. ✅
- Piques e landmarks semânticos.
- Undo/redo por comandos transacionais. ✅
- PDF A4 em escala 1:1.
- Importação e exportação visual de arquivos `.moldeon`.

## Marco: preparação 3D

- Triangulação de polígonos simples convexos e côncavos. ✅
- Frente, costas e peças múltiplas. ✅
- PatternDefinition separado de instância física. ✅
- Costuras entre múltiplos intervalos representadas no domínio. ✅
- Montagem progressiva por componentes conectados.
- Inspeção montada e explodida sem reiniciar câmera ou controles.
- Posicionamento inicial por `PanelInstanceV3.arrangementAnchor`.
- Avatar procedural feminino e masculino guiado por medidas reais.
- Fontes de tecido múltiplas e atribuição por instância. ✅ no domínio
- Avatar GLB com morph targets.
- Duas definições de calça gerando quatro instâncias físicas. ✅ no domínio
- Uma definição de manga gerando instâncias esquerda e direita. ✅ no domínio

## Marco: XPBD utilizável

- Gravidade e integração.
- Alongamento warp/weft.
- Cisalhamento.
- Flexão.
- `SeamGroupV3` convertido em constraints.
- Colisão com avatar.
- Visualização de tensão.
- Worker alimentando buffers da malha sem React por partícula.

## Marco: física avançada

- Autocolisão.
- Espessura.
- Atrito.
- Elástico.
- Franzido.
- Zíper.
- Botões e pontos de fixação.
- Compute shaders WebGPU.

## Marco: produto

- Laravel + Sanctum.
- Versionamento na nuvem.
- Compartilhamento.
- Biblioteca paramétrica dos moldes essenciais.
- Biblioteca ampliada e importação de tecidos medidos.
- Assinaturas.
- DXF e glTF.
- Render de alta qualidade em serviço GPU opcional.

## Regra de avanço

Cada fase deve terminar com:

- testes unitários e de migração;
- typecheck;
- build fallback e WASM;
- Rust, rustfmt e Clippy;
- inspeção funcional e visual;
- documento de progresso;
- compatibilidades temporárias listadas objetivamente.

## Prompt 9 concluído: manequim vestido

- [x] separar avatar paramétrico, visual e proxies de colisão;
- [x] anchors de torso, ombros, braços, cintura, quadril, pernas, pescoço e cabeça;
- [x] remover corpo ocultável, modo explodido e roupa isolada;
- [x] remover inicialização cilíndrica global e inferência por nome;
- [x] vestir camiseta, saia, calça e mangas por placements semânticos;
- [x] omitir instâncias inválidas e emitir diagnósticos;
- [x] validar desktop e mobile em navegador.

### Próximo ciclo físico

- integrar proxies ao solver XPBD;
- gravidade, colisão e estabilização temporal;
- constraints de costura com distribuição de folga;
- autocolisão e camadas em fases posteriores;
- não regredir para roupa isolada ou modos de inspeção explodidos.

