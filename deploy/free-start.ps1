#Requires -Version 5
<#
  Tambola - free, no-card local deployment.

  Starts ONE Docker container (the app) and a Cloudflare Quick Tunnel that gives
  it a public HTTPS URL. Zero cost, no payment card, no paid hosting.

  HONEST LIMITS:
    * Only reachable while THIS PC is on and cloudflared keeps running.
    * The trycloudflare.com URL is TEMPORARY and changes every time the tunnel
      restarts. It is not a permanent or production address.

  SECRETS: never hardcoded. Read from (in priority order):
    * $env:TAMBOLA_PROD_DATABASE_URL  (full connection string), else
      $env:TAMBOLA_DB_PASSWORD or $env:TEMP\tambola_dbpw.txt to build it.
    * OWNER_MFA_KEY from the repo .env (or $env:OWNER_MFA_KEY).

  Usage:  .\deploy\free-start.ps1   [-SkipBuild] [-Port 4000]
#>
[CmdletBinding()]
param(
  [string]$Image = "tambola:free",
  [string]$ContainerName = "tambola-free",
  [int]$Port = 4000,
  [switch]$SkipBuild,
  # Non-secret Supabase session-pooler coordinates (project ref is public).
  [string]$DbUser = "postgres.ekpklgvysougdhgxuctq",
  [string]$DbHost = "aws-1-eu-central-1.pooler.supabase.com",
  [int]$DbPort = 5432,
  [string]$DbName = "postgres"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
function Fail([string]$m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }

# --- locate cloudflared -------------------------------------------------------
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) {
  $candidate = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
  if (Test-Path $candidate) { $cf = $candidate } else { Fail "cloudflared not found on PATH or default location." }
}

# --- Docker must be running ---------------------------------------------------
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail "Docker is not running. Start Docker Desktop, then retry." }

# --- read secrets (never printed) --------------------------------------------
$mfa = $env:OWNER_MFA_KEY
if (-not $mfa) {
  $envFile = Join-Path $root ".env"
  if (Test-Path $envFile) {
    $line = Select-String -Path $envFile -Pattern '^OWNER_MFA_KEY=' | Select-Object -First 1
    if ($line) { $mfa = ($line.Line -split '=', 2)[1].Trim() }
  }
}
if (-not $mfa) { Fail "OWNER_MFA_KEY not found (set `$env:OWNER_MFA_KEY or keep it in .env)." }

$dbUrl = $env:TAMBOLA_PROD_DATABASE_URL
if (-not $dbUrl) {
  $pw = $env:TAMBOLA_DB_PASSWORD
  if (-not $pw) {
    $pwFile = Join-Path $env:TEMP "tambola_dbpw.txt"
    if (Test-Path $pwFile) { $pw = (Get-Content $pwFile -Raw).Trim() }
  }
  if (-not $pw) { Fail "No DB password: set `$env:TAMBOLA_PROD_DATABASE_URL, `$env:TAMBOLA_DB_PASSWORD, or write it to $env:TEMP\tambola_dbpw.txt." }
  # Safest supported TLS: verify cert + hostname against the CA baked into the image.
  $caInContainer = "/app/deploy/supabase-root-ca.pem"
  $dbUrl = "postgresql://" + $DbUser + ":" + $pw + "@" + $DbHost + ":" + $DbPort + "/" + $DbName + "?sslmode=verify-full&sslrootcert=" + $caInContainer
}

# --- build the image (cached, fast when unchanged) ---------------------------
if (-not $SkipBuild) {
  Write-Host "Building image $Image ..." -ForegroundColor Cyan
  docker build -t $Image $root
  if ($LASTEXITCODE -ne 0) { Fail "docker build failed." }
}

# --- start the Cloudflare Quick Tunnel FIRST (so we know the URL) ------------
# Stop any tunnel we previously started, then launch a fresh one.
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$logFile = Join-Path $env:TEMP "tambola_cloudflared.log"
Remove-Item $logFile -ErrorAction SilentlyContinue
$cfArgs = @("tunnel", "--url", "http://127.0.0.1:$Port", "--no-autoupdate")
$cfProc = Start-Process -FilePath $cf -ArgumentList $cfArgs -RedirectStandardError $logFile -PassThru -WindowStyle Hidden
Write-Host "Starting Cloudflare Quick Tunnel (pid $($cfProc.Id)) ..." -ForegroundColor Cyan

$publicUrl = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $logFile) {
    $m = Select-String -Path $logFile -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($m) { $publicUrl = $m.Matches[0].Value; break }
  }
}
if (-not $publicUrl) { Fail "Tunnel URL did not appear in $logFile within 30s. See the log for details." }

# --- (re)create the container bound to the live tunnel URL -------------------
docker rm -f $ContainerName *> $null
docker run -d --name $ContainerName -p "${Port}:4000" `
  -e NODE_ENV=production -e PORT=4000 -e DB_SCHEMA=public -e MFA_ISSUER=Tambola `
  -e TRUST_PROXY=1 -e TAMBOLA_COOKIE_SECURE=1 `
  -e PUBLIC_ORIGIN=$publicUrl -e DATABASE_URL=$dbUrl -e OWNER_MFA_KEY=$mfa `
  $Image *> $null
if ($LASTEXITCODE -ne 0) { Fail "docker run failed." }

# --- wait for readiness through the public URL -------------------------------
Write-Host "Waiting for the app to become ready through the tunnel ..." -ForegroundColor Cyan
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest ($publicUrl + "/readyz") -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -eq 200) {
      $body = $r.Content | ConvertFrom-Json
      if ($body.ready) { $ready = $true; break }
    }
  } catch { }
}
$health = (docker inspect -f "{{.State.Health.Status}}" $ContainerName).Trim()

Write-Host ""
Write-Host "Tambola is live at:  $publicUrl" -ForegroundColor Green
Write-Host "  container health : $health"
Write-Host "  /readyz ready    : $ready"
Write-Host "  view logs        : docker logs -f $ContainerName"
Write-Host "  stop everything  : .\deploy\free-stop.ps1"
Write-Host ""
Write-Host "Reminder: this URL changes on every restart and only works while this PC is on." -ForegroundColor Yellow
