# LEPIOS post-reboot smoke test
# Run after every reboot to confirm the orb stack survived. Logs to
# logs/post-reboot-smoke.log and exits 1 if any check fails.
#
# Checks:
#   1. cloudflared Windows service is Running (auto-start)
#   2. Ollama tunnel (ollama.loeppky.xyz) returns model list
#   3. Production /chat returns HTTP 200
#   4. Local Ollama 11434 reachable (informational)

$ErrorActionPreference = 'Continue'
$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$logPath = Join-Path $PSScriptRoot '..\logs\post-reboot-smoke.log'

$logDir = Split-Path $logPath
if (-not (Test-Path $logDir)) { New-Item -Path $logDir -ItemType Directory -Force | Out-Null }

$results = @()

$svc = Get-Service cloudflared -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') {
    $results += "PASS cloudflared service: Running (StartType: $($svc.StartType))"
} else {
    $state = if ($svc) { $svc.Status } else { 'NotInstalled' }
    $results += "FAIL cloudflared service: $state"
}

try {
    $tunnel = Invoke-RestMethod -Uri 'https://ollama.loeppky.xyz/api/tags' -TimeoutSec 5
    $modelCount = $tunnel.models.Count
    $results += "PASS Ollama tunnel: $modelCount models reachable"
} catch {
    $results += "FAIL Ollama tunnel: $($_.Exception.Message)"
}

try {
    $resp = Invoke-WebRequest -Uri 'https://lepios-one.vercel.app/chat' -TimeoutSec 10 -UseBasicParsing
    $results += "PASS Production /chat: HTTP $($resp.StatusCode)"
} catch {
    $results += "FAIL Production /chat: $($_.Exception.Message)"
}

try {
    $local = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3
    $results += "PASS Local Ollama 11434: $($local.models.Count) models"
} catch {
    $results += "WARN Local Ollama 11434: not directly reachable (tunnel covers this)"
}

$summary = "[$timestamp] LEPIOS post-reboot smoke test`n" + ($results -join "`n")
Write-Output $summary
Add-Content -Path $logPath -Value $summary
Add-Content -Path $logPath -Value '---'

if ($results -match '^FAIL') { exit 1 } else { exit 0 }
