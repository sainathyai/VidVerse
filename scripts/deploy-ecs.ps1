# PowerShell script to deploy VidVerse to ECS
param(
    [Parameter(Mandatory=$false)]
    [string]$Region = "us-west-2",
    
    [Parameter(Mandatory=$false)]
    [string]$AccountId = "",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipBuild = $false,
    
    [Parameter(Mandatory=$false)]
    [string]$BackendImageTag = "latest",
    
    [Parameter(Mandatory=$false)]
    [string]$FrontendImageTag = "latest"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VidVerse ECS Deployment Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get AWS account ID if not provided
if ([string]::IsNullOrEmpty($AccountId)) {
    Write-Host "Getting AWS Account ID..." -ForegroundColor Yellow
    $AccountId = (aws sts get-caller-identity --query Account --output text)
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to get AWS Account ID. Make sure AWS CLI is configured." -ForegroundColor Red
        exit 1
    }
    Write-Host "AWS Account ID: $AccountId" -ForegroundColor Green
}

$BackendRepository = "$AccountId.dkr.ecr.$Region.amazonaws.com/vidverse-backend"
$FrontendRepository = "$AccountId.dkr.ecr.$Region.amazonaws.com/vidverse-frontend"

# Function to check if ECR repository exists
function Test-ECRRepository {
    param([string]$RepositoryName)
    $null = aws ecr describe-repositories --repository-names $RepositoryName --region $Region 2>&1
    return $LASTEXITCODE -eq 0
}

# Function to create ECR repository
function New-ECRRepository {
    param([string]$RepositoryName)
    Write-Host "Creating ECR repository: $RepositoryName..." -ForegroundColor Yellow
    aws ecr create-repository --repository-name $RepositoryName --region $Region --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=AES256
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to create ECR repository" -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Created ECR repository: $RepositoryName" -ForegroundColor Green
}

# Create ECR repositories if they don't exist
Write-Host "Checking ECR repositories..." -ForegroundColor Yellow
$backendRepoExists = Test-ECRRepository "vidverse-backend"
if (-not $backendRepoExists) {
    New-ECRRepository "vidverse-backend"
} else {
    Write-Host "✓ ECR repository 'vidverse-backend' exists" -ForegroundColor Green
}

$frontendRepoExists = Test-ECRRepository "vidverse-frontend"
if (-not $frontendRepoExists) {
    New-ECRRepository "vidverse-frontend"
} else {
    Write-Host "✓ ECR repository 'vidverse-frontend' exists" -ForegroundColor Green
}

# Login to ECR
Write-Host ""
Write-Host "Logging in to ECR..." -ForegroundColor Yellow
$ecrLogin = aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin "$AccountId.dkr.ecr.$Region.amazonaws.com"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to login to ECR" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Logged in to ECR" -ForegroundColor Green

# Build and push backend
if (-not $SkipBuild) {
    Write-Host ""
    Write-Host "Building backend Docker image..." -ForegroundColor Yellow
    Set-Location "$PSScriptRoot\..\backend"
    docker build -t "vidverse-backend:${BackendImageTag}" .
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to build backend image" -ForegroundColor Red
        exit 1
    }
    
    docker tag "vidverse-backend:${BackendImageTag}" "${BackendRepository}:${BackendImageTag}"
    docker tag "vidverse-backend:${BackendImageTag}" "${BackendRepository}:latest"
    
    Write-Host "Pushing backend image to ECR..." -ForegroundColor Yellow
    docker push "${BackendRepository}:${BackendImageTag}"
    docker push "${BackendRepository}:latest"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to push backend image" -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Backend image pushed successfully" -ForegroundColor Green
}

# Build and push frontend
if (-not $SkipBuild) {
    Write-Host ""
    Write-Host "Building frontend Docker image..." -ForegroundColor Yellow
    Set-Location "$PSScriptRoot\..\frontend"
    
    # Get secrets for build args (optional - can be set via environment variables)
    $cognitoUserPoolId = (aws secretsmanager get-secret-value --secret-id vidverse/cognito-user-pool-id --region $Region --query SecretString --output text 2>$null)
    $cognitoClientId = (aws secretsmanager get-secret-value --secret-id vidverse/cognito-client-id --region $Region --query SecretString --output text 2>$null)
    $cognitoDomain = (aws secretsmanager get-secret-value --secret-id vidverse/cognito-domain --region $Region --query SecretString --output text 2>$null)
    
    # Build with build args
    $buildArgs = @(
        "--build-arg", "VITE_API_URL=https://api.vidverseai.com",
        "--build-arg", "VITE_OAUTH_REDIRECT_SIGN_IN=https://vidverseai.com/auth/callback",
        "--build-arg", "VITE_OAUTH_REDIRECT_SIGN_OUT=https://vidverseai.com/login"
    )
    
    if ($cognitoUserPoolId) {
        $buildArgs += "--build-arg", "VITE_COGNITO_USER_POOL_ID=$cognitoUserPoolId"
    }
    if ($cognitoClientId) {
        $buildArgs += "--build-arg", "VITE_COGNITO_CLIENT_ID=$cognitoClientId"
    }
    if ($cognitoDomain) {
        $buildArgs += "--build-arg", "VITE_COGNITO_DOMAIN=$cognitoDomain"
    }
    
    docker build -t "vidverse-frontend:${FrontendImageTag}" $buildArgs .
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to build frontend image" -ForegroundColor Red
        exit 1
    }
    
    docker tag "vidverse-frontend:${FrontendImageTag}" "${FrontendRepository}:${FrontendImageTag}"
    docker tag "vidverse-frontend:${FrontendImageTag}" "${FrontendRepository}:latest"
    
    Write-Host "Pushing frontend image to ECR..." -ForegroundColor Yellow
    docker push "${FrontendRepository}:${FrontendImageTag}"
    docker push "${FrontendRepository}:latest"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to push frontend image" -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Frontend image pushed successfully" -ForegroundColor Green
}

# Update task definitions
Write-Host ""
Write-Host "Updating ECS task definitions..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\.."

# Replace placeholders in task definitions
$backendTaskDef = Get-Content "infrastructure\ecs-task-definition-backend.json" -Raw
$backendTaskDef = $backendTaskDef -replace "ACCOUNT_ID", $AccountId
$backendTaskDef | Set-Content "infrastructure\ecs-task-definition-backend-temp.json"

$frontendTaskDef = Get-Content "infrastructure\ecs-task-definition-frontend.json" -Raw
$frontendTaskDef = $frontendTaskDef -replace "ACCOUNT_ID", $AccountId
$frontendTaskDef | Set-Content "infrastructure\ecs-task-definition-frontend-temp.json"

# Register task definitions
Write-Host "Registering backend task definition..." -ForegroundColor Yellow
aws ecs register-task-definition `
    --cli-input-json "file://infrastructure/ecs-task-definition-backend-temp.json" `
    --region $Region
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to register backend task definition" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Backend task definition registered" -ForegroundColor Green

Write-Host "Registering frontend task definition..." -ForegroundColor Yellow
aws ecs register-task-definition `
    --cli-input-json "file://infrastructure/ecs-task-definition-frontend-temp.json" `
    --region $Region
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to register frontend task definition" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Frontend task definition registered" -ForegroundColor Green

# Clean up temp files
Remove-Item "infrastructure\ecs-task-definition-backend-temp.json" -ErrorAction SilentlyContinue
Remove-Item "infrastructure\ecs-task-definition-frontend-temp.json" -ErrorAction SilentlyContinue

# Update services if they exist
Write-Host ""
Write-Host "Updating ECS services..." -ForegroundColor Yellow

$clusterName = "vidverse-cluster"

# Check if cluster exists
$clusterExists = aws ecs describe-clusters --clusters $clusterName --region $Region --query 'clusters[0].status' --output text 2>$null
if ($clusterExists -eq "ACTIVE") {
    # Update backend service
    $backendServiceExists = aws ecs describe-services --cluster $clusterName --services vidverse-backend-service --region $Region --query 'services[0].status' --output text 2>$null
    if ($backendServiceExists -eq "ACTIVE") {
        Write-Host "Updating backend service..." -ForegroundColor Yellow
        aws ecs update-service `
            --cluster $clusterName `
            --service vidverse-backend-service `
            --force-new-deployment `
            --region $Region | Out-Null
        Write-Host "✓ Backend service update initiated" -ForegroundColor Green
    } else {
        Write-Host "Backend service does not exist. Create it using the CloudFormation template or manually." -ForegroundColor Yellow
    }
    
    # Update frontend service
    $frontendServiceExists = aws ecs describe-services --cluster $clusterName --services vidverse-frontend-service --region $Region --query 'services[0].status' --output text 2>$null
    if ($frontendServiceExists -eq "ACTIVE") {
        Write-Host "Updating frontend service..." -ForegroundColor Yellow
        aws ecs update-service `
            --cluster $clusterName `
            --service vidverse-frontend-service `
            --force-new-deployment `
            --region $Region | Out-Null
        Write-Host "✓ Frontend service update initiated" -ForegroundColor Green
    } else {
        Write-Host "Frontend service does not exist. Create it using the CloudFormation template or manually." -ForegroundColor Yellow
    }
} else {
    Write-Host "ECS cluster '$clusterName' does not exist. Deploy the CloudFormation template first." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Deploy the CloudFormation template: infrastructure/cloudformation-ecs.yaml" -ForegroundColor White
Write-Host "2. Create ECS services pointing to the task definitions" -ForegroundColor White
Write-Host "3. Configure Route53 to point your domains to the ALB" -ForegroundColor White

