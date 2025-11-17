# VidVerse AWS Resources Setup and Configuration
# Checks for existing resources, creates missing ones, and updates .env file

param(
    [string]$Region = "us-west-2",
    [string]$DbInstanceIdentifier = "vidverse",
    [string]$BucketName = "vidverse-assets",
    [string]$DbUsername = "vidverse_admin"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VidVerse AWS Setup & Configuration" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check AWS CLI
try {
    $awsVersion = aws --version 2>&1
    Write-Host "✓ AWS CLI: $awsVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ AWS CLI not found. Install from https://aws.amazon.com/cli/" -ForegroundColor Red
    exit 1
}

# Check AWS credentials
try {
    $identity = aws sts get-caller-identity --region $Region 2>&1 | ConvertFrom-Json
    Write-Host "✓ AWS credentials valid" -ForegroundColor Green
    Write-Host "  Account: $($identity.Account)" -ForegroundColor Gray
    $AwsAccountId = $identity.Account
} catch {
    Write-Host "✗ AWS credentials not configured. Run 'aws configure'" -ForegroundColor Red
    exit 1
}

Write-Host ""

# ============================================
# S3 BUCKET SETUP
# ============================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "S3 Bucket Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$bucketExists = $false
try {
    $result = aws s3api head-bucket --bucket $BucketName --region $Region 2>&1
    if ($LASTEXITCODE -eq 0) {
        $bucketExists = $true
        Write-Host "✓ S3 bucket exists: $BucketName" -ForegroundColor Green
    }
} catch {
    Write-Host "S3 bucket does not exist, creating..." -ForegroundColor Yellow
}

if (-not $bucketExists) {
    Write-Host "Creating S3 bucket: $BucketName in $Region..." -ForegroundColor Yellow
    
    if ($Region -eq "us-east-1") {
        aws s3api create-bucket --bucket $BucketName --region $Region 2>&1 | Out-Null
    } else {
        $locationConstraint = @{LocationConstraint = $Region} | ConvertTo-Json -Compress
        aws s3api create-bucket --bucket $BucketName --region $Region --create-bucket-configuration $locationConstraint 2>&1 | Out-Null
    }
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ S3 bucket created successfully" -ForegroundColor Green
        $bucketExists = $true
        
        # Apply CORS if config exists
        $corsConfigPath = Join-Path $PSScriptRoot "..\s3-cors-config.json"
        if (Test-Path $corsConfigPath) {
            Write-Host "Applying CORS configuration..." -ForegroundColor Yellow
            aws s3api put-bucket-cors --bucket $BucketName --cors-configuration "file://$corsConfigPath" --region $Region 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✓ CORS configuration applied" -ForegroundColor Green
            }
        }
    } else {
        Write-Host "✗ Failed to create S3 bucket" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""

# ============================================
# RDS SETUP
# ============================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "RDS Database Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

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
        Write-Host "  Port: $rdsPort" -ForegroundColor Gray
        
        if ($rdsStatus -ne "available") {
            Write-Host "  ⚠ Instance is not available yet. Status: $rdsStatus" -ForegroundColor Yellow
            Write-Host "  Please wait for instance to become available, then run this script again." -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "RDS instance does not exist, creating..." -ForegroundColor Yellow
    
    # Get password
    $securePassword = Read-Host "Enter database master password" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $DbPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    
    # Get default VPC
    Write-Host "Getting default VPC..." -ForegroundColor Yellow
    $vpcs = aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --region $Region 2>&1 | ConvertFrom-Json
    if (-not $vpcs.Vpcs -or $vpcs.Vpcs.Count -eq 0) {
        Write-Host "✗ No default VPC found. Please create RDS manually via console." -ForegroundColor Red
        exit 1
    }
    $vpcId = $vpcs.Vpcs[0].VpcId
    Write-Host "  Using VPC: $vpcId" -ForegroundColor Gray
    
    # Create or get security group
    $sgName = "vidverse-rds-sg"
    Write-Host "Setting up security group..." -ForegroundColor Yellow
    try {
        $sg = aws ec2 create-security-group --group-name $sgName --description "Security group for VidVerse RDS" --vpc-id $vpcId --region $Region 2>&1 | ConvertFrom-Json
        $sgId = $sg.GroupId
        Write-Host "  ✓ Security group created: $sgId" -ForegroundColor Green
    } catch {
        $existingSg = aws ec2 describe-security-groups --filters "Name=group-name,Values=$sgName" "Name=vpc-id,Values=$vpcId" --region $Region 2>&1 | ConvertFrom-Json
        if ($existingSg.SecurityGroups) {
            $sgId = $existingSg.SecurityGroups[0].GroupId
            Write-Host "  ✓ Using existing security group: $sgId" -ForegroundColor Green
        } else {
            Write-Host "  ✗ Failed to create/get security group" -ForegroundColor Red
            exit 1
        }
    }
    
    # Get current IP
    try {
        $myIp = (Invoke-WebRequest -Uri "https://api.ipify.org" -UseBasicParsing).Content
        Write-Host "  Your IP: $myIp" -ForegroundColor Gray
    } catch {
        $myIp = "0.0.0.0/0"
        Write-Host "  ⚠ Could not detect IP, using 0.0.0.0/0 (all IPs)" -ForegroundColor Yellow
    }
    
    # Add inbound rule
    Write-Host "Adding PostgreSQL inbound rule..." -ForegroundColor Yellow
    try {
        aws ec2 authorize-security-group-ingress --group-id $sgId --protocol tcp --port 5432 --cidr "$myIp/32" --region $Region 2>&1 | Out-Null
        Write-Host "  ✓ Inbound rule added for your IP" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠ Rule may already exist or failed to add" -ForegroundColor Yellow
    }
    
    # Create RDS instance
    Write-Host "Creating RDS instance (this takes 5-10 minutes)..." -ForegroundColor Yellow
    Write-Host "  Instance ID: $DbInstanceIdentifier" -ForegroundColor Gray
    Write-Host "  Username: $DbUsername" -ForegroundColor Gray
    
    aws rds create-db-instance `
        --db-instance-identifier $DbInstanceIdentifier `
        --db-instance-class db.t3.micro `
        --engine postgres `
        --engine-version "15.4" `
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
        
        # Wait for instance
        aws rds wait db-instance-available --db-instance-identifier $DbInstanceIdentifier --region $Region
        
        # Get endpoint
        $rdsInfo = aws rds describe-db-instances --db-instance-identifier $DbInstanceIdentifier --region $Region 2>&1 | ConvertFrom-Json
        $instance = $rdsInfo.DBInstances[0]
        $rdsEndpoint = $instance.Endpoint.Address
        $rdsPort = $instance.Endpoint.Port
        $rdsStatus = $instance.DBInstanceStatus
        
        Write-Host "✓ RDS instance is now available!" -ForegroundColor Green
        Write-Host "  Endpoint: $rdsEndpoint" -ForegroundColor Gray
        $rdsExists = $true
    } else {
        Write-Host "✗ Failed to create RDS instance" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""

# ============================================
# UPDATE .ENV FILES
# ============================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Updating Configuration Files" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$backendEnvPath = Join-Path $PSScriptRoot "..\backend\.env"
$rootEnvPath = Join-Path $PSScriptRoot "..\.env"
$envExamplePath = Join-Path $PSScriptRoot "..\env.example"

# Create backend/.env if it doesn't exist
if (-not (Test-Path $backendEnvPath)) {
    Write-Host "Creating backend/.env from template..." -ForegroundColor Yellow
    if (Test-Path $envExamplePath) {
        Copy-Item $envExamplePath $backendEnvPath
        Write-Host "✓ Created backend/.env" -ForegroundColor Green
    } else {
        # Create basic .env file
        @"
# Application
NODE_ENV=development
PORT=3001
FRONTEND_URL=https://vidverseai.com
BACKEND_URL=https://api.vidverseai.com
ALLOWED_ORIGINS=https://vidverseai.com

# Database (AWS RDS PostgreSQL)
DATABASE_URL=

# Redis
REDIS_URL=redis://localhost:6379

# Object Storage (S3)
S3_BUCKET_NAME=
S3_REGION=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_ENDPOINT=

# Authentication - AWS Cognito
COGNITO_USER_POOL_ID=
COGNITO_CLIENT_ID=
AWS_REGION=

# Replicate API
REPLICATE_API_TOKEN=

# FFmpeg
FFMPEG_PATH=ffmpeg
"@ | Set-Content $backendEnvPath
        Write-Host "✓ Created backend/.env" -ForegroundColor Green
    }
}

# Read existing .env file
$envContent = Get-Content $backendEnvPath -Raw

# Update S3 configuration
if ($bucketExists) {
    Write-Host "Updating S3 configuration..." -ForegroundColor Yellow
    
    # Update S3_BUCKET_NAME
    if ($envContent -match "S3_BUCKET_NAME=") {
        $envContent = $envContent -replace "S3_BUCKET_NAME=.*", "S3_BUCKET_NAME=$BucketName"
    } else {
        $envContent += "`nS3_BUCKET_NAME=$BucketName"
    }
    
    # Update S3_REGION
    if ($envContent -match "S3_REGION=") {
        $envContent = $envContent -replace "S3_REGION=.*", "S3_REGION=$Region"
    } else {
        $envContent += "`nS3_REGION=$Region"
    }
    
    # Update S3_ENDPOINT
    $s3Endpoint = "https://s3.$Region.amazonaws.com"
    if ($envContent -match "S3_ENDPOINT=") {
        $envContent = $envContent -replace "S3_ENDPOINT=.*", "S3_ENDPOINT=$s3Endpoint"
    } else {
        $envContent += "`nS3_ENDPOINT=$s3Endpoint"
    }
    
    Write-Host "✓ S3 configuration updated" -ForegroundColor Green
    Write-Host "  Bucket: $BucketName" -ForegroundColor Gray
    Write-Host "  Region: $Region" -ForegroundColor Gray
}

# Update RDS configuration
if ($rdsExists -and $rdsEndpoint -and $rdsStatus -eq "available") {
    Write-Host "Updating RDS configuration..." -ForegroundColor Yellow
    
    # Check if password is already in DATABASE_URL
    $currentDbUrl = ""
    if ($envContent -match "DATABASE_URL=(.+)") {
        $currentDbUrl = $matches[1].Trim()
    }
    
    # Extract password if exists, otherwise prompt
    $dbPassword = ""
    if ($currentDbUrl -and $currentDbUrl -notmatch "YOUR_PASSWORD|xxxxxxxxx") {
        # Try to extract password from existing URL
        if ($currentDbUrl -match "://[^:]+:([^@]+)@") {
            $dbPassword = $matches[1]
            Write-Host "  Using existing password from .env" -ForegroundColor Gray
        }
    }
    
    if (-not $dbPassword) {
        Write-Host "  Database password is needed for connection string" -ForegroundColor Yellow
        $securePassword = Read-Host "Enter database master password" -AsSecureString
        $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        $dbPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    }
    
    # URL encode password if needed
    $encodedPassword = [System.Web.HttpUtility]::UrlEncode($dbPassword)
    
    $databaseUrl = "postgresql://${DbUsername}:${encodedPassword}@${rdsEndpoint}:${rdsPort}/vidverse"
    
    # Update DATABASE_URL
    if ($envContent -match "DATABASE_URL=") {
        $envContent = $envContent -replace "DATABASE_URL=.*", "DATABASE_URL=$databaseUrl"
    } else {
        $envContent += "`nDATABASE_URL=$databaseUrl"
    }
    
    Write-Host "✓ RDS configuration updated" -ForegroundColor Green
    Write-Host "  Endpoint: $rdsEndpoint" -ForegroundColor Gray
    Write-Host "  Port: $rdsPort" -ForegroundColor Gray
}

# Update AWS_REGION
if ($envContent -match "AWS_REGION=") {
    $envContent = $envContent -replace "AWS_REGION=.*", "AWS_REGION=$Region"
} else {
    $envContent += "`nAWS_REGION=$Region"
}

# Write updated content
Set-Content -Path $backendEnvPath -Value $envContent -NoNewline

Write-Host ""
Write-Host "✓ Configuration file updated: backend/.env" -ForegroundColor Green
Write-Host ""

# ============================================
# SUMMARY
# ============================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setup Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($bucketExists) {
    Write-Host "✓ S3 Bucket: $BucketName" -ForegroundColor Green
    Write-Host "  Region: $Region" -ForegroundColor Gray
    Write-Host "  URL: https://$BucketName.s3.$Region.amazonaws.com" -ForegroundColor Gray
    Write-Host ""
}

if ($rdsExists) {
    Write-Host "✓ RDS Database: $DbInstanceIdentifier" -ForegroundColor Green
    Write-Host "  Status: $rdsStatus" -ForegroundColor Gray
    Write-Host "  Endpoint: $rdsEndpoint" -ForegroundColor Gray
    Write-Host "  Port: $rdsPort" -ForegroundColor Gray
    Write-Host ""
    
    if ($rdsStatus -eq "available") {
        Write-Host "Next Steps:" -ForegroundColor Yellow
        Write-Host "1. Run database migrations:" -ForegroundColor White
        Write-Host "   psql -h $rdsEndpoint -U $DbUsername -d vidverse -f migrations/001_initial_schema.sql" -ForegroundColor Gray
        Write-Host ""
        Write-Host "2. Create IAM user for S3 access and add credentials to backend/.env:" -ForegroundColor White
        Write-Host "   S3_ACCESS_KEY_ID=your-access-key" -ForegroundColor Gray
        Write-Host "   S3_SECRET_ACCESS_KEY=your-secret-key" -ForegroundColor Gray
        Write-Host ""
        Write-Host "3. Restart backend server" -ForegroundColor White
    }
}

Write-Host ""
Write-Host "✓ Setup complete! Configuration saved to backend/.env" -ForegroundColor Green


