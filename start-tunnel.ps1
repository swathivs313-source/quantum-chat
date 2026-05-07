$exePath = "$PSScriptRoot\cloudflared.exe"

# Download cloudflared if it doesn't exist
if (-not (Test-Path $exePath)) {
    Write-Host "Downloading Cloudflare Tunnel..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $exePath
}

Write-Host "Starting Cloudflare Tunnel on port 3000..." -ForegroundColor Green
Write-Host "Look for the URL that ends with .trycloudflare.com" -ForegroundColor Yellow
Write-Host "------------------------------------------------------"
& $exePath tunnel --url http://localhost:3000
