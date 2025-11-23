# Script to update projects with final video URLs to completed status
# Uses PostgreSQL Docker container with --rm flag to connect to AWS RDS

param(
    [string]$DatabaseUrl = $env:DATABASE_URL
)

if (-not $DatabaseUrl) {
    Write-Host "Error: DATABASE_URL not provided. Please set it as an environment variable or pass it as a parameter." -ForegroundColor Red
    Write-Host "Usage: .\update-completed-projects.ps1 -DatabaseUrl 'postgresql://user:pass@host:5432/db?sslmode=require'" -ForegroundColor Yellow
    exit 1
}

# Parse DATABASE_URL
# Format: postgresql://USERNAME:PASSWORD@HOST:PORT/DATABASE?sslmode=require
$urlPattern = 'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/([^?]+)'
if ($DatabaseUrl -match $urlPattern) {
    $dbUser = $matches[1]
    $dbPassword = $matches[2]
    $dbHost = $matches[3]
    $dbPort = $matches[4]
    $dbName = $matches[5]
} else {
    Write-Host "Error: Invalid DATABASE_URL format. Expected: postgresql://user:pass@host:port/db" -ForegroundColor Red
    exit 1
}

Write-Host "Connecting to database: $dbHost:$dbPort/$dbName" -ForegroundColor Cyan
Write-Host ""

# Use the SQL file in the same directory
$sqlFile = Join-Path $PSScriptRoot "update-completed-projects.sql"

if (-not (Test-Path $sqlFile)) {
    Write-Host "Error: SQL file not found at $sqlFile" -ForegroundColor Red
    exit 1
}

Write-Host "Executing SQL update..." -ForegroundColor Cyan

try {
    # Get absolute path for Windows Docker mount
    $sqlFileAbsolute = (Resolve-Path $sqlFile).Path
    
    # Run PostgreSQL container with --rm flag
    # Mount the SQL file and execute it
    docker run --rm `
      -v "${sqlFileAbsolute}:/tmp/update.sql:ro" `
      -e PGPASSWORD="$dbPassword" `
      postgres:latest `
      psql `
      -h $dbHost `
      -p $dbPort `
      -U $dbUser `
      -d $dbName `
      -v ON_ERROR_STOP=1 `
      -f /tmp/update.sql

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✓ Successfully updated projects!" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "✗ Error executing SQL. Exit code: $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
} catch {
    Write-Host ""
    Write-Host "✗ Error: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Done!" -ForegroundColor Green

