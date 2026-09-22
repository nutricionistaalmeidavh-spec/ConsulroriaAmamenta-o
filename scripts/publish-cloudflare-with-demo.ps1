$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Assert-Exit([string]$Step) { if ($LASTEXITCODE -ne 0) { throw "$Step falhou (exit $LASTEXITCODE). Publicacao interrompida." } }
function Read-PrivateValue([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secure.Dispose() }
}
$previousPassword = $env:DEMO_PASSWORD
$previousSecret = $env:LICENSE_SERVICE_SECRET
$NpmCmd = (Get-Command npm.cmd -ErrorAction Stop).Source
Push-Location (Join-Path $PSScriptRoot '..')
try {
  if ([string]::IsNullOrWhiteSpace($env:DEMO_PASSWORD)) { $env:DEMO_PASSWORD = Read-PrivateValue 'Senha para a conta demo (minimo 12 caracteres)' }
  if ($env:DEMO_PASSWORD.Length -lt 12) { throw 'A senha demo precisa de pelo menos 12 caracteres.' }
  if ([string]::IsNullOrWhiteSpace($env:LICENSE_SERVICE_SECRET)) { $env:LICENSE_SERVICE_SECRET = Read-PrivateValue 'LICENSE_SERVICE_SECRET existente da Central (nao crie outro valor)' }
  if ([string]::IsNullOrWhiteSpace($env:LICENSE_SERVICE_SECRET)) { throw 'Segredo de licenciamento ausente. Nenhuma publicacao realizada.' }

  if (Test-Path 'package-lock.json') { & $NpmCmd ci --no-audit --no-fund } else { & $NpmCmd install --no-audit --no-fund }
  Assert-Exit 'Instalacao'
  & $NpmCmd run test:auth-runtime; Assert-Exit 'Testes de autenticacao'
  & $NpmCmd run test:demo; Assert-Exit 'Testes da demo'
  & $NpmCmd run test:deploy-safety; Assert-Exit 'Contrato de publicacao'

  & $NpmCmd run deploy:production; Assert-Exit 'Deploy Cloudflare'
  # Idempotent fixture upsert restricted to the reserved demo identity; no reset.
  & $NpmCmd run demo:seed; Assert-Exit 'Criacao/atualizacao da demo'

  $body = @{email='demonstracao@deboralactacao.com';password=$env:DEMO_PASSWORD} | ConvertTo-Json -Compress
  try {
    $session = Invoke-RestMethod -Method Post -Uri 'https://deboralactacao.com/auth/v1/token?grant_type=password' -ContentType 'application/json' -Body $body -TimeoutSec 60
  } catch { throw 'Publicacao/seed executados, mas o login demo falhou. Nao considere a verificacao concluida.' }
  if (-not $session.access_token -or $session.user.id -ne '3e1a72f7-0c6e-4f47-b4d8-3b931fc8d001') { throw 'Login demo nao confirmou a identidade esperada.' }
  $headers = @{Authorization="Bearer $($session.access_token)"}
  $mothers = @(Invoke-RestMethod -Uri 'https://deboralactacao.com/rest/v1/mothers?select=id,owner_id' -Headers $headers -TimeoutSec 60)
  $babies = @(Invoke-RestMethod -Uri 'https://deboralactacao.com/rest/v1/babies?select=id,mother_id' -Headers $headers -TimeoutSec 60)
  if ($mothers.Count -lt 6 -or $babies.Count -lt 7) { throw 'Login funcionou, mas o conjunto demo esta incompleto.' }
  foreach ($mother in $mothers) { if ($mother.owner_id -ne $session.user.id) { throw 'Falha de isolamento da conta demo.' } }
  Write-Host 'PUBLICACAO E DEMO VERIFICADAS: login OK, pacientes e bebes disponiveis.' -ForegroundColor Green
  Write-Host 'A migracao da paciente real da Debora exige verificacao separada no D1.'
} finally {
  $body = $null; $session = $null; $headers = $null
  $env:DEMO_PASSWORD = $previousPassword
  $env:LICENSE_SERVICE_SECRET = $previousSecret
  Pop-Location
}
