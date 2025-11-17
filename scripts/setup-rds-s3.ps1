# VidVerse AWS RDS & S3 Setup Script for us-west-2
# This script sets up PostgreSQL RDS and S3 bucket in us-west-2 region

param(
    [string]$Region = "us-west-2",
    [string]$DbInstanceIdentifier = "vidverse",
    [string]$DbUsername = "vidverse_admin",
    [string]$DbPassword = "",
    [string]$BucketName = "vidverse-assets",
    [string]$AwsAccountId = ""
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VidVerse AWS Setup - us-west-2" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if AWS CLI is installed
Write-Host "Checking AWS CLI..." -ForegroundColor Yellow
try {
    $awsVersion = aws --version 2>&1
    Write-Host "✓ AWS CLI found: $awsVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ AWS CLI not found. Please install from https://aws.amazon.com/cli/" -ForegroundColor Red
    exit 1
}

# Check AWS credentials
Write-Host "Checking AWS credentials..." -ForegroundColor Yellow
try {
    $identity = aws sts get-caller-identity --region $Region 2>&1 | ConvertFrom-Json
    Write-Host "✓ AWS credentials valid" -ForegroundColor Green
    Write-Host "  Account: $($identity.Account)" -ForegroundColor Gray
    Write-Host "  User/Role: $($identity.Arn)" -ForegroundColor Gray
    
    if (-not $AwsAccountId) {
        $AwsAccountId = $identity.Account
    }
} catch {
    Write-Host "✗ AWS credentials not configured. Run 'aws configure'" -ForegroundColor Red
    exit 1
}

Write-Host ""

# ============================================
# S3 BUCKET SETUP
# ============================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setting up S3 Bucket" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if bucket already exists
Write-Host "Checking if bucket '$BucketName' exists..." -ForegroundColor Yellow
$bucketExists = $false
try {
    aws s3api head-bucket --bucket $BucketName --region $Region 2>&1 | Out-Null
    $bucketExists = $true
    Write-Host "✓ Bucket '$BucketName' already exists" -ForegroundColor Green
} catch {
    Write-Host "  Bucket does not exist, will create it..." -ForegroundColor Gray
}

if (-not $bucketExists) {
    Write-Host "Creating S3 bucket '$BucketName' in $Region..." -ForegroundColor Yellow
    
    # Create bucket
    if ($Region -eq "us-east-1") {
        # us-east-1 doesn't need LocationConstraint
        aws s3api create-bucket --bucket $BucketName --region $Region 2>&1 | Out-Null
    } else {
        $locationConstraint = @{LocationConstraint = $Region} | ConvertTo-Json -Compress
        aws s3api create-bucket `
            --bucket $BucketName `
            --region $Region `
            --create-bucket-configuration $locationConstraint 2>&1 | Out-Null
    }
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Bucket created successfully" -ForegroundColor Green
    } else {
        Write-Host "✗ Failed to create bucket" -ForegroundColor Red
        exit 1
    }
}

# Apply bucket policy
Write-Host "Applying bucket policy..." -ForegroundColor Yellow
$bucketPolicyPath = Join-Path $PSScriptRoot "..\s3-bucket-policy.json"
if (Test-Path $bucketPolicyPath) {
    # Update bucket name in policy if needed
    $policyContent = Get-Content $bucketPolicyPath -Raw | ConvertFrom-Json
    $policyContent.Statement[0].Resource = "arn:aws:s3:::$BucketName/*"
    $policyContent.Statement[1].Resource = "arn:aws:s3:::$BucketName/*"
    $policyContent.Statement[1].Principal.AWS = "arn:aws:iam::${AwsAccountId}:root"
    
    $tempPolicy = [System.IO.Path]::GetTempFileName()
    $policyContent | ConvertTo-Json -Depth 10 | Set-Content $tempPolicy
    
    aws s3api put-bucket-policy --bucket $BucketName --policy "file://$tempPolicy" --region $Region 2>&1 | Out-Null
    Remove-Item $tempPolicy
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Bucket policy applied" -ForegroundColor Green
    } else {
        Write-Host "⚠ Failed to apply bucket policy (may need manual setup)" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠ Bucket policy file not found at $bucketPolicyPath" -ForegroundColor Yellow
}

# Apply CORS configuration
Write-Host "Applying CORS configuration..." -ForegroundColor Yellow
$corsConfigPath = Join-Path $PSScriptRoot "..\s3-cors-config.json"
if (Test-Path $corsConfigPath) {
    aws s3api put-bucket-cors --bucket $BucketName --cors-configuration "file://$corsConfigPath" --region $Region 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ CORS configuration applied" -ForegroundColor Green
    } else {
        Write-Host "⚠ Failed to apply CORS configuration" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠ CORS config file not found at $corsConfigPath" -ForegroundColor Yellow
}

# Apply lifecycle configuration
Write-Host "Applying lifecycle configuration..." -ForegroundColor Yellow
$lifecycleConfigPath = Join-Path $PSScriptRoot "..\s3-lifecycle-config.json"
if (Test-Path $lifecycleConfigPath) {
    aws s3api put-bucket-lifecycle-configuration --bucket $BucketName --lifecycle-configuration "file://$lifecycleConfigPath" --region $Region 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Lifecycle configuration applied" -ForegroundColor Green
    } else {
        Write-Host "⚠ Failed to apply lifecycle configuration" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠ Lifecycle config file not found at $lifecycleConfigPath" -ForegroundColor Yellow
}

# Disable block public access (needed for public reads)
Write-Host "Configuring public access settings..." -ForegroundColor Yellow
aws s3api put-public-access-block `
    --bucket $BucketName `
    --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false" `
    --region $Region 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Public access configured" -ForegroundColor Green
} else {
    Write-Host "⚠ Failed to configure public access" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✓ S3 bucket setup complete!" -ForegroundColor Green
Write-Host "  Bucket: $BucketName" -ForegroundColor Gray
Write-Host "  Region: $Region" -ForegroundColor Gray
Write-Host "  URL: https://$BucketName.s3.$Region.amazonaws.com" -ForegroundColor Gray
Write-Host ""

# ============================================
# RDS SETUP
# ============================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setting up RDS PostgreSQL" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if RDS instance already exists
Write-Host "Checking if RDS instance '$DbInstanceIdentifier' exists..." -ForegroundColor Yellow
$rdsExists = $false
try {
    $rdsInfo = aws rds describe-db-instances --db-instance-identifier $DbInstanceIdentifier --region $Region 2>&1 | ConvertFrom-Json
    if ($rdsInfo.DBInstances) {
        $rdsExists = $true
        $instance = $rdsInfo.DBInstances[0]
        Write-Host "✓ RDS instance already exists" -ForegroundColor Green
        Write-Host "  Status: $($instance.DBInstanceStatus)" -ForegroundColor Gray
        Write-Host "  Endpoint: $($instance.Endpoint.Address)" -ForegroundColor Gray
        Write-Host "  Port: $($instance.Endpoint.Port)" -ForegroundColor Gray
    }
} catch {
    Write-Host "  RDS instance does not exist, will create it..." -ForegroundColor Gray
}

if (-not $rdsExists) {
    if (-not $DbPassword) {
        Write-Host "Database password is required to create RDS instance." -ForegroundColor Yellow
        $securePassword = Read-Host "Enter database master password" -AsSecureString
        $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        $DbPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    }
    
    Write-Host "Creating RDS PostgreSQL instance..." -ForegroundColor Yellow
    Write-Host "  Instance ID: $DbInstanceIdentifier" -ForegroundColor Gray
    Write-Host "  Username: $DbUsername" -ForegroundColor Gray
    Write-Host "  Region: $Region" -ForegroundColor Gray
    Write-Host ""
    Write-Host "This will take 5-10 minutes. Please wait..." -ForegroundColor Yellow
    
    # Get default VPC and security group
    Write-Host "Getting default VPC information..." -ForegroundColor Yellow
    $vpcs = aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --region $Region 2>&1 | ConvertFrom-Json
    if (-not $vpcs.Vpcs -or $vpcs.Vpcs.Count -eq 0) {
        Write-Host "✗ No default VPC found. Please create RDS manually via console." -ForegroundColor Red
        exit 1
    }
    $vpcId = $vpcs.Vpcs[0].VpcId
    Write-Host "  Using VPC: $vpcId" -ForegroundColor Gray
    
    # Create security group for RDS
    $sgName = "vidverse-rds-sg"
    Write-Host "Creating security group..." -ForegroundColor Yellow
    try {
        $sg = aws ec2 create-security-group `
            --group-name $sgName `
            --description "Security group for VidVerse RDS" `
            --vpc-id $vpcId `
            --region $Region 2>&1 | ConvertFrom-Json
        $sgId = $sg.GroupId
        Write-Host "✓ Security group created: $sgId" -ForegroundColor Green
    } catch {
        # Security group might already exist
        $existingSg = aws ec2 describe-security-groups --filters "Name=group-name,Values=$sgName" "Name=vpc-id,Values=$vpcId" --region $Region 2>&1 | ConvertFrom-Json
        if ($existingSg.SecurityGroups) {
            $sgId = $existingSg.SecurityGroups[0].GroupId
            Write-Host "✓ Using existing security group: $sgId" -ForegroundColor Green
        } else {
            Write-Host "✗ Failed to create/get security group" -ForegroundColor Red
            exit 1
        }
    }
    
    # Add inbound rule for PostgreSQL (you'll need to update this with your IP)
    Write-Host "Adding PostgreSQL inbound rule (0.0.0.0/0 - UPDATE THIS!)..." -ForegroundColor Yellow
    aws ec2 authorize-security-group-ingress `
        --group-id $sgId `
        --protocol tcp `
        --port 5432 `
        --cidr 0.0.0.0/0 `
        --region $Region 2>&1 | Out-Null
    Write-Host "⚠ WARNING: Security group allows all IPs. Update this with your IP!" -ForegroundColor Yellow
    
    # Create RDS instance
    Write-Host "Creating RDS instance (this takes 5-10 minutes)..." -ForegroundColor Yellow
    aws rds create-db-instance `
        --db-instance-identifier $DbInstanceIdentifier `
        --db-instance-class db.t3.micro `
        --engine postgres `
        --engine-version 15.4 `
        --master-username $DbUsername `
        --master-user-password $DbPassword `
        --allocated-storage 20 `
        --storage-type gp3 `
        --vpc-security-group-ids $sgId `
        --publicly-accessible `
        --db-name vidverse `
        --backup-retention-period 7 `
        --region $Region 2>&1 | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ RDS instance creation started" -ForegroundColor Green
        Write-Host "  Waiting for instance to be available (this may take 5-10 minutes)..." -ForegroundColor Yellow
        
        # Wait for instance to be available
        aws rds wait db-instance-available `
            --db-instance-identifier $DbInstanceIdentifier `
            --region $Region
        
        Write-Host "✓ RDS instance is now available!" -ForegroundColor Green
    } else {
        Write-Host "✗ Failed to create RDS instance" -ForegroundColor Red
        exit 1
    }
}

# Get RDS endpoint
Write-Host "Getting RDS endpoint..." -ForegroundColor Yellow
$rdsInfo = aws rds describe-db-instances --db-instance-identifier $DbInstanceIdentifier --region $Region 2>&1 | ConvertFrom-Json
$endpoint = $rdsInfo.DBInstances[0].Endpoint.Address
$port = $rdsInfo.DBInstances[0].Endpoint.Port

Write-Host ""
Write-Host "✓ RDS setup complete!" -ForegroundColor Green
Write-Host "  Endpoint: $endpoint" -ForegroundColor Gray
Write-Host "  Port: $port" -ForegroundColor Gray
Write-Host "  Database: vidverse" -ForegroundColor Gray
Write-Host "  Username: $DbUsername" -ForegroundColor Gray
Write-Host ""

# ============================================
# SUMMARY
# ============================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setup Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "S3 Bucket:" -ForegroundColor Yellow
Write-Host "  Name: $BucketName" -ForegroundColor White
Write-Host "  Region: $Region" -ForegroundColor White
Write-Host "  URL: https://$BucketName.s3.$Region.amazonaws.com" -ForegroundColor White
Write-Host ""

Write-Host "RDS Database:" -ForegroundColor Yellow
Write-Host "  Endpoint: $endpoint" -ForegroundColor White
Write-Host "  Port: $port" -ForegroundColor White
Write-Host "  Database: vidverse" -ForegroundColor White
Write-Host "  Username: $DbUsername" -ForegroundColor White
Write-Host ""

Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Update your .env file with the RDS connection string:" -ForegroundColor White
Write-Host "   DATABASE_URL=postgresql://$DbUsername`:YOUR_PASSWORD@$endpoint`:$port/vidverse" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Update your .env file with S3 credentials:" -ForegroundColor White
Write-Host "   S3_BUCKET_NAME=$BucketName" -ForegroundColor Gray
Write-Host "   S3_REGION=$Region" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Create IAM user for S3 access and add credentials to .env:" -ForegroundColor White
Write-Host "   S3_ACCESS_KEY_ID=your-access-key" -ForegroundColor Gray
Write-Host "   S3_SECRET_ACCESS_KEY=your-secret-key" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Update RDS security group to allow only your IP address" -ForegroundColor White
Write-Host ""
Write-Host "5. Run database migrations:" -ForegroundColor White
Write-Host "   psql -h $endpoint -U $DbUsername -d vidverse -f migrations/001_initial_schema.sql" -ForegroundColor Gray
Write-Host ""

Write-Host "✓ Setup complete!" -ForegroundColor Green

