#Requires -Version 5
<#
  Stops the free Tambola deployment created by deploy\free-start.ps1:
  removes the app container and terminates the Cloudflare Quick Tunnel.
  Safe to run even if neither is present. Does NOT touch the database.
#>
[CmdletBinding()]
param(
  [string]$ContainerName = "tambola-free"
)

$ErrorActionPreference = "SilentlyContinue"

# Stop + remove the container (frees the single-instance advisory lease cleanly).
docker rm -f $ContainerName | Out-Null
Write-Host "Removed container '$ContainerName' (if it existed)."

# Stop the tunnel process(es) started by free-start.ps1.
$procs = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($procs) {
  $procs | Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Host "Stopped cloudflared (pid $($procs.Id -join ', '))."
} else {
  Write-Host "No cloudflared process was running."
}

Write-Host "Done. The public URL is now offline." -ForegroundColor Yellow
