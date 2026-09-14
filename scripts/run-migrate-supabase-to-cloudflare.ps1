param(
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$source = Join-Path $PSScriptRoot 'migrate-supabase-to-cloudflare.ps1'
if (-not (Test-Path $source)) {
  throw "Migrador ausente: $source"
}

$text = [IO.File]::ReadAllText($source)

# Corrige interpolação inválida de variável seguida de ':' no Windows PowerShell.
$old = '$failures.Add("$table: origem=$sourceCount destino=$targetCount")'
$new = '$failures.Add("${table}: origem=$sourceCount destino=$targetCount")'
if ($text.Contains($old)) {
  $text = $text.Replace($old, $new)
}

# Windows PowerShell 5.1 trata Range como cabeçalho restrito no Invoke-WebRequest.
# O PostgREST suporta paginação equivalente via query string limit/offset.
$text = [regex]::Replace($text, '(?m)^\s*\$headers\[''Range''\]\s*=.*\r?\n', '')
$text = [regex]::Replace($text, '(?m)^\s*\$headers\[''Prefer''\]\s*=\s*''count=exact''\s*\r?\n', '')
$oldUri = '$uri = "$BaseUrl/rest/v1/$([Uri]::EscapeDataString($Table))?select=*"'
$newUri = '$uri = "$BaseUrl/rest/v1/$([Uri]::EscapeDataString($Table))?select=*&limit=$pageSize&offset=$offset"'
if ($text.Contains($oldUri)) {
  $text = $text.Replace($oldUri, $newUri)
} elseif ($text -notmatch '\?select=\*.*limit=\$pageSize.*offset=\$offset') {
  throw 'Não foi possível adaptar a paginação do PostgREST para Windows PowerShell. Nenhuma migração foi iniciada.'
}

# Keep the corrected copy inside the repository's scripts directory so that
# $PSScriptRoot inside the migration script still resolves the repository root.
$temp = Join-Path $PSScriptRoot (".migrate-supabase-to-cloudflare.fixed-{0}.ps1" -f ([Guid]::NewGuid().ToString('N')))
[IO.File]::WriteAllText($temp, $text, (New-Object Text.UTF8Encoding($false)))

try {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($temp, [ref]$tokens, [ref]$errors) | Out-Null

  if (@($errors).Count -gt 0) {
    $details = @($errors | ForEach-Object { "linha $($_.Extent.StartLineNumber): $($_.Message)" }) -join "`n"
    throw "O migrador ainda possui erro(s) de sintaxe. Nenhuma migração foi iniciada.`n$details"
  }

  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $schemaPath = Join-Path $repoRoot 'cloudflare\full-migration-schema.sql'
  if (-not (Test-Path $schemaPath)) {
    throw "Schema de migração ausente no repositório: $schemaPath"
  }

  Write-Host 'Sintaxe do migrador validada.' -ForegroundColor Green
  Write-Host 'Paginação PostgREST compatível com Windows PowerShell validada.' -ForegroundColor Green
  Write-Host "Raiz do repositório validada: $repoRoot" -ForegroundColor DarkGreen

  $argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $temp)
  if ($Apply) { $argsList += '-Apply' }

  & powershell @argsList
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "Migrador encerrou com exit code $exitCode."
  }
} finally {
  Remove-Item -Force $temp -ErrorAction SilentlyContinue
}
