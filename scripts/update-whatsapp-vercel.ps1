# Update Meta WhatsApp token on Vercel production
# Usage: .\scripts\update-whatsapp-vercel.ps1 -AccessToken "EAAxxxx..."

param(
  [Parameter(Mandatory = $true)]
  [string]$AccessToken,
  [string]$PhoneNumberId = "1137266636139583",
  [string]$VerifyToken = "yonderly_verify_2026"
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

function Set-VercelEnv($Name, $Value) {
  vercel env rm $Name production --yes 2>$null
  $Value | vercel env add $Name production
}

Write-Host "Updating WhatsApp env vars on Vercel production..."
Set-VercelEnv "WHATSAPP_ACCESS_TOKEN" $AccessToken
Set-VercelEnv "WHATSAPP_PHONE_NUMBER_ID" $PhoneNumberId
Set-VercelEnv "WHATSAPP_VERIFY_TOKEN" $VerifyToken

Write-Host "Redeploying..."
vercel deploy --prod --yes

Write-Host "Testing webhook..."
Start-Sleep -Seconds 5
$result = Invoke-RestMethod -Uri "https://yonderly.online/webhook" -Method POST -ContentType "application/json" -Body '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[{"from":"27762794211","type":"text","text":{"body":"Hello"}}]}}]}]}'
$result | ConvertTo-Json

Write-Host "Health check:"
Invoke-RestMethod -Uri "https://yonderly.online/api/auth/health" | ConvertTo-Json -Depth 5
