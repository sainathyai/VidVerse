# VidVerse AWS Resources Verification Script
# Checks the status of RDS and S3 resources in us-west-2

param(
    [string]$Region = "us-west-2",
    [string]$DbInstanceIdentifier = "vidverse",
    [string]$BucketName = "vidverse-assets"
)

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VidVerse AWS Resources Status Check" -ForegroundColor Cyan
Write-Host "Region: $Region" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check AWS CLI
try {
    $awsVersion = aws --version 2>&1
    Write-Host "✓ AWS CLI: $awsVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ AWS CLI not found" -ForegroundColor Red
    exit 1
}

# Check AWS credentials
try {
    $identity = aws sts get-caller-identity --region $Region 2>&1 | ConvertFrom-Json
    Write-Host "✓ AWS Account: $($identity.Account)" -ForegroundColor Green
} catch {
    Write-Host "✗ AWS credentials not configured" -ForegroundColor Red
    exit 1
}

Write-Host ""

# ============================================
# S3 BUCKET STATUS
# ============================================
Write-Host "S3 Bucket Status:" -ForegroundColor Yellow
Write-Host "-----------------" -ForegroundColor Yellow

try {
    $bucketInfo = aws s3api head-bucket --bucket $BucketName --region $Region 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Bucket exists: $BucketName" -ForegroundColor Green
        
        # Get bucket location
        try {
            $location = aws s3api get-bucket-location --bucket $BucketName --region $Region 2>&1 | ConvertFrom-Json
            $bucketRegion = if ($location.LocationConstraint) { $location.LocationConstraint } else { "us-east-1" }
            Write-Host "  Region: $bucketRegion" -ForegroundColor Gray
        } catch {
            Write-Host "  Region: Could not determine" -ForegroundColor Gray
        }
        
        # Check bucket policy
        try {
            $policy = aws s3api get-bucket-policy --bucket $BucketName --region $Region 2>&1 | ConvertFrom-Json
            Write-Host "  ✓ Bucket policy configured" -ForegroundColor Green
        } catch {
            Write-Host "  ⚠ No bucket policy found" -ForegroundColor Yellow
        }
        
        # Check CORS
        try {
            $cors = aws s3api get-bucket-cors --bucket $BucketName --region $Region 2>&1 | ConvertFrom-Json
            Write-Host "  ✓ CORS configuration found" -ForegroundColor Green
        } catch {
            Write-Host "  ⚠ No CORS configuration found" -ForegroundColor Yellow
        }
        
        # Check public access block
        try {
            $publicAccess = aws s3api get-public-access-block --bucket $BucketName --region $Region 2>&1 | ConvertFrom-Json
            $blocked = $publicAccess.PublicAccessBlockConfiguration
            if ($blocked.BlockPublicAcls -or $blocked.BlockPublicPolicy -or $blocked.RestrictPublicBuckets) {
                Write-Host "  ⚠ Public access is blocked (may need to allow for public reads)" -ForegroundColor Yellow
            } else {
                Write-Host "  ✓ Public access allowed" -ForegroundColor Green
            }
        } catch {
            Write-Host "  ⚠ Could not check public access settings" -ForegroundColor Yellow
        }
        
        Write-Host "  URL: https://$BucketName.s3.$Region.amazonaws.com" -ForegroundColor Gray
    }
} catch {
    Write-Host "✗ Bucket does not exist: $BucketName" -ForegroundColor Red
    Write-Host "  Run setup-rds-s3.ps1 to create it" -ForegroundColor Gray
}

Write-Host ""

# ============================================
# RDS STATUS
# ============================================
Write-Host "RDS Database Status:" -ForegroundColor Yellow
Write-Host "-------------------" -ForegroundColor Yellow

try {
    $rdsInfo = aws rds describe-db-instances --db-instance-identifier $DbInstanceIdentifier --region $Region 2>&1 | ConvertFrom-Json
    if ($rdsInfo.DBInstances) {
        $instance = $rdsInfo.DBInstances[0]
        Write-Host "✓ RDS instance exists: $DbInstanceIdentifier" -ForegroundColor Green
        Write-Host "  Status: $($instance.DBInstanceStatus)" -ForegroundColor Gray
        Write-Host "  Engine: $($instance.Engine) $($instance.EngineVersion)" -ForegroundColor Gray
        Write-Host "  Instance Class: $($instance.DBInstanceClass)" -ForegroundColor Gray
        Write-Host "  Endpoint: $($instance.Endpoint.Address)" -ForegroundColor Gray
        Write-Host "  Port: $($instance.Endpoint.Port)" -ForegroundColor Gray
        Write-Host "  Database: $($instance.DBName)" -ForegroundColor Gray
        Write-Host "  Publicly Accessible: $($instance.PubliclyAccessible)" -ForegroundColor Gray
        
        # Check security groups
        if ($instance.VpcSecurityGroups) {
            Write-Host "  Security Groups:" -ForegroundColor Gray
            foreach ($sg in $instance.VpcSecurityGroups) {
                Write-Host "    - $($sg.VpcSecurityGroupId) ($($sg.Status))" -ForegroundColor Gray
            }
        }
        
        if ($instance.DBInstanceStatus -eq "available") {
            Write-Host "  ✓ Instance is available and ready to use" -ForegroundColor Green
        } else {
            Write-Host "  ⚠ Instance status: $($instance.DBInstanceStatus)" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "✗ RDS instance does not exist: $DbInstanceIdentifier" -ForegroundColor Red
    Write-Host "  Run setup-rds-s3.ps1 to create it" -ForegroundColor Gray
}

Write-Host ""

# ============================================
# CONFIGURATION CHECK
# ============================================
Write-Host "Configuration Check:" -ForegroundColor Yellow
Write-Host "-------------------" -ForegroundColor Yellow

$envFile = Join-Path $PSScriptRoot "..\backend\.env"
if (Test-Path $envFile) {
    Write-Host "✓ Backend .env file exists" -ForegroundColor Green
    
    $envContent = Get-Content $envFile -Raw
    if ($envContent -match "DATABASE_URL") {
        Write-Host "  ✓ DATABASE_URL is configured" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ DATABASE_URL not found in .env" -ForegroundColor Yellow
    }
    
    if ($envContent -match "S3_BUCKET_NAME") {
        Write-Host "  ✓ S3_BUCKET_NAME is configured" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ S3_BUCKET_NAME not found in .env" -ForegroundColor Yellow
    }
    
    if ($envContent -match "S3_ACCESS_KEY_ID") {
        Write-Host "  ✓ S3_ACCESS_KEY_ID is configured" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ S3_ACCESS_KEY_ID not found in .env" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠ Backend .env file not found at $envFile" -ForegroundColor Yellow
    Write-Host "  Copy env.example to backend/.env and configure it" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Verification Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

