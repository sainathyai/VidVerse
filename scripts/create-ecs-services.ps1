# PowerShell script to create ECS services
param(
    [Parameter(Mandatory=$true)]
    [string]$ClusterName = "vidverse-cluster",
    
    [Parameter(Mandatory=$true)]
    [string]$BackendTargetGroupArn,
    
    [Parameter(Mandatory=$true)]
    [string]$FrontendTargetGroupArn,
    
    [Parameter(Mandatory=$true)]
    [string[]]$SubnetIds,
    
    [Parameter(Mandatory=$true)]
    [string]$BackendSecurityGroupId,
    
    [Parameter(Mandatory=$true)]
    [string]$FrontendSecurityGroupId,
    
    [Parameter(Mandatory=$false)]
    [string]$Region = "us-west-2",
    
    [Parameter(Mandatory=$false)]
    [int]$DesiredCount = 2
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Creating ECS Services" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Create backend service
Write-Host "Creating backend service..." -ForegroundColor Yellow
aws ecs create-service `
    --cluster $ClusterName `
    --service-name vidverse-backend-service `
    --task-definition vidverse-backend `
    --desired-count $DesiredCount `
    --launch-type FARGATE `
    --network-configuration "awsvpcConfiguration={subnets=[$($SubnetIds -join ',')],securityGroups=[$BackendSecurityGroupId],assignPublicIp=ENABLED}" `
    --load-balancers "targetGroupArn=$BackendTargetGroupArn,containerName=backend,containerPort=3001" `
    --health-check-grace-period-seconds 60 `
    --region $Region

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to create backend service" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Backend service created" -ForegroundColor Green

# Create frontend service
Write-Host "Creating frontend service..." -ForegroundColor Yellow
aws ecs create-service `
    --cluster $ClusterName `
    --service-name vidverse-frontend-service `
    --task-definition vidverse-frontend `
    --desired-count $DesiredCount `
    --launch-type FARGATE `
    --network-configuration "awsvpcConfiguration={subnets=[$($SubnetIds -join ',')],securityGroups=[$FrontendSecurityGroupId],assignPublicIp=ENABLED}" `
    --load-balancers "targetGroupArn=$FrontendTargetGroupArn,containerName=frontend,containerPort=80" `
    --health-check-grace-period-seconds 30 `
    --region $Region

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to create frontend service" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Frontend service created" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Services Created Successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

