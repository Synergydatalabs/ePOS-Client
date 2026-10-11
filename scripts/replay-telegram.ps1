# ============================================================================
# replay-telegram.ps1
#
# Re-sends Telegram notifications for recent PAID invoices so you can
# verify the KakaoPay-vs-default bot routing without waiting for new
# real payments.
#
# Usage (from C:\ZASHX-APPs\tap-app on EC2):
#   .\scripts\replay-telegram.ps1
#   .\scripts\replay-telegram.ps1 -Limit 50 -SinceDays 30
#   .\scripts\replay-telegram.ps1 -ApiHost "https://indianbeans.com"
#   .\scripts\replay-telegram.ps1 -Secret "your-cron-secret"
#
# Env fallback: if -Secret isn't passed, reads CRON_SECRET from .env.
# ============================================================================

param(
    [string]$ApiHost = "http://localhost:4005",
    [string]$Secret = "",
    [int]$Limit = 20,
    [int]$SinceDays = 7
)

# Pull CRON_SECRET from .env if not provided.
if ([string]::IsNullOrWhiteSpace($Secret)) {
    $envFile = Join-Path (Get-Location) ".env"
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^\s*CRON_SECRET\s*=' } | Select-Object -First 1
        if ($line) {
            $Secret = ($line -replace '^\s*CRON_SECRET\s*=\s*', '').Trim().Trim('"').Trim("'")
        }
    }
}

if ([string]::IsNullOrWhiteSpace($Secret)) {
    Write-Host "ERROR: CRON_SECRET not found. Pass with -Secret or set it in .env" -ForegroundColor Red
    exit 1
}

$url = "$ApiHost/api/admin/telegram/replay?secret=$Secret&limit=$Limit&since=$SinceDays"

Write-Host ""
Write-Host "=== Telegram Replay ===" -ForegroundColor Cyan
Write-Host "Host:    $ApiHost"
Write-Host "Limit:   $Limit paid invoices"
Write-Host "Window:  last $SinceDays days"
Write-Host ""
Write-Host "Firing..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Method POST -Uri $url -ContentType "application/json" -Body "{}"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
    }
    exit 1
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Green
Write-Host "Checked: $($response.checked) invoices"
Write-Host "Sent:    $($response.sent)"
Write-Host "Failed:  $($response.failed)"
Write-Host "Routing: $($response.byRouting.kakao) to KakaoBOT  |  $($response.byRouting.default) to default bot"
Write-Host ""

if ($response.results) {
    Write-Host "=== Per-invoice ===" -ForegroundColor Cyan
    foreach ($r in $response.results) {
        $color = if ($r.ok) { "Green" } else { "Red" }
        $tag = if ($r.routed -eq "kakao") { "[KAKAO]  " } else { "[DEFAULT]" }
        $okTag = if ($r.ok) { "OK  " } else { "FAIL" }
        Write-Host "  $tag $okTag  $($r.invoice)  ($($r.method))" -ForegroundColor $color
    }
}

Write-Host ""
Write-Host "Check your Telegram groups now." -ForegroundColor Yellow
