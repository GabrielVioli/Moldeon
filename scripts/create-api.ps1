$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$apiPath = Join-Path $root "apps/api"
$templatePath = Join-Path $root "templates/laravel"

if (Test-Path $apiPath) {
    throw "A pasta apps/api já existe. Remova ou renomeie antes de executar este script."
}

composer create-project laravel/laravel $apiPath "^13.0"
Set-Location $apiPath

php artisan install:api

Copy-Item (Join-Path $templatePath "app/Models/Project.php") "app/Models/Project.php" -Force
Copy-Item (Join-Path $templatePath "app/Http/Controllers/ProjectController.php") "app/Http/Controllers/ProjectController.php" -Force
Copy-Item (Join-Path $templatePath "app/Http/Requests/StoreProjectRequest.php") "app/Http/Requests/StoreProjectRequest.php" -Force
Copy-Item (Join-Path $templatePath "database/migrations/2026_07_30_000000_create_projects_table.php") "database/migrations/2026_07_30_000000_create_projects_table.php" -Force
Copy-Item (Join-Path $templatePath "routes/api.php") "routes/api.php" -Force
Copy-Item (Join-Path $templatePath ".env.moreoris.example") ".env.moreoris.example" -Force

Write-Host ""
Write-Host "API criada em apps/api." -ForegroundColor Green
Write-Host "Copie as variáveis de .env.moreoris.example para .env, execute docker compose up -d e php artisan migrate."
