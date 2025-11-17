# PowerShell script to set up AWS ElastiCache Redis for VidVerse
# This script creates an ElastiCache Redis cluster for job queue management

param(
    [string]$ClusterName = "vidverse-redis",
    [string]$NodeType = "cache.t3.micro",  # Free tier eligible
    [int]$NumNodes = 1,
    [string]$SubnetGroupName = "vidverse-redis-subnet-group",
    [string]$SecurityGroupName = "vidverse-redis-sg",
    [string]$VpcId = "",
    [string]$Region = "us-west-2"
)

Write-Host "Setting up AWS ElastiCache Redis for VidVerse..." -ForegroundColor Cyan

# Check if AWS CLI is installed
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: AWS CLI is not installed. Please install it first." -ForegroundColor Red
    exit 1
}

# Check AWS credentials
try {
    $identity = aws sts get-caller-identity 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: AWS credentials not configured. Run 'aws configure' first." -ForegroundColor Red
        exit 1
    }
    Write-Host "AWS Identity: $identity" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to verify AWS credentials." -ForegroundColor Red
    exit 1
}

# Get VPC ID if not provided
if ([string]::IsNullOrEmpty($VpcId)) {
    Write-Host "Finding default VPC..." -ForegroundColor Yellow
    $vpcInfo = aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text --region $Region
    if ($vpcInfo -and $vpcInfo -ne "None") {
        $VpcId = $vpcInfo
        Write-Host "Found default VPC: $VpcId" -ForegroundColor Green
    } else {
        Write-Host "ERROR: No default VPC found. Please specify VpcId parameter." -ForegroundColor Red
        exit 1
    }
}

# Get VPC CIDR for security group rule
$vpcCidr = aws ec2 describe-vpcs --vpc-ids $VpcId --query "Vpcs[0].CidrBlock" --output text --region $Region
Write-Host "VPC CIDR: $vpcCidr" -ForegroundColor Green

# Get subnet IDs in the VPC
Write-Host "Finding subnets in VPC..." -ForegroundColor Yellow
$subnets = aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VpcId" --query "Subnets[*].SubnetId" --output text --region $Region
$subnetArray = $subnets -split "`t"

if ($subnetArray.Count -lt 2) {
    Write-Host "WARNING: ElastiCache requires at least 2 subnets in different AZs. Found: $($subnetArray.Count)" -ForegroundColor Yellow
}

# Create security group for Redis
Write-Host "Creating security group for Redis..." -ForegroundColor Yellow
$sgExists = aws ec2 describe-security-groups --filters "Name=group-name,Values=$SecurityGroupName" --query "SecurityGroups[0].GroupId" --output text --region $Region

if ($sgExists -and $sgExists -ne "None") {
    Write-Host "Security group already exists: $sgExists" -ForegroundColor Green
    $SecurityGroupId = $sgExists
} else {
    $sgResult = aws ec2 create-security-group `
        --group-name $SecurityGroupName `
        --description "Security group for VidVerse ElastiCache Redis" `
        --vpc-id $VpcId `
        --region $Region `
        --output json
    
    $SecurityGroupId = ($sgResult | ConvertFrom-Json).GroupId
    Write-Host "Created security group: $SecurityGroupId" -ForegroundColor Green
    
    # Add inbound rule for Redis (port 6379) from VPC
    Write-Host "Adding inbound rule for Redis (port 6379) from VPC..." -ForegroundColor Yellow
    aws ec2 authorize-security-group-ingress `
        --group-id $SecurityGroupId `
        --protocol tcp `
        --port 6379 `
        --cidr $vpcCidr `
        --region $Region | Out-Null
    
    Write-Host "Security group configured" -ForegroundColor Green
}

# Create subnet group
Write-Host "Creating ElastiCache subnet group..." -ForegroundColor Yellow
$subnetGroupExists = aws elasticache describe-cache-subnet-groups --cache-subnet-group-name $SubnetGroupName --region $Region 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "Subnet group already exists: $SubnetGroupName" -ForegroundColor Green
} else {
    $subnetIds = $subnetArray[0..1] -join ","
    aws elasticache create-cache-subnet-group `
        --cache-subnet-group-name $SubnetGroupName `
        --cache-subnet-group-description "Subnet group for VidVerse Redis" `
        --subnet-ids $subnetIds `
        --region $Region | Out-Null
    
    Write-Host "Created subnet group: $SubnetGroupName" -ForegroundColor Green
}

# Create ElastiCache Redis cluster
Write-Host "Creating ElastiCache Redis cluster..." -ForegroundColor Yellow
$clusterExists = aws elasticache describe-cache-clusters --cache-cluster-id $ClusterName --region $Region 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "Redis cluster already exists: $ClusterName" -ForegroundColor Green
    $clusterInfo = aws elasticache describe-cache-clusters --cache-cluster-id $ClusterName --show-cache-node-info --region $Region --output json | ConvertFrom-Json
    $endpoint = $clusterInfo.CacheClusters[0].CacheNodes[0].Endpoint.Address
    $port = $clusterInfo.CacheClusters[0].CacheNodes[0].Endpoint.Port
} else {
    Write-Host "Creating new Redis cluster (this may take 5-10 minutes)..." -ForegroundColor Yellow
    $createResult = aws elasticache create-cache-cluster `
        --cache-cluster-id $ClusterName `
        --cache-node-type $NodeType `
        --engine redis `
        --num-cache-nodes $NumNodes `
        --cache-subnet-group-name $SubnetGroupName `
        --security-group-ids $SecurityGroupId `
        --region $Region `
        --output json
    
    Write-Host "Redis cluster creation initiated. Waiting for it to become available..." -ForegroundColor Yellow
    Write-Host "This may take 5-10 minutes. You can check status with:" -ForegroundColor Yellow
    Write-Host "  aws elasticache describe-cache-clusters --cache-cluster-id $ClusterName --region $Region" -ForegroundColor Cyan
    
    # Wait for cluster to become available
    $maxWait = 600  # 10 minutes
    $waited = 0
    do {
        Start-Sleep -Seconds 30
        $waited += 30
        $status = aws elasticache describe-cache-clusters --cache-cluster-id $ClusterName --show-cache-node-info --region $Region --query "CacheClusters[0].CacheClusterStatus" --output text
        Write-Host "  Status: $status (waited $waited seconds)" -ForegroundColor Yellow
    } while ($status -ne "available" -and $waited -lt $maxWait)
    
    if ($status -eq "available") {
        $clusterInfo = aws elasticache describe-cache-clusters --cache-cluster-id $ClusterName --show-cache-node-info --region $Region --output json | ConvertFrom-Json
        $endpoint = $clusterInfo.CacheClusters[0].CacheNodes[0].Endpoint.Address
        $port = $clusterInfo.CacheClusters[0].CacheNodes[0].Endpoint.Port
        Write-Host "Redis cluster is now available!" -ForegroundColor Green
    } else {
        Write-Host "ERROR: Redis cluster did not become available in time. Check AWS Console." -ForegroundColor Red
        exit 1
    }
}

# Display connection information
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Redis Cluster Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Cluster Name: $ClusterName" -ForegroundColor White
Write-Host "Endpoint: $endpoint" -ForegroundColor White
Write-Host "Port: $port" -ForegroundColor White
Write-Host "`nAdd this to your backend/.env file:" -ForegroundColor Yellow
Write-Host "ENABLE_REDIS=true" -ForegroundColor Cyan
Write-Host "REDIS_URL=redis://$endpoint`:$port" -ForegroundColor Cyan
Write-Host "`nNote: If your ElastiCache cluster has AUTH enabled, use:" -ForegroundColor Yellow
Write-Host "REDIS_URL=redis://:your-auth-token@$endpoint`:$port" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

