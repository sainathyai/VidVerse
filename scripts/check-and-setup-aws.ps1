# Quick AWS Resources Check and Setup Helper
param(
    [string]$Region = "us-west-2",
    [string]$DbInstanceIdentifier = "vidverse",
    [string]$BucketName = "vidverse-assets"
)

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VidVerse AWS Resources Check" -ForegroundColor Cyan
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
Write-Host "Checking S3 Bucket: $BucketName" -ForegroundColor Yellow
$bucketExists = $false
try {
    $result = aws s3api head-bucket --bucket $BucketName --region $Region 2>&1
    if ($LASTEXITCODE -eq 0) {
        $bucketExists = $true
        Write-Host "✓ S3 bucket exists: $BucketName" -ForegroundColor Green
    }
} catch {
    Write-Host "✗ S3 bucket does not exist: $BucketName" -ForegroundColor Red
}

if (-not $bucketExists) {
    Write-Host ""
    Write-Host "To create S3 bucket, run:" -ForegroundColor Yellow
    Write-Host "  .\scripts\setup-rds-s3.ps1 -BucketName $BucketName" -ForegroundColor Gray
}

Write-Host ""

# Check RDS Instance
Write-Host "Checking RDS Instance: $DbInstanceIdentifier" -ForegroundColor Yellow
$rdsExists = $false
$rdsEndpoint = ""
$rdsPort = 5432

try {
    $rdsInfo = aws rds describe-db-instances --db-instance-identifier $DbInstanceIdentifier --region $Region 2>&1 | ConvertFrom-Json
    if ($rdsInfo.DBInstances -and $rdsInfo.DBInstances.Count -gt 0) {
        $instance = $rdsInfo.DBInstances[0]
        $rdsExists = $true
        $rdsEndpoint = $instance.Endpoint.Address
        $rdsPort = $instance.Endpoint.Port
        
        Write-Host "✓ RDS instance exists: $DbInstanceIdentifier" -ForegroundColor Green
        Write-Host "  Status: $($instance.DBInstanceStatus)" -ForegroundColor Gray
        Write-Host "  Endpoint: $rdsEndpoint" -ForegroundColor Gray
        Write-Host "  Port: $rdsPort" -ForegroundColor Gray
        
        if ($instance.DBInstanceStatus -ne "available") {
            Write-Host "  ⚠ Instance is not available yet. Status: $($instance.DBInstanceStatus)" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "✗ RDS instance does not exist: $DbInstanceIdentifier" -ForegroundColor Red
}

if (-not $rdsExists) {
    Write-Host ""
    Write-Host "To create RDS instance, run:" -ForegroundColor Yellow
    Write-Host "  .\scripts\setup-rds-s3.ps1 -DbInstanceIdentifier $DbInstanceIdentifier" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Configuration Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($rdsExists -and $rdsEndpoint) {
    Write-Host "RDS Connection String:" -ForegroundColor Yellow
    Write-Host "  DATABASE_URL=postgresql://vidverse_admin:YOUR_PASSWORD@$rdsEndpoint`:$rdsPort/vidverse" -ForegroundColor White
    Write-Host ""
}

if ($bucketExists) {
    Write-Host "S3 Configuration:" -ForegroundColor Yellow
    Write-Host "  S3_BUCKET_NAME=$BucketName" -ForegroundColor White
    Write-Host "  S3_REGION=$Region" -ForegroundColor White
    Write-Host ""
}

Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. If resources don't exist, run: .\scripts\setup-rds-s3.ps1" -ForegroundColor White
Write-Host "2. Update backend/.env with the connection strings above" -ForegroundColor White
Write-Host "3. Run database migrations if RDS is new" -ForegroundColor White
Write-Host ""


