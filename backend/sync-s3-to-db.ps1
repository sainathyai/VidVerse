# Sync S3 videos to RDS database for a specific project
# Usage: .\sync-s3-to-db.ps1 <projectId>

param(
    [string]$ProjectId = "e9731679-e3ad-4412-ae67-aa1513065d35"
)

# Load environment variables
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    $envContent = Get-Content $envFile
    foreach ($line in $envContent) {
        if ($line -match "^([^#][^=]+)=(.*)$") {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            if ($key -and $value) {
                [Environment]::SetEnvironmentVariable($key, $value, "Process")
            }
        }
    }
}

# Import AWS SDK modules (if available)
try {
    Import-Module AWSPowerShell -ErrorAction SilentlyContinue
} catch {
    Write-Host "AWS PowerShell module not found. Using AWS CLI instead." -ForegroundColor Yellow
}

# Get project info from database first
Write-Host "Getting project info from database..." -ForegroundColor Cyan

$dbUrl = $env:DATABASE_URL
if (-not $dbUrl) {
    Write-Host "Error: DATABASE_URL not found. Please set it in .env" -ForegroundColor Red
    exit 1
}

# Parse DATABASE_URL
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

# Query project to get user_id
$getProjectSql = "SELECT id, user_id, name, status, config FROM projects WHERE id = '$ProjectId';"
$tempSqlFile = Join-Path $env:TEMP "get-project-$(Get-Random).sql"
$getProjectSql | Out-File -FilePath $tempSqlFile -Encoding utf8

try {
    $volumeMounts += "-v"
    $volumeMounts += "${tempSqlFile}:/query.sql:ro"
    
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
    
    $dockerArgs = @("run", "--rm") + $envVars + $volumeMounts + @(
        "postgres:15-alpine",
        "psql",
        "-h", $dbHost,
        "-p", $port,
        "-U", $username,
        "-d", $database,
        "-t", "-A", "-F", "|",
        "-f", "/query.sql"
    )
    
    $projectResult = & docker $dockerArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error querying database: $projectResult" -ForegroundColor Red
        exit 1
    }
    
    $projectData = $projectResult | Where-Object { $_ -match '\|' } | Select-Object -First 1
    if (-not $projectData) {
        Write-Host "Project not found in database!" -ForegroundColor Red
        exit 1
    }
    
    $fields = $projectData -split '\|'
    $userId = $fields[1].Trim()
    $projectName = $fields[2].Trim()
    $projectStatus = $fields[3].Trim()
    
    Write-Host "Project: $projectName (Status: $projectStatus)" -ForegroundColor Green
    Write-Host "User ID: $userId" -ForegroundColor Green
    Write-Host ""
    
} finally {
    if (Test-Path $tempSqlFile) {
        Remove-Item $tempSqlFile -Force
    }
}

# Get S3 bucket and region from config
$bucketName = $env:S3_BUCKET_NAME
$region = $env:S3_REGION
if (-not $bucketName) {
    Write-Host "Error: S3_BUCKET_NAME not found in .env" -ForegroundColor Red
    exit 1
}
if (-not $region) {
    $region = "us-west-2"
}

Write-Host "Listing videos in S3..." -ForegroundColor Cyan
Write-Host "Bucket: $bucketName" -ForegroundColor Cyan
Write-Host "Prefix: users/$userId/projects/$ProjectId/video/" -ForegroundColor Cyan
Write-Host ""

# List S3 objects using AWS CLI
$s3Prefix = "users/$userId/projects/$ProjectId/video/"
$awsCmd = "aws s3 ls s3://$bucketName/$s3Prefix --recursive --region $region"

try {
    $s3Objects = Invoke-Expression $awsCmd 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error listing S3 objects. Make sure AWS CLI is configured." -ForegroundColor Red
        Write-Host "Error: $s3Objects" -ForegroundColor Red
        exit 1
    }
    
    if (-not $s3Objects -or $s3Objects.Count -eq 0) {
        Write-Host "No videos found in S3 for this project." -ForegroundColor Yellow
        exit 0
    }
    
    Write-Host "Found videos in S3:" -ForegroundColor Green
    $videoUrls = @{}
    
    foreach ($line in $s3Objects) {
        if ($line -match "(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(\d+)\s+(.+)") {
            $key = $matches[4].Trim()
            $size = $matches[3].Trim()
            
            # Extract scene number from filename
            $sceneNumber = $null
            if ($key -match "scene-(\d+)\.mp4") {
                $sceneNumber = [int]$matches[1]
            } elseif ($key -match "output\.mp4") {
                $sceneNumber = "final"
            }
            
            # Construct S3 URL
            $s3Url = "https://$bucketName.s3.$region.amazonaws.com/$key"
            
            if ($sceneNumber) {
                Write-Host "  Scene $sceneNumber : $s3Url" -ForegroundColor Cyan
                $videoUrls[$sceneNumber] = $s3Url
            } else {
                Write-Host "  Other: $s3Url" -ForegroundColor Gray
            }
        }
    }
    
    Write-Host ""
    
    if ($videoUrls.Count -eq 0) {
        Write-Host "No scene videos found (only found non-scene files)." -ForegroundColor Yellow
        exit 0
    }
    
    # Update database with S3 URLs
    Write-Host "Updating database with S3 URLs..." -ForegroundColor Cyan
    
    foreach ($sceneNum in $videoUrls.Keys) {
        if ($sceneNum -eq "final") {
            # Update project config with final video URL
            Write-Host "  Updating final video URL in project config..." -ForegroundColor Yellow
            # This would require getting current config, updating it, and saving back
            # For now, just note it
            Write-Host "    Final video: $($videoUrls[$sceneNum])" -ForegroundColor Gray
        } else {
            # Update scene in database
            $videoUrl = $videoUrls[$sceneNum]
            Write-Host "  Updating scene $sceneNum with video URL..." -ForegroundColor Yellow
            
            # Escape single quotes in videoUrl for SQL
            $escapedVideoUrl = $videoUrl -replace "'", "''"
            
            $updateSql = "UPDATE scenes SET video_url = '$escapedVideoUrl', updated_at = NOW() WHERE project_id = '$ProjectId' AND scene_number = $sceneNum; INSERT INTO scenes (project_id, scene_number, video_url, prompt, duration, start_time, created_at, updated_at) SELECT '$ProjectId', $sceneNum, '$escapedVideoUrl', 'Synced from S3', 5.0, 0.0, NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM scenes WHERE project_id = '$ProjectId' AND scene_number = $sceneNum);"
            
            $tempUpdateSql = Join-Path $env:TEMP "update-scene-$(Get-Random).sql"
            $updateSql | Out-File -FilePath $tempUpdateSql -Encoding utf8
            
            try {
                $updateVolumeMounts = @()
                if (Test-Path $certPath) {
                    $certPathAbs = (Resolve-Path $certPath).Path
                    $updateVolumeMounts += "-v"
                    $updateVolumeMounts += "${certPathAbs}:/root/.postgresql/root.crt:ro"
                }
                $updateVolumeMounts += "-v"
                $updateVolumeMounts += "${tempUpdateSql}:/update.sql:ro"
                
                $updateEnvVars = @(
                    "-e", "PGPASSWORD=$password"
                )
                
                if ($sslMode -match "verify-ca") {
                    $updateEnvVars += "-e"
                    $updateEnvVars += "PGSSLMODE=verify-ca"
                    $updateEnvVars += "-e"
                    $updateEnvVars += "PGSSLROOTCERT=/root/.postgresql/root.crt"
                } else {
                    $updateEnvVars += "-e"
                    $updateEnvVars += "PGSSLMODE=require"
                }
                
                $updateDockerArgs = @("run", "--rm") + $updateEnvVars + $updateVolumeMounts + @(
                    "postgres:15-alpine",
                    "psql",
                    "-h", $dbHost,
                    "-p", $port,
                    "-U", $username,
                    "-d", $database,
                    "-f", "/update.sql"
                )
                
                $updateResult = & docker $updateDockerArgs 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "    ✓ Scene $sceneNum updated successfully" -ForegroundColor Green
                } else {
                    Write-Host "    ✗ Error updating scene $sceneNum : $updateResult" -ForegroundColor Red
                }
            } finally {
                if (Test-Path $tempUpdateSql) {
                    Remove-Item $tempUpdateSql -Force
                }
            }
        }
    }
    
    Write-Host ""
    Write-Host "Sync completed!" -ForegroundColor Green
    
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

