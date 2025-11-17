# PowerShell script to create IAM roles for ECS
param(
    [Parameter(Mandatory=$false)]
    [string]$Region = "us-west-2"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setting up IAM Roles for ECS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ECS Task Execution Role Trust Policy
$executionTrustPolicy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Principal = @{
                Service = "ecs-tasks.amazonaws.com"
            }
            Action = "sts:AssumeRole"
        }
    )
} | ConvertTo-Json -Depth 10

# ECS Task Execution Role Policy
$executionRolePolicy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Action = @(
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            )
            Resource = "*"
        },
        @{
            Effect = "Allow"
            Action = @(
                "secretsmanager:GetSecretValue"
            )
            Resource = "arn:aws:secretsmanager:*:*:secret:vidverse/*"
        }
    )
} | ConvertTo-Json -Depth 10

# ECS Task Role Trust Policy
$taskTrustPolicy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Principal = @{
                Service = "ecs-tasks.amazonaws.com"
            }
            Action = "sts:AssumeRole"
        }
    )
} | ConvertTo-Json -Depth 10

# ECS Task Role Policy (for accessing AWS services)
$taskRolePolicy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Action = @(
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            )
            Resource = @(
                "arn:aws:s3:::vidverse-assets",
                "arn:aws:s3:::vidverse-assets/*"
            )
        },
        @{
            Effect = "Allow"
            Action = @(
                "cognito-idp:AdminGetUser",
                "cognito-idp:AdminCreateUser",
                "cognito-idp:AdminUpdateUserAttributes",
                "cognito-idp:AdminInitiateAuth",
                "cognito-idp:AdminRespondToAuthChallenge"
            )
            Resource = "*"
        }
    )
} | ConvertTo-Json -Depth 10

# Create execution role
Write-Host "Creating ECS Task Execution Role..." -ForegroundColor Yellow
$executionRoleExists = aws iam get-role --role-name ecsTaskExecutionRole --region $Region 2>$null
if ($LASTEXITCODE -ne 0) {
    $executionTrustPolicy | Out-File -FilePath "$env:TEMP\ecs-execution-trust-policy.json" -Encoding utf8
    aws iam create-role `
        --role-name ecsTaskExecutionRole `
        --assume-role-policy-document "file://$env:TEMP\ecs-execution-trust-policy.json" `
        --region $Region | Out-Null
    
    $executionRolePolicy | Out-File -FilePath "$env:TEMP\ecs-execution-role-policy.json" -Encoding utf8
    aws iam put-role-policy `
        --role-name ecsTaskExecutionRole `
        --policy-name EcsTaskExecutionRolePolicy `
        --policy-document "file://$env:TEMP\ecs-execution-role-policy.json" `
        --region $Region | Out-Null
    
    # Attach AWS managed policy
    aws iam attach-role-policy `
        --role-name ecsTaskExecutionRole `
        --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" `
        --region $Region | Out-Null
    
    Write-Host "✓ ECS Task Execution Role created" -ForegroundColor Green
} else {
    Write-Host "✓ ECS Task Execution Role already exists" -ForegroundColor Green
}

# Create task role
Write-Host "Creating ECS Task Role..." -ForegroundColor Yellow
$taskRoleExists = aws iam get-role --role-name ecsTaskRole --region $Region 2>$null
if ($LASTEXITCODE -ne 0) {
    $taskTrustPolicy | Out-File -FilePath "$env:TEMP\ecs-task-trust-policy.json" -Encoding utf8
    aws iam create-role `
        --role-name ecsTaskRole `
        --assume-role-policy-document "file://$env:TEMP\ecs-task-trust-policy.json" `
        --region $Region | Out-Null
    
    $taskRolePolicy | Out-File -FilePath "$env:TEMP\ecs-task-role-policy.json" -Encoding utf8
    aws iam put-role-policy `
        --role-name ecsTaskRole `
        --policy-name EcsTaskRolePolicy `
        --policy-document "file://$env:TEMP\ecs-task-role-policy.json" `
        --region $Region | Out-Null
    
    Write-Host "✓ ECS Task Role created" -ForegroundColor Green
} else {
    Write-Host "✓ ECS Task Role already exists" -ForegroundColor Green
}

# Clean up temp files
Remove-Item "$env:TEMP\ecs-*.json" -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "IAM Roles Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Role ARNs:" -ForegroundColor Yellow
$accountId = (aws sts get-caller-identity --query Account --output text)
Write-Host "Execution Role: arn:aws:iam::${accountId}:role/ecsTaskExecutionRole" -ForegroundColor White
Write-Host "Task Role: arn:aws:iam::${accountId}:role/ecsTaskRole" -ForegroundColor White

