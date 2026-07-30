# Moreóris Studio

Fundação web para um software de modelagem de roupas com molde técnico 2D, visualização 3D e núcleo matemático em Rust/WebAssembly.

## O que esta entrega já faz

- Editor 2D em milímetros, com grade, zoom, pan e pontos arrastáveis.
- Molde-base de saia paramétrico como peça inicial.
- Cálculo de área, perímetro e validações no núcleo Rust/WASM.
- Fallback em TypeScript, permitindo abrir o projeto mesmo sem compilar Rust.
- Viewport 3D com Three.js e `WebGPURenderer`, com fallback automático para WebGL 2.
- Manequim procedural, sem depender de arquivo 3D externo.
- Conversão visual do molde plano em painel curvado sobre o manequim.
- Exportação do molde para SVG em escala vetorial.
- Autosave local usando OPFS quando disponível.
- Cabeçalhos necessários para `SharedArrayBuffer` no Vite e exemplos de deploy.
- Estrutura inicial para solver XPBD em Web Worker.
- Infraestrutura opcional com PostgreSQL, Redis e MinIO.
- Template de API para Laravel 13.

## O que ainda não é uma simulação profissional

O botão **Vestir no 3D** desta versão executa uma prévia geométrica animada. Ele ainda não calcula tecido real, autocolisão, atrito, franzido, elástico ou costuras complexas. O solver XPBD inicial está isolado para ser desenvolvido e testado sem contaminar o editor.

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
- `docs/ROADMAP.md`
- `docs/INSTALL_WINDOWS.md`
- `docs/PHYSICS_PLAN.md`
