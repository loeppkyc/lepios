# LEPIOS Orb Launcher
# Double-click or run: powershell -File scripts\orb-start.ps1
#
# 1. Checks cloudflared tunnel service (starts if stopped)
# 2. Checks Ollama is responding
# 3. Opens lepios-one.vercel.app/chat in default browser

param([string]$Url = "https://lepios-one.vercel.app/chat")

function Write-Status($icon, $label, $msg) {
    Write-Host ("  " + $icon + "  " + $label) -ForegroundColor Cyan -NoNewline
    Write-Host ("  " + $msg)
}

Write-Host ""
Write-Host "  LEPIOS" -ForegroundColor White
Write-Host "  ----------------------------------" -ForegroundColor DarkGray
Write-Host ""

# 1 - Cloudflared tunnel
$svc = Get-Service cloudflared -ErrorAction SilentlyContinue
if ($null -eq $svc) {
    Write-Status "?" "Tunnel" "service not installed - see docs/ops/cloudflared-windows-service.md"
} elseif ($svc.Status -ne "Running") {
    Write-Host "  > Starting cloudflared..." -ForegroundColor Yellow
    Start-Service cloudflared -ErrorAction SilentlyContinue
    Start-Sleep 3
    if ((Get-Service cloudflared).Status -eq "Running") {
        Write-Status "OK" "Tunnel" "cloudflared started (ollama.loeppky.xyz)"
    } else {
        Write-Status "!!" "Tunnel" "failed to start - run: sc.exe start cloudflared"
    }
} else {
    Write-Status "OK" "Tunnel" "cloudflared running -> ollama.loeppky.xyz"
}

# 2 - Ollama health
$ollamaOk = $false
$ollamaResult = Invoke-RestMethod "http://localhost:11434/api/tags" -TimeoutSec 4 -ErrorAction SilentlyContinue
if ($null -ne $ollamaResult) {
    $models = ($ollamaResult.models | ForEach-Object { $_.name }) -join ", "
    Write-Status "OK" "Ollama" $models
    $ollamaOk = $true
} else {
    Write-Status "!!" "Ollama" "not responding on :11434 - start Ollama before chatting"
}

# 3 - Open browser
Write-Host ""
if ($Url -ne "about:blank") {
    Write-Host ("  Opening " + $Url) -ForegroundColor DarkGray
    Start-Process $Url
}

Write-Host ""
Write-Host "  ----------------------------------" -ForegroundColor DarkGray
if ($ollamaOk) {
    Write-Host "  Ready." -ForegroundColor Green
} else {
    Write-Host "  Start Ollama first, then refresh the chat." -ForegroundColor Yellow
}
Write-Host ""
