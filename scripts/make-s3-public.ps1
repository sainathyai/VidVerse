# PowerShell script to make S3 bucket public using AWS CLI
# Usage: .\make-s3-public.ps1 [bucket-name] [region]

param(
    [string]$BucketName = "vidverse-assets",
    [string]$Region = "us-west-2"
)

Write-Host "Making S3 bucket '$BucketName' public..." -ForegroundColor Cyan

# Step 1: Disable Block Public Access
Write-Host "`nStep 1: Disabling block public access..." -ForegroundColor Yellow
$publicAccessBlock = @{
    BlockPublicAcls = $false
    IgnorePublicAcls = $false
    BlockPublicPolicy = $false
    RestrictPublicBuckets = $false
} | ConvertTo-Json

try {
    aws s3api put-public-access-block `
        --bucket $BucketName `
        --public-access-block-configuration $publicAccessBlock
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Block public access disabled" -ForegroundColor Green
    } else {
        Write-Host "✗ Failed to disable block public access" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
    exit 1
}

# Step 2: Apply bucket policy
Write-Host "`nStep 2: Applying bucket policy..." -ForegroundColor Yellow
$policyPath = Join-Path $PSScriptRoot "..\s3-bucket-policy.json"
$policyPath = Resolve-Path $policyPath

try {
    aws s3api put-bucket-policy `
        --bucket $BucketName `
        --policy "file://$policyPath"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Bucket policy applied" -ForegroundColor Green
    } else {
        Write-Host "✗ Failed to apply bucket policy" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
    exit 1
}

# Step 3: Configure CORS
Write-Host "`nStep 3: Configuring CORS..." -ForegroundColor Yellow
$corsPath = Join-Path $PSScriptRoot "..\s3-cors-config.json"
$corsPath = Resolve-Path $corsPath

try {
    aws s3api put-bucket-cors `
        --bucket $BucketName `
        --cors-configuration "file://$corsPath"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ CORS configured" -ForegroundColor Green
    } else {
        Write-Host "✗ Failed to configure CORS" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`n✅ S3 bucket '$BucketName' is now public!" -ForegroundColor Green
Write-Host "Test with: aws s3 ls s3://$BucketName/" -ForegroundColor Cyan


