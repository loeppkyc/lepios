# memory-guard.ps1
# Windows RAM monitor + exhaust valve for LepiOS.
#
# Runs as a Windows Task Scheduler job every 2 minutes.
# - Reads current RAM usage via WMI
# - Pushes stats to Supabase memory_stats table (visible on /systems gauge)
# - Sends Telegram warning at 80% RAM
# - Sends Telegram critical alert at 90% RAM + optionally stops Ollama
#
# SETUP:
#   1. Set the four variables in the CONFIG section below (or set as env vars).
#   2. Open Task Scheduler → Create Basic Task
#      Trigger: "When the computer starts" + repeat every 2 minutes
#      Action:  powershell.exe -NonInteractive -File "C:\path\to\memory-guard.ps1"
#   3. Run once manually to verify: .\memory-guard.ps1 -Verbose
#
# PARAMETERS
#   -DryRun    : log everything but don't send Telegram or stop Ollama
#   -ForceStop : stop Ollama even if RAM is below the 90% threshold (for testing)

param(
  [switch]$DryRun,
  [switch]$ForceStop,
  [switch]$Verbose
)

# ── CONFIG ────────────────────────────────────────────────────────────────────
# Override with environment variables or edit here directly.
$SUPABASE_URL       = if ($env:SUPABASE_URL)       { $env:SUPABASE_URL }       else { "https://xpanlbcjueimeofgsara.supabase.co" }
$SUPABASE_ANON_KEY  = if ($env:SUPABASE_ANON_KEY)  { $env:SUPABASE_ANON_KEY }  else { "" }  # set as env var — never hardcode
$TELEGRAM_BOT_TOKEN = if ($env:LEPIOS_ALERTS_BOT)  { $env:LEPIOS_ALERTS_BOT }  else { "" }  # loeppky_alerts_bot token
$TELEGRAM_CHAT_ID   = if ($env:LEPIOS_CHAT_ID)     { $env:LEPIOS_CHAT_ID }     else { "8741603768" }

$WARN_PCT  = 80   # send warning
$ALERT_PCT = 90   # send critical alert + offer to stop Ollama
$AUTO_STOP_OLLAMA = $true   # set $false to only alert, not auto-stop

# ── GATHER RAM STATS ──────────────────────────────────────────────────────────
$os = Get-CimInstance -ClassName Win32_OperatingSystem
$totalMb  = [math]::Round($os.TotalVisibleMemorySize / 1024, 2)   # MB
$freeMb   = [math]::Round($os.FreePhysicalMemory     / 1024, 2)
$usedMb   = $totalMb - $freeMb
$ramPct   = [math]::Round(($usedMb / $totalMb) * 100, 2)
$totalGb  = [math]::Round($totalMb / 1024, 2)
$usedGb   = [math]::Round($usedMb  / 1024, 2)

# Top memory process (by WorkingSet)
$topProc = Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 1
$topName = $topProc.ProcessName
$topMb   = [math]::Round($topProc.WorkingSet / 1MB, 1)

if ($Verbose) {
  Write-Host "RAM: $ramPct% used ($usedGb GB / $totalGb GB)  Top: $topName ($topMb MB)"
}

# ── PUSH TO SUPABASE ──────────────────────────────────────────────────────────
if ($SUPABASE_ANON_KEY -and -not $DryRun) {
  $body = @{
    ram_pct        = $ramPct
    ram_used_gb    = $usedGb
    ram_total_gb   = $totalGb
    top_process    = $topName
    top_process_mb = $topMb
  } | ConvertTo-Json -Compress

  try {
    Invoke-RestMethod `
      -Uri     "$SUPABASE_URL/rest/v1/memory_stats" `
      -Method  Post `
      -Headers @{
        "apikey"        = $SUPABASE_ANON_KEY
        "Authorization" = "Bearer $SUPABASE_ANON_KEY"
        "Content-Type"  = "application/json"
        "Prefer"        = "return=minimal"
      } `
      -Body $body | Out-Null
  } catch {
    Write-Warning "Supabase push failed: $_"
  }
} elseif ($DryRun) {
  Write-Host "[DRY RUN] Would push: ram_pct=$ramPct, top=$topName ($topMb MB)"
}

# ── TELEGRAM ALERT HELPER ─────────────────────────────────────────────────────
function Send-TelegramAlert {
  param([string]$Message)
  if (-not $TELEGRAM_BOT_TOKEN) { Write-Warning "LEPIOS_ALERTS_BOT not set — alert suppressed"; return }
  if ($DryRun) { Write-Host "[DRY RUN] Telegram: $Message"; return }
  try {
    Invoke-RestMethod `
      -Uri    "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" `
      -Method Post `
      -Body   @{ chat_id = $TELEGRAM_CHAT_ID; text = $Message; parse_mode = "Markdown" } | Out-Null
  } catch {
    Write-Warning "Telegram send failed: $_"
  }
}

# ── EXHAUST VALVE — STOP OLLAMA ───────────────────────────────────────────────
function Stop-OllamaService {
  $running = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
  if ($null -eq $running) { return $false }
  if ($DryRun) { Write-Host "[DRY RUN] Would stop Ollama"; return $true }
  try {
    Stop-Process -Name "ollama" -Force -ErrorAction Stop
    return $true
  } catch {
    Write-Warning "Could not stop Ollama: $_"
    return $false
  }
}

# ── THRESHOLD LOGIC ───────────────────────────────────────────────────────────
if ($ForceStop) {
  $stopped = Stop-OllamaService
  Send-TelegramAlert "*[SYSTEMS]* Force-stop: Ollama $(if ($stopped) {'stopped'} else {'not running'})."
  return
}

if ($ramPct -ge $ALERT_PCT) {
  $msg = "*[SYSTEMS] CRITICAL* — RAM at $ramPct%`nUsed: $usedGb GB / $totalGb GB`nTop process: $topName ($topMb MB)"

  if ($AUTO_STOP_OLLAMA) {
    $stopped = Stop-OllamaService
    $msg += "`n$(if ($stopped) {'Ollama stopped automatically.'} else {'Ollama not running.'})"
  } else {
    $msg += "`nCheck what is consuming memory."
  }

  Send-TelegramAlert $msg

} elseif ($ramPct -ge $WARN_PCT) {
  Send-TelegramAlert "*[SYSTEMS] Warning* — RAM at $ramPct%`nUsed: $usedGb GB / $totalGb GB`nTop: $topName ($topMb MB)"
}

if ($Verbose) {
  Write-Host "Done. RAM=$ramPct%  Alert threshold=$ALERT_PCT%  Warn threshold=$WARN_PCT%"
}
