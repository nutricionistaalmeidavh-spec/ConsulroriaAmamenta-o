param(
  [Parameter(Mandatory=$true)][string]$DeboraWranglerConfig
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "Comando obrigatório não encontrado: $Name" }
}
function Assert-Exit([string]$Label) { if ($LASTEXITCODE -ne 0) { throw "$Label falhou (exit $LASTEXITCODE)." } }
function Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Set-VersionedSecret([string]$NpxCmd,[string]$Name,[string]$Value,[string]$Config,[switch]$LocalWrangler) {
  $old = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    if ($LocalWrangler) { $out = ($Value | & $NpxCmd wrangler versions secret put $Name --config $Config 2>&1 | Out-String) }
    else { $out = ($Value | & $NpxCmd --yes wrangler@4 versions secret put $Name --config $Config 2>&1 | Out-String) }
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $old }
  if ($code -ne 0) { throw "Configuração do secret $Name falhou.`n$out" }
}

Require-Command git
Require-Command node
Require-Command npm.cmd
Require-Command npx.cmd
$NpmCmd=(Get-Command npm.cmd -ErrorAction Stop).Source
$NpxCmd=(Get-Command npx.cmd -ErrorAction Stop).Source
$CentralRoot=Join-Path $env:TEMP 'artisys-central-license-cutover'
$CentralWeb=Join-Path $CentralRoot 'apps\web'
$CentralRepo='https://github.com/nutricionistaalmeidavh-spec/OBRANAMAOCOMERCIAL.git'

if(Test-Path (Join-Path $CentralRoot '.git')){
  & git -C $CentralRoot fetch origin main; Assert-Exit 'git fetch Central'
  & git -C $CentralRoot checkout main; Assert-Exit 'checkout Central'
  & git -C $CentralRoot reset --hard origin/main; Assert-Exit 'reset Central'
}else{
  if(Test-Path $CentralRoot){Remove-Item -Recurse -Force $CentralRoot}
  & git clone --depth 1 --branch main $CentralRepo $CentralRoot; Assert-Exit 'clone Central'
}
if(-not(Test-Path $DeboraWranglerConfig)){throw "Config da Débora ausente: $DeboraWranglerConfig"}
if(-not(Test-Path (Join-Path $CentralWeb 'wrangler.jsonc'))){throw 'Config da Central ausente.'}

$bytes=New-Object byte[] 48
$rng=[System.Security.Cryptography.RandomNumberGenerator]::Create()
try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
$SharedSecret=[Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')

try{
  Step 'Validando a Central Artisys antes de sincronizar o licenciamento'
  Push-Location $CentralWeb
  try{
    & $NpmCmd ci --no-audit --no-fund; Assert-Exit 'npm ci Central'
    & $NpxCmd vitest run backend/product-license-service.test.ts backend/debora-license-admin.test.ts src/owner-auth-contract.test.ts; Assert-Exit 'testes licença Central'
    & $NpmCmd run build; Assert-Exit 'build Central'

    Step 'Sincronizando segredo de licenciamento na Central'
    Set-VersionedSecret -NpxCmd $NpxCmd -Name 'LICENSE_SERVICE_SECRET' -Value $SharedSecret -Config 'wrangler.jsonc' -LocalWrangler
    & $NpxCmd wrangler deploy --config wrangler.jsonc; Assert-Exit 'deploy Central'
  }finally{Pop-Location}

  Step 'Confirmando autoridade de licenças após rotação'
  $headers=@{'x-artisys-license-secret'=$SharedSecret;'content-type'='application/json'}
  $body=@{action='resolve';productCode='debora-lactacao';email='license-cutover-probe@artisys.invalid'}|ConvertTo-Json -Compress
  $probe=Invoke-RestMethod -Method Post -Uri 'https://obra-na-mao-comercial.nutricionistaalmeidavh.workers.dev/api/internal/product-license' -Headers $headers -Body $body
  if($probe.planCode -ne 'legacy_unmanaged' -or $probe.commercial -ne $false){throw 'Central Artisys não confirmou legacy_unmanaged no probe.'}

  Step 'Sincronizando o mesmo segredo no Worker da Débora'
  Set-VersionedSecret -NpxCmd $NpxCmd -Name 'LICENSE_SERVICE_SECRET' -Value $SharedSecret -Config $DeboraWranglerConfig
  Write-Host 'Segredo compartilhado sincronizado sem exibir o valor.' -ForegroundColor Green
}finally{
  $SharedSecret=$null
  [GC]::Collect()
}
