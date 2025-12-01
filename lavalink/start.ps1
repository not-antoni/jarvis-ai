# Lavalink Startup Script
Write-Host "Starting Lavalink server..." -ForegroundColor Cyan

$javaPath = "C:\Program Files\Microsoft\jdk-17.0.17.10-hotspot\bin\java.exe"

if (-not (Test-Path $javaPath)) {
    Write-Host "Java not found at expected path. Trying system java..." -ForegroundColor Yellow
    $javaPath = "java"
}

& $javaPath -Xmx512M -jar "$PSScriptRoot\Lavalink.jar"
