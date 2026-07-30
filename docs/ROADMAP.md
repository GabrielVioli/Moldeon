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

## Marco 3: preparação 3D

- Triangulação de polígonos simples convexos e côncavos. ✅
- Frente, costas e peças múltiplas. ✅
- Costuras entre intervalos de borda.
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
