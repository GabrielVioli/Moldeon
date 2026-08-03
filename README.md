# Moldeon

Fundação web para um software de modelagem de roupas com molde técnico 2D, visualização 3D e núcleo matemático em Rust/WebAssembly.

## O que esta entrega já faz

- Editor 2D em milímetros, com grade, zoom, pan e pontos arrastáveis.
- Interface móvel com abas, pan por toque e zoom por pinça.
- Biblioteca paramétrica com camiseta, blusa, saia, minissaia e calça; a jaqueta aparece como **Em desenvolvimento** até possuir bloco próprio validado.
- Geração por altura, busto/tórax, cintura e quadril explícitos.
- Avatar procedural feminino ou masculino com altura, busto/tórax, cintura,
  quadril, ombros, tronco, braço e entreperna.
- Sala de prova com tecidos leves, algodão, malha, jeans e couro sintético.
- Vários tecidos/retalhos no mesmo projeto, dimensões disponíveis, cor e
  atribuição por peça para criações upcycled.
- Projetos com frente, costas, manga, quantidade de corte e corte na dobra.
- Alternância entre peças, inserção/remoção de pontos e enquadramento automático.
- Cálculo de área, perímetro e validações equivalentes em Rust/WASM e TypeScript.
- Validação de pontos duplicados, autointerseções e contornos degenerados.
- Triangulação explícita de polígonos convexos e côncavos.
- Fallback em TypeScript, permitindo abrir o projeto mesmo sem compilar Rust.
- Viewport 3D sob demanda com Three.js, WebGPU e fallback WebGL 2 explícito.
- Fluxo principal em **Modelagem**, **Montagem** e **Prova**, com a prancheta 2D ocupando 75% da área nos dois primeiros modos.
- Costuras em duas etapas: seleção das bordas, análise de comprimentos, tratamento e confirmação explícita.
- Barra 2D orientada a intenções com Selecionar, Desenhar, Recortar, Pence, Costurar e Medir; a confirmação acontece junto ao molde, sem troca automática de tela.
- Seleção múltipla por Shift, `Ctrl+A` ou caixas da lista, com mover, girar, duplicar, espelhar e excluir peças desbloqueadas.
- Recorte reversível em duas peças, com opção de manter as novas bordas unidas, e pences de borda persistentes no documento.
- Grafo de montagem com componentes conectados, bordas abertas, alertas e elegibilidade determinística para o 3D.
- Placements estruturais, folgas da roupa e acabamentos de borda persistentes e cobertos por undo/redo.
- Manequim procedural proporcional às medidas, sem depender de arquivo 3D
  externo pesado.
- Conversão visual de todas as peças em painéis posicionados ao redor do manequim.
- Região, frente/costas e lado do corpo configuráveis por peça.
- Caimento visual rápido que responde à gramatura, espessura, elasticidade,
  rigidez e atrito do tecido.
- Margem de costura visível e exportação SVG com linhas de corte e costura em escala 1:1.
- Undo/redo transacional com limite de memória, atalhos de teclado e um único comando por gesto.
- Curvas Bézier cúbicas editáveis por alças, preservadas no SVG e amostradas com limite de custo para 3D.
- Contornos versionados por nós e segmentos persistentes, com seleção de borda, mover, converter reta/curva e dividir sem desconectar os nós vizinhos.
- Autosave local usando OPFS quando disponível.
- Cabeçalhos necessários para `SharedArrayBuffer` no Vite e exemplos de deploy.
- Estrutura inicial para solver XPBD em Web Worker.
- Infraestrutura opcional com PostgreSQL, Redis e MinIO.
- Template de API para Laravel 13.
- CI para TypeScript, testes, build, Rust, Clippy e rustfmt.

## Fluxo básico

1. Desenhe ou escolha um molde.
2. Ajuste as medidas.
3. Use **Recortar** e **Pence** quando necessário.
4. Aproxime as bordas e clique em **Costurar**.
5. Veja a roupa em 3D.
6. Use **Prova** quando quiser vestir no corpo.

## Desempenho

O carregamento inicial do editor fallback permanece em aproximadamente **239 KB**
de JavaScript minificado, ou **76 KB comprimidos**, mesmo com a biblioteca
paramétrica e a edição de múltiplas peças. A base anterior a essas otimizações
baixava cerca de 1,07 MB, ou 301 KB comprimidos.

- Three.js não entra no JavaScript inicial.
- Em qualquer tela, o 3D só é baixado depois de uma solicitação explícita e quando há ao menos duas peças trianguláveis ligadas por uma costura válida.
- WebGL 2 e os recursos comuns do Three.js formam o caminho 3D mais leve.
- O módulo adicional de WebGPU só é baixado quando a API está disponível.
- O Canvas 2D reutiliza o mesmo `ResizeObserver` e limita atualizações ao frame da tela.
- O viewport 3D renderiza sob demanda, em vez de manter 60 FPS sem alterações.
- Celulares usam DPR, geometria e iluminação reduzidos; sombras ficam desativadas.
- Sourcemaps de produção ficam desativados.

## O que ainda não é uma simulação profissional

O botão **Montar no 3D** desta versão executa uma prévia geométrica estrutural; **Vestir no corpo** abre a Prova separadamente.
Os presets já alteram aderência, volume e ondulação de forma aproximada, mas
ainda não calculam gravidade, autocolisão, franzido, elástico ou costuras
complexas. O solver XPBD inicial está isolado para ser desenvolvido e testado
sem contaminar o editor.

Isso é intencional: primeiro validamos editor, dados, triangulação, interação e pipeline 2D → 3D. Depois conectamos o solver físico.

## Dependências obrigatórias

1. Git.
2. Node.js 22.12 ou superior.
3. Rust estável, instalado por `rustup`.
4. Target WebAssembly do Rust.
5. `wasm-pack`.
6. Chrome ou Edge atualizado para a melhor experiência com WebGPU.

Para trabalhar somente com o frontend e fallback TypeScript, Rust e wasm-pack não são obrigatórios.

## Instalação rápida no Windows

Abra o PowerShell na pasta do projeto:

```powershell
npm install
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.13.1
npm run dev
```

Sem Rust:

```powershell
npm install
npm run dev:fallback
```

O endereço padrão será exibido pelo Vite, normalmente `http://localhost:5173`.

## Comandos

```powershell
npm run dev             # Compila WASM e abre o editor
npm run dev:fallback    # Abre sem WASM, usando TypeScript
npm run wasm:build      # Compila o núcleo Rust em release
npm run build           # Compila o frontend com fallback TypeScript
npm run build:wasm      # Compila WASM e frontend para produção
npm run build:web       # Alias do build de frontend com fallback
npm run typecheck       # Verificação TypeScript
npm run test            # Testes do frontend e solver inicial
```

O build de produção gera chunks separados para editor, Three.js comum e WebGPU. O chunk WebGPU é propositalmente opcional e não bloqueia a abertura do editor no celular.

## Backend opcional

A primeira versão funciona localmente sem servidor. Para contas, nuvem e compartilhamento:

```powershell
.\scripts\create-api.ps1
```

O script cria uma API Laravel 13 em `apps/api`, instala Sanctum e copia os arquivos-base de projetos.

Depois:

```powershell
docker compose up -d
cd apps/api
php artisan migrate
php artisan serve
```

## Estrutura

```text
apps/web/                 React, Vite, Canvas 2D e Three.js
crates/pattern-core/      Geometria e regras em Rust/WASM
apps/web/src/domain/      Esquemas e tipos compartilhados
apps/web/src/workers/     Base de simulação física
infrastructure/           Docker, Nginx e deploy
templates/laravel/        Arquivos copiados para a API Laravel
scripts/                  Instalação e diagnóstico no Windows
```

Leia também:

- `docs/ARCHITECTURE.md`
- `docs/DOMAIN_STUDY.md`
- `docs/PATTERN_LIBRARY.md`
- `docs/ROADMAP.md`
- `docs/INSTALL_WINDOWS.md`
- `docs/PHYSICS_PLAN.md`

## Limitações atuais

- Camiseta, blusa, saias e calça são bases paramétricas editáveis com fio, bordas semânticas e linhas construtivas; a jaqueta permanece indisponível enquanto não houver bloco próprio validado.
- As saias incluem pences persistentes de cintura. Transferência de pence, graduação, cós, vistas e aviamentos ainda não foram implementados.
- A inserção de ponto acontece em um contorno existente; a criação livre de novas peças e a prancheta multi-peça agora entram como fluxo principal do editor.
- A margem de costura usa offset com limite de miter. Contornos côncavos extremos ainda precisarão de operações booleanas robustas.
- A transformação 2D → 3D é uma prévia geométrica, não uma simulação física.
- O consumo de tecido é uma estimativa por área; ainda não considera encaixe,
  sentido do fio ou aproveitamento automático dos retalhos.
- O recorte atual aceita uma linha reta com exatamente duas interseções. Contornos curvos são amostrados no ponto do corte; operações booleanas curvas de alta precisão continuam planejadas.
- Um tecido pode ser atribuído por peça. O recorte cria painéis independentes, mas ainda não há encaixe de patchwork ou materiais diferentes dentro da mesma peça.
- O Worker XPBD ainda não alimenta a malha do Three.js.
- O backend Laravel continua opcional e não é necessário para usar o editor.

## Próxima etapa recomendada

Ampliar a montagem estrutural e sua validação antes de conectar física XPBD, autocolisão ou alegações de caimento físico ao viewport.
