# =============================================================================
# test-kakao-qr.ps1 — one-shot test for the auto-KakaoPay walk-in QR flow.
#
# What it does:
#   1. POSTs to /api/public/v1/payments with qr_mode = "auto_kakao"
#   2. Prints the response
#   3. Decodes the base64 PNG and saves it as kakao-qr.png
#   4. Opens it so you can scan with a Korean phone
#
# Usage:
#   .\scripts\test-kakao-qr.ps1
#   .\scripts\test-kakao-qr.ps1 -Amount 50000
#   .\scripts\test-kakao-qr.ps1 -ApiHost "indianbeans.com" -ApiKey "sk_..."
# =============================================================================

[CmdletBinding()]
param(
    [string] $ApiHost     = 'indianbeans.com',
    [string] $ApiKey      = 'sk_cgsKCvgzo4zFK89djRmZkXxM-x800NoXYMmVkt634hE',
    [int]    $Amount      = 100000,
    [string] $Currency    = 'KRW',
    [string] $Email       = 'pos@merchant.co.kr',
    [string] $Description = 'Walk-in KakaoPay test',
    [string] $WebhookUrl  = '',
    [string] $OutFile     = 'kakao-qr.png',
    [switch] $NoOpen
)

$ErrorActionPreference = 'Stop'

$apiUrl = "https://$ApiHost/api/public/v1/payments"
$orderId = 'QR-TEST-' + (Get-Date -Format 'yyyyMMdd-HHmmss')

# 1. Build request body
$bodyObj = @{
    amount          = $Amount
    currency        = $Currency
    payment_methods = @('kakao_pay')
    qr              = $true
    qr_mode         = 'auto_kakao'
    customer        = @{ email = $Email }
    description     = $Description
    metadata        = @{ order_id = $orderId }
}
if ($WebhookUrl) { $bodyObj.webhook_url = $WebhookUrl }

$bodyJson = $bodyObj | ConvertTo-Json -Depth 5 -Compress

Write-Host ''
Write-Host "POST $apiUrl" -ForegroundColor Cyan
Write-Host '--- request body ---' -ForegroundColor DarkGray
$bodyObj | ConvertTo-Json -Depth 5
Write-Host '--------------------' -ForegroundColor DarkGray
Write-Host ''

# 2. Call the API
try {
    $response = Invoke-RestMethod `
        -Method Post `
        -Uri $apiUrl `
        -Headers @{
            'Authorization' = "Bearer $ApiKey"
            'Content-Type'  = 'application/json'
        } `
        -Body $bodyJson
}
catch {
    Write-Host 'Request failed:' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.Exception.Response) {
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            Write-Host $reader.ReadToEnd() -ForegroundColor Yellow
        } catch { }
    }
    exit 1
}

Write-Host '--- response ---' -ForegroundColor DarkGray
$response | Select-Object id, status, amount, currency, qr_mode, link_slug, checkout_url, embed_url, created_at | Format-List
Write-Host '----------------' -ForegroundColor DarkGray
Write-Host ''

# 3. Decode qr_data_url into a real PNG file
if (-not $response.qr_data_url) {
    Write-Host 'No qr_data_url in response. Nothing to save.' -ForegroundColor Yellow
    exit 1
}

$dataUrl = [string] $response.qr_data_url
$prefix  = 'data:image/png;base64,'

if (-not $dataUrl.StartsWith($prefix)) {
    $head = $dataUrl.Substring(0, [Math]::Min(60, $dataUrl.Length))
    Write-Host "qr_data_url is not a base64 PNG — got: $head..." -ForegroundColor Yellow
    exit 1
}

$b64   = $dataUrl.Substring($prefix.Length)
$bytes = [Convert]::FromBase64String($b64)

$outPath = Join-Path (Get-Location) $OutFile
[System.IO.File]::WriteAllBytes($outPath, $bytes)

Write-Host "Saved QR to:    $outPath" -ForegroundColor Green
Write-Host "QR encodes URL: $($response.checkout_url)" -ForegroundColor Green
Write-Host ''

# 4. Open the PNG
if (-not $NoOpen) {
    Write-Host 'Opening QR in default image viewer...' -ForegroundColor Cyan
    Start-Process $outPath
}

Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1. Point a Korean phone camera at the QR on screen'
Write-Host '  2. Tap the detected link'
Write-Host '  3. Phone shows Opening KakaoPay splash (~1-2s)'
Write-Host '  4. KakaoPay app opens with payment pre-filled'
Write-Host '  5. Tap Pay in KakaoPay'
Write-Host ''
