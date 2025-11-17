# Quick deployment script - runs all steps in sequence
param(
    [Parameter(Mandatory=$false)]
    [string]$Region = "us-west-2",
    
    [Parameter(Mandatory=$false)]
    [string]$VpcId = "",
    
    [Parameter(Mandatory=$false)]
    [string]$CertificateArn = "",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipInfrastructure = $false
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VidVerse Quick Deployment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Setup IAM Roles
Write-Host "Step 1: Setting up IAM roles..." -ForegroundColor Yellow
& "$PSScriptRoot\setup-iam-roles.ps1" -Region $Region
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to setup IAM roles" -ForegroundColor Red
    exit 1
}

# Step 2: Deploy infrastructure (if not skipped)
if (-not $SkipInfrastructure) {
    Write-Host ""
    Write-Host "Step 2: Deploying infrastructure..." -ForegroundColor Yellow
    
    if ([string]::IsNullOrEmpty($VpcId)) {
        Write-Host "Getting default VPC..." -ForegroundColor Yellow
        $VpcId = aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text --region $Region
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty($VpcId)) {
            Write-Host "Error: Could not find VPC. Please specify -VpcId parameter" -ForegroundColor Red
            exit 1
        }
    }
    
    Write-Host "VPC ID: $VpcId" -ForegroundColor Green
    
    # Get subnets
    $subnets = aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VpcId" --query "Subnets[?MapPublicIpOnLaunch==\`true\`].SubnetId" --output text --region $Region
    $subnetArray = $subnets -split '\s+'
    
    if ($subnetArray.Count -lt 2) {
        Write-Host "Error: Need at least 2 public subnets in different AZs" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Subnets: $($subnetArray -join ', ')" -ForegroundColor Green
    
    # Get or prompt for certificate
    if ([string]::IsNullOrEmpty($CertificateArn)) {
        Write-Host ""
        Write-Host "Please provide an ACM Certificate ARN for HTTPS:" -ForegroundColor Yellow
        Write-Host "You can list certificates with: aws acm list-certificates --region $Region" -ForegroundColor Yellow
        $CertificateArn = Read-Host "Certificate ARN"
    }
    
    # Deploy CloudFormation
    $stackName = "vidverse-ecs-infrastructure"
    $subnetParam = $subnetArray -join ','
    
    Write-Host "Deploying CloudFormation stack..." -ForegroundColor Yellow
    aws cloudformation create-stack `
        --stack-name $stackName `
        --template-body file://"$PSScriptRoot\..\infrastructure\cloudformation-ecs.yaml" `
        --parameters `
            ParameterKey=VpcId,ParameterValue=$VpcId `
            ParameterKey=SubnetIds,ParameterValue=$subnetParam `
            ParameterKey=CertificateArn,ParameterValue=$CertificateArn `
        --capabilities CAPABILITY_NAMED_IAM `
        --region $Region
    
    if ($LASTEXITCODE -ne 0) {
        # Stack might already exist, try update
        Write-Host "Stack might already exist, trying update..." -ForegroundColor Yellow
        aws cloudformation update-stack `
            --stack-name $stackName `
            --template-body file://"$PSScriptRoot\..\infrastructure\cloudformation-ecs.yaml" `
            --parameters `
                ParameterKey=VpcId,ParameterValue=$VpcId `
                ParameterKey=SubnetIds,ParameterValue=$subnetParam `
                ParameterKey=CertificateArn,ParameterValue=$CertificateArn `
            --capabilities CAPABILITY_NAMED_IAM `
            --region $Region
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Error: Failed to create/update CloudFormation stack" -ForegroundColor Red
            exit 1
        }
    }
    
    Write-Host "Waiting for stack to be ready..." -ForegroundColor Yellow
    aws cloudformation wait stack-create-complete --stack-name $stackName --region $Region
    if ($LASTEXITCODE -ne 0) {
        aws cloudformation wait stack-update-complete --stack-name $stackName --region $Region
    }
    
    Write-Host "✓ Infrastructure deployed" -ForegroundColor Green
}

# Step 3: Build and push images
Write-Host ""
Write-Host "Step 3: Building and pushing Docker images..." -ForegroundColor Yellow
& "$PSScriptRoot\deploy-ecs.ps1" -Region $Region
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to build and push images" -ForegroundColor Red
    exit 1
}

# Step 4: Create services (if infrastructure was deployed)
if (-not $SkipInfrastructure) {
    Write-Host ""
    Write-Host "Step 4: Creating ECS services..." -ForegroundColor Yellow
    
    $stackOutputs = aws cloudformation describe-stacks `
        --stack-name $stackName `
        --query "Stacks[0].Outputs" `
        --region $Region | ConvertFrom-Json
    
    $backendTG = ($stackOutputs | Where-Object { $_.OutputKey -eq 'BackendTargetGroupArn' }).OutputValue
    $frontendTG = ($stackOutputs | Where-Object { $_.OutputKey -eq 'FrontendTargetGroupArn' }).OutputValue
    $backendSG = ($stackOutputs | Where-Object { $_.OutputKey -eq 'BackendSecurityGroupId' }).OutputValue
    $frontendSG = ($stackOutputs | Where-Object { $_.OutputKey -eq 'FrontendSecurityGroupId' }).OutputValue
    
    # Check if services already exist
    $backendServiceExists = aws ecs describe-services `
        --cluster vidverse-cluster `
        --services vidverse-backend-service `
        --region $Region `
        --query 'services[0].status' `
        --output text 2>$null
    
    $frontendServiceExists = aws ecs describe-services `
        --cluster vidverse-cluster `
        --services vidverse-frontend-service `
        --region $Region `
        --query 'services[0].status' `
        --output text 2>$null
    
    if ($backendServiceExists -ne "ACTIVE" -or $frontendServiceExists -ne "ACTIVE") {
        & "$PSScriptRoot\create-ecs-services.ps1" `
            -ClusterName vidverse-cluster `
            -BackendTargetGroupArn $backendTG `
            -FrontendTargetGroupArn $frontendTG `
            -SubnetIds $subnetArray `
            -BackendSecurityGroupId $backendSG `
            -FrontendSecurityGroupId $frontendSG `
            -Region $Region `
            -DesiredCount 2
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Error: Failed to create ECS services" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "Services already exist, skipping creation" -ForegroundColor Yellow
    }
    
    Write-Host "✓ Services created/updated" -ForegroundColor Green
    
    # Get ALB DNS
    $albDNS = (aws cloudformation describe-stacks `
        --stack-name $stackName `
        --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerDNS'].OutputValue" `
        --output text `
        --region $Region)
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Deployment Complete!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Load Balancer DNS: $albDNS" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "1. Configure Route53 to point vidverseai.com and api.vidverseai.com to the ALB" -ForegroundColor White
    Write-Host "2. Ensure all secrets are stored in AWS Secrets Manager" -ForegroundColor White
    Write-Host "3. Verify services are healthy in ECS console" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Build Complete!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Images have been built and pushed to ECR." -ForegroundColor Yellow
    Write-Host "Deploy infrastructure and create services to complete deployment." -ForegroundColor Yellow
}

