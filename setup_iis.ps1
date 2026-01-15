# Setup IIS site for MortgageDiary
# Run this script as Administrator

param(
    [string]$SiteName = "MortgageDiary",
    [string]$Port = 8081,
    [string]$AppPath = "c:\repos\MortgageDiary"
)

Write-Host "Setting up IIS site: $SiteName" -ForegroundColor Cyan

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

# Import IIS module
Import-Module WebAdministration -ErrorAction SilentlyContinue
if (-not (Get-Module WebAdministration)) {
    Write-Host "ERROR: IIS is not installed or WebAdministration module not available" -ForegroundColor Red
    Write-Host "Install IIS using: Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole" -ForegroundColor Yellow
    exit 1
}

# Check if site already exists
$existingSite = Get-Website -Name $SiteName -ErrorAction SilentlyContinue
if ($existingSite) {
    Write-Host "Site '$SiteName' already exists. Removing..." -ForegroundColor Yellow
    Remove-Website -Name $SiteName
    Start-Sleep -Seconds 2
}

# Check if app pool exists
$appPoolName = "${SiteName}AppPool"
$existingPool = Get-WebAppPoolState -Name $appPoolName -ErrorAction SilentlyContinue
if ($existingPool) {
    Write-Host "App pool '$appPoolName' already exists. Removing..." -ForegroundColor Yellow
    Remove-WebAppPool -Name $appPoolName
    Start-Sleep -Seconds 2
}

# Create Application Pool
Write-Host "Creating application pool: $appPoolName" -ForegroundColor Green
New-WebAppPool -Name $appPoolName
Set-ItemProperty IIS:\AppPools\$appPoolName -name "managedRuntimeVersion" -value ""

# Create Website
Write-Host "Creating website: $SiteName" -ForegroundColor Green
New-Website -Name $SiteName `
    -Port $Port `
    -PhysicalPath $AppPath `
    -ApplicationPool $appPoolName

# Start the site
Start-Website -Name $SiteName

Write-Host "`nIIS site setup completed successfully!" -ForegroundColor Green
Write-Host "Site Name: $SiteName" -ForegroundColor Cyan
Write-Host "URL: http://localhost:$Port" -ForegroundColor Cyan
Write-Host "Physical Path: $AppPath" -ForegroundColor Cyan
Write-Host "`nOpening browser..." -ForegroundColor Yellow

Start-Sleep -Seconds 2
Start-Process "http://localhost:$Port"
