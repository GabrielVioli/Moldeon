$ErrorActionPreference = "Continue"

function Check-Command($name, $versionArgs = @("--version")) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $command) {
        Write-Host "[FALTA] $name" -ForegroundColor Red
        return
    }

    $version = & $name @versionArgs 2>&1 | Select-Object -First 1
    Write-Host "[OK] $name - $version" -ForegroundColor Green
}

Check-Command "git"
Check-Command "node"
Check-Command "npm"
Check-Command "rustc"
Check-Command "cargo"
Check-Command "wasm-pack"
Check-Command "php"
Check-Command "composer"
Check-Command "docker"

Write-Host ""
Write-Host "Obrigatório para o editor completo: Git, Node, npm, Rust, Cargo e wasm-pack."
Write-Host "PHP, Composer e Docker são necessários somente para a API e nuvem local."
