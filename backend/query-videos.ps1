# Query RDS database for videos generated for a specific project
# Usage: .\query-videos.ps1 <projectId>

param(
    [string]$ProjectId = "e9731679-e3ad-4412-ae67-aa1513065d35"
)

# Load DATABASE_URL from .env file
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    $envContent = Get-Content $envFile
    $dbUrlLine = $envContent | Where-Object { $_ -match "^DATABASE_URL=(.+)$" }
    if ($dbUrlLine) {
        $env:DATABASE_URL = ($dbUrlLine -replace "^DATABASE_URL=", "").Trim()
    }
}

if (-not $env:DATABASE_URL) {
    Write-Host "Error: DATABASE_URL not found. Please set it in .env or as environment variable." -ForegroundColor Red
    exit 1
}

# Parse DATABASE_URL
# Format: postgresql://USERNAME:PASSWORD@ENDPOINT:PORT/DATABASE?sslmode=require
$dbUrl = $env:DATABASE_URL
if ($dbUrl -match "postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/([^?]+)") {
    $username = $matches[1]
    $password = $matches[2]
    $dbHost = $matches[3]
    $port = $matches[4]
    $database = $matches[5]
} else {
    Write-Host "Error: Invalid DATABASE_URL format" -ForegroundColor Red
    exit 1
}

Write-Host "Querying RDS for project: $ProjectId" -ForegroundColor Cyan
Write-Host "Host: $dbHost" -ForegroundColor Cyan
Write-Host "Database: $database" -ForegroundColor Cyan
Write-Host ""

# Check if SSL certificate exists
$certPath = Join-Path $PSScriptRoot "certs\rds-ca-rsa2048-g1.pem"
$volumeMounts = @()
$sslMode = "sslmode=require"
if (Test-Path $certPath) {
    $certPathAbs = (Resolve-Path $certPath).Path
    $volumeMounts += "-v"
    $volumeMounts += "${certPathAbs}:/root/.postgresql/root.crt:ro"
    $sslMode = "sslmode=verify-ca sslrootcert=/root/.postgresql/root.crt"
}

# Create temporary SQL file
$tempSqlFile = Join-Path $env:TEMP "query-videos-$(Get-Random).sql"
$sqlQuery = @"
SELECT 
  p.id as project_id,
  p.name as project_name,
  p.status as project_status,
  s.id as scene_id,
  s.scene_number,
  s.video_url,
  s.thumbnail_url,
  s.first_frame_url,
  s.last_frame_url,
  s.duration,
  s.start_time,
  s.metadata as scene_metadata,
  a.id as asset_id,
  a.type as asset_type,
  a.url as asset_url,
  j.id as job_id,
  j.type as job_type,
  j.status as job_status,
  j.progress,
  j.current_stage,
  j.error,
  j.completed_at
FROM projects p
LEFT JOIN scenes s ON s.project_id = p.id
LEFT JOIN assets a ON a.project_id = p.id AND a.type = 'video'
LEFT JOIN jobs j ON j.project_id = p.id
WHERE p.id = '$ProjectId'
ORDER BY s.scene_number ASC, j.created_at DESC;
"@

$sqlQuery | Out-File -FilePath $tempSqlFile -Encoding utf8

try {
    # Mount SQL file
    $volumeMounts += "-v"
    $volumeMounts += "${tempSqlFile}:/query.sql:ro"
    
    Write-Host "Executing query..." -ForegroundColor Yellow
    Write-Host ""
    
    # Build and run Docker command
    
    # Set SSL environment variables for psql
    $envVars = @(
        "-e", "PGPASSWORD=$password"
    )
    
    if ($sslMode -match "verify-ca") {
        $envVars += "-e"
        $envVars += "PGSSLMODE=verify-ca"
        $envVars += "-e"
        $envVars += "PGSSLROOTCERT=/root/.postgresql/root.crt"
    } else {
        $envVars += "-e"
        $envVars += "PGSSLMODE=require"
    }
    
    $dockerArgs = @(
        "run", "--rm"
    )
    
    $dockerArgs += $envVars
    $dockerArgs += $volumeMounts
    
    $dockerArgs += @(
        "postgres:15-alpine",
        "psql",
        "-h", $dbHost,
        "-p", $port,
        "-U", $username,
        "-d", $database,
        "-f", "/query.sql"
    )
    
    & docker $dockerArgs
} finally {
    # Clean up temp file
    if (Test-Path $tempSqlFile) {
        Remove-Item $tempSqlFile -Force
    }
}

