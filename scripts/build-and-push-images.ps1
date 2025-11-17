# Script to build and push Docker images to ECR
param(
    [Parameter(Mandatory=$false)]
    [string]$Region = "us-west-2"
)

$ErrorActionPreference = "Stop"

$AccountId = "971422717446"
$BackendRepository = "${AccountId}.dkr.ecr.${Region}.amazonaws.com/vidverse-backend"
$FrontendRepository = "${AccountId}.dkr.ecr.${Region}.amazonaws.com/vidverse-frontend"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Building and Pushing Docker Images" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
Write-Host "Checking Docker..." -ForegroundColor Yellow
try {
    docker ps | Out-Null
    Write-Host "✓ Docker is running" -ForegroundColor Green
} catch {
    Write-Host "✗ Docker is not running. Please start Docker Desktop first." -ForegroundColor Red
    exit 1
}

# Login to ECR
Write-Host ""
Write-Host "Logging in to ECR..." -ForegroundColor Yellow
aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin "${AccountId}.dkr.ecr.${Region}.amazonaws.com"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to login to ECR" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Logged in to ECR" -ForegroundColor Green

# Build and push backend
Write-Host ""
Write-Host "Building backend Docker image..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\..\backend"
docker build -t vidverse-backend:latest .
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to build backend image" -ForegroundColor Red
    exit 1
}

docker tag vidverse-backend:latest "${BackendRepository}:latest"
Write-Host "Pushing backend image to ECR..." -ForegroundColor Yellow
docker push "${BackendRepository}:latest"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to push backend image" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Backend image pushed successfully" -ForegroundColor Green

# Build and push frontend
Write-Host ""
Write-Host "Building frontend Docker image..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\..\frontend"

# Get secrets for build args
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

docker build -t vidverse-frontend:latest $buildArgs .
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to build frontend image" -ForegroundColor Red
    exit 1
}

docker tag vidverse-frontend:latest "${FrontendRepository}:latest"
Write-Host "Pushing frontend image to ECR..." -ForegroundColor Yellow
docker push "${FrontendRepository}:latest"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to push frontend image" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Frontend image pushed successfully" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Build and Push Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Images are now available in ECR. ECS services will automatically pull and deploy them." -ForegroundColor Yellow

