# Roadmap

## Marco 1: fundação entregue

- Editor 2D funcional.
- Viewport 3D.
- Rust/WASM com fallback.
- Preview de vestir.
- SVG e autosave.

## Marco 2: CAD 2D útil

- Inserção e remoção de pontos no contorno. ✅
- Criação livre de linhas e peças.
- Curvas Bézier cúbicas em segmentos existentes. ✅
- Réguas e guias.
- Snap e restrições geométricas.
- Pence.
- Espelhamento.
- Margem de costura básica com offset e exportação SVG. ✅
- Piques e fio do tecido.
- Undo/redo por Command Pattern. ✅
- PDF A4 em escala 1:1.

## Atualizações recentes

- Interface reorganizada nos modos Modelagem, Montagem e Prova; o corpo visível ficou restrito à Prova.
- Elegibilidade pura impede a prévia de uma peça solta e adia o bundle Three.js até pedido explícito.
- Costuras agora passam por proposta, análise de compatibilidade, direção e tratamento antes da confirmação.
- Grafo de montagem, placements por peça, folgas e acabamentos foram incorporados ao documento e ao histórico.
- Corpo anatômico procedural compartilhado ganhou medidas complementares derivadas, landmarks e malha leve validada.

- Implementado snap no editor 2D (pontos, grade, alinhamento horizontal/vertical, pontos médios) com feedback visual.
- Réguas horizontal/vertical e guias arrastáveis adicionadas ao editor; guias são persistidas no documento.
- Introduzida semântica de arestas e ranges (`EdgeRange`, `Seam`) e a ferramenta de costura para relacionar duas arestas, visualizar comprimentos e diferença, alternar direção e salvar `seams[]` no projeto.
- A prancheta 2D passou a trabalhar com várias peças ao mesmo tempo, com transformações independentes de posição na mesa de modelagem, seleção de peça, duplicação, espelhamento, criação de peça em branco e edição numérica básica de segmentos retos.
- A barra principal foi reduzida às seis intenções essenciais e cada fluxo ganhou confirmação contextual na base da prancheta; selecionar, zoom, pan e edição por duplo clique permanecem disponíveis durante ferramentas temporárias.
- Seleção múltipla, medição em centímetros, recorte reto reversível, linhas internas no domínio e pences de borda persistentes foram incorporados ao documento e ao histórico.

Essas mudanças preservam compatibilidade com projetos existentes: campos novos são opcionais e o autosave e restore continuam funcionando como antes.

## Marco 3: preparação 3D

- Triangulação de polígonos simples convexos e côncavos. ✅
- Frente, costas e peças múltiplas. ✅
- Costuras entre intervalos de borda. ✅
- Montagem progressiva por componentes conectados e atualização incremental das peças afetadas. ✅
- Inspeção montada/explodida sem reiniciar câmera ou controles. ✅
- Posicionamento geométrico inicial dos painéis ao redor do avatar. ✅
- Escolha editável de região, face e lado do corpo por peça. ✅
- Avatar procedural feminino/masculino guiado por oito medidas reais. ✅
- Fontes de tecido múltiplas e atribuição por peça para upcycling. ✅
- Avatar GLB com morph targets.

## Marco 4: XPBD utilizável

- Gravidade e integração.
- Alongamento warp/weft.
- Cisalhamento.
- Flexão.
- Costuras.
- Colisão com avatar.
- Visualização de tensão.

## Marco 5: física avançada

- Autocolisão.
- Espessura.
- Atrito.
- Elástico.
- Franzido.
- Zíper.
- Botões e pontos de fixação.
- Compute shaders WebGPU.

## Marco 6: produto

- Laravel + Sanctum.
- Versionamento na nuvem.
- Compartilhamento.
- Biblioteca paramétrica dos seis moldes essenciais. ✅
- Biblioteca inicial de tecidos, cores e inventário de retalhos. ✅
- Biblioteca ampliada e importação de tecidos medidos.
- Assinaturas.
- DXF e glTF.
- Render de alta qualidade em serviço GPU opcional.
