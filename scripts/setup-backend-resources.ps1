# VidVerse Backend Resources Setup
# Checks and sets up RDS and S3 resources

param(
    [string]$Region = "us-west-2",
    [string]$DbInstanceIdentifier = "vidverse",
    [string]$BucketName = "vidverse-assets"
)

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VidVerse Backend Resources Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check AWS CLI
try {
    $null = aws --version 2>&1
    Write-Host "✓ AWS CLI is installed" -ForegroundColor Green
} catch {
    Write-Host "✗ AWS CLI not found. Install from https://aws.amazon.com/cli/" -ForegroundColor Red
    exit 1
}

# Check AWS credentials
try {
    $identity = aws sts get-caller-identity --region $Region 2>&1 | ConvertFrom-Json
    Write-Host "✓ AWS credentials valid" -ForegroundColor Green
    Write-Host "  Account: $($identity.Account)" -ForegroundColor Gray
} catch {
    Write-Host "✗ AWS credentials not configured. Run 'aws configure'" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Check S3 Bucket
Write-Host "Checking S3 Bucket..." -ForegroundColor Yellow
$bucketExists = $false
try {
    $result = aws s3api head-bucket --bucket $BucketName --region $Region 2>&1
    if ($LASTEXITCODE -eq 0) {
        $bucketExists = $true
        Write-Host "✓ S3 bucket exists: $BucketName" -ForegroundColor Green
    }
} catch {
    Write-Host "✗ S3 bucket does not exist: $BucketName" -ForegroundColor Red
    Write-Host "  Will create it..." -ForegroundColor Gray
}

if (-not $bucketExists) {
    Write-Host ""
    Write-Host "Creating S3 bucket: $BucketName" -ForegroundColor Yellow
    
    if ($Region -eq "us-east-1") {
        aws s3api create-bucket --bucket $BucketName --region $Region 2>&1 | Out-Null
    } else {
        $locationConstraint = @{LocationConstraint = $Region} | ConvertTo-Json -Compress
        aws s3api create-bucket --bucket $BucketName --region $Region --create-bucket-configuration $locationConstraint 2>&1 | Out-Null
    }
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ S3 bucket created successfully" -ForegroundColor Green
        $bucketExists = $true
    } else {
        Write-Host "✗ Failed to create S3 bucket" -ForegroundColor Red
    }
}

Write-Host ""

# Check RDS Instance
Write-Host "Checking RDS Instance..." -ForegroundColor Yellow
$rdsExists = $false
$rdsEndpoint = ""
$rdsPort = 5432
$rdsStatus = ""

try {
    $rdsInfo = aws rds describe-db-instances --db-instance-identifier $DbInstanceIdentifier --region $Region 2>&1 | ConvertFrom-Json
    if ($rdsInfo.DBInstances -and $rdsInfo.DBInstances.Count -gt 0) {
        $instance = $rdsInfo.DBInstances[0]
        $rdsExists = $true
        $rdsEndpoint = $instance.Endpoint.Address
        $rdsPort = $instance.Endpoint.Port
        $rdsStatus = $instance.DBInstanceStatus
        
        Write-Host "✓ RDS instance exists: $DbInstanceIdentifier" -ForegroundColor Green
        Write-Host "  Status: $rdsStatus" -ForegroundColor Gray
        Write-Host "  Endpoint: $rdsEndpoint" -ForegroundColor Gray
        
        if ($rdsStatus -ne "available") {
            Write-Host "  ⚠ Instance is not available yet. Please wait..." -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "✗ RDS instance does not exist: $DbInstanceIdentifier" -ForegroundColor Red
    Write-Host ""
    Write-Host "To create RDS instance, you need to:" -ForegroundColor Yellow
    Write-Host "1. Run: .\scripts\setup-rds-s3.ps1 -DbInstanceIdentifier $DbInstanceIdentifier" -ForegroundColor White
    Write-Host "   OR create it manually via AWS Console" -ForegroundColor White
    Write-Host ""
    Write-Host "Would you like to create it now? (y/n)" -ForegroundColor Yellow
    $createRds = Read-Host
    if ($createRds -eq "y" -or $createRds -eq "Y") {
        Write-Host "Creating RDS instance (this will take 5-10 minutes)..." -ForegroundColor Yellow
        & ".\scripts\setup-rds-s3.ps1" -DbInstanceIdentifier $DbInstanceIdentifier -BucketName $BucketName
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Configuration Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$envPath = Join-Path $PSScriptRoot "..\backend\.env"
$envExamplePath = Join-Path $PSScriptRoot "..\env.example"

if (-not (Test-Path $envPath)) {
    Write-Host "Creating backend/.env file from template..." -ForegroundColor Yellow
    Copy-Item $envExamplePath $envPath
    Write-Host "✓ Created backend/.env" -ForegroundColor Green
}

if ($rdsExists -and $rdsEndpoint -and $rdsStatus -eq "available") {
    Write-Host "RDS Configuration:" -ForegroundColor Yellow
    Write-Host "  Endpoint: $rdsEndpoint" -ForegroundColor White
    Write-Host "  Port: $rdsPort" -ForegroundColor White
    Write-Host ""
    Write-Host "Update backend/.env with:" -ForegroundColor Yellow
    Write-Host "  DATABASE_URL=postgresql://vidverse_admin:YOUR_PASSWORD@$rdsEndpoint`:$rdsPort/vidverse" -ForegroundColor White
    Write-Host ""
    Write-Host "Don't forget to:" -ForegroundColor Yellow
    Write-Host "  1. Replace YOUR_PASSWORD with your actual database password" -ForegroundColor White
    Write-Host "  2. Run migrations: psql -h $rdsEndpoint -U vidverse_admin -d vidverse -f migrations/001_initial_schema.sql" -ForegroundColor White
}

if ($bucketExists) {
    Write-Host "S3 Configuration:" -ForegroundColor Yellow
    Write-Host "  Bucket: $BucketName" -ForegroundColor White
    Write-Host "  Region: $Region" -ForegroundColor White
    Write-Host ""
    Write-Host "Update backend/.env with:" -ForegroundColor Yellow
    Write-Host "  S3_BUCKET_NAME=$BucketName" -ForegroundColor White
    Write-Host "  S3_REGION=$Region" -ForegroundColor White
    Write-Host ""
    Write-Host "You also need to:" -ForegroundColor Yellow
    Write-Host "  1. Create IAM user with S3 access" -ForegroundColor White
    Write-Host "  2. Add S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY to backend/.env" -ForegroundColor White
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan


