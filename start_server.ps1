# Start MortgageDiary Backend Server
# This script starts the Node.js API server

Write-Host "MortgageDiary Backend Startup" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Check if Node.js is installed
try {
    $nodeVersion = node --version
    Write-Host "Node.js version: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js is not installed!" -ForegroundColor Red
    Write-Host "Download from: https://nodejs.org" -ForegroundColor Yellow
    exit 1
}

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "`nDependencies not installed. Installing now..." -ForegroundColor Yellow
    Write-Host "Running: npm install" -ForegroundColor Cyan
    npm install
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`nERROR: npm install failed!" -ForegroundColor Red
        Write-Host "Please run manually: npm install" -ForegroundColor Yellow
        Write-Host "Or install dependencies manually:" -ForegroundColor Yellow
        Write-Host "  npm install express cors" -ForegroundColor White
        exit 1
    }
}

Write-Host "`nStarting API server on port 3001..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

node server.js
