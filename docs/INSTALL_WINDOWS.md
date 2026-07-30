# Instalação no Windows

## 1. Programas necessários

### Essenciais

- Git for Windows.
- Node.js 22.12 ou superior.
- Rustup com Rust estável.
- wasm-pack.
- Chrome ou Edge atualizado.

### Para o backend

- PHP 8.3, 8.4 ou 8.5.
- Composer 2.
- Docker Desktop.

### Recomendados

- Visual Studio Code.
- Extensões: rust-analyzer, ESLint, Even Better TOML e Docker.
- Blender para criar ou ajustar avatares GLB no futuro.

## 2. Verificar o ambiente

```powershell
.\scripts\check-env.ps1
```

## 3. Instalar frontend

```powershell
npm install
```

## 4. Preparar Rust e WebAssembly

```powershell
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.13.1
```

Caso `cargo install wasm-pack` informe que já está instalado, use:

```powershell
cargo install wasm-pack --force
```

## 5. Executar

```powershell
npm run dev
```

## 6. Executar sem Rust

```powershell
npm run dev:fallback
```

O editor mostrará `TypeScript fallback` na barra inferior. Todo o visual funciona, mas os cálculos não usam WebAssembly.

## 7. Infraestrutura de nuvem local

```powershell
docker compose up -d
```

Serviços:

- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- MinIO API: `localhost:9000`
- MinIO Console: `localhost:9001`

Credenciais de desenvolvimento estão no `docker-compose.yml`. Troque-as antes de publicar qualquer ambiente.
