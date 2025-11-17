# VidVerse ECS Deployment Guide

This guide walks you through deploying VidVerse to AWS ECS with Application Load Balancer.

## Prerequisites

1. AWS CLI configured with appropriate credentials
2. Docker installed and running
3. AWS Account with permissions to create:
   - ECS clusters, services, and task definitions
   - Application Load Balancer
   - Security Groups
   - IAM Roles
   - ECR repositories
   - CloudWatch Log Groups
   - Secrets Manager (for storing secrets)

## Architecture

- **Frontend**: React app served via nginx in ECS Fargate
- **Backend**: Node.js Fastify API in ECS Fargate
- **Load Balancer**: Application Load Balancer with HTTPS
- **Networking**: VPC with public subnets in at least 2 AZs

## Deployment Steps

### 1. Setup IAM Roles

```powershell
.\scripts\setup-iam-roles.ps1
```

This creates:
- `ecsTaskExecutionRole`: For pulling images from ECR and writing logs
- `ecsTaskRole`: For accessing AWS services (S3, Cognito, etc.)

### 2. Store Secrets in AWS Secrets Manager

Create the following secrets (replace values with your actual values):

```powershell
# Database URL
aws secretsmanager create-secret `
    --name vidverse/database-url `
    --secret-string "postgresql://user:password@rds-endpoint:5432/vidverse?sslmode=require" `
    --region us-west-2

# Cognito
aws secretsmanager create-secret `
    --name vidverse/cognito-user-pool-id `
    --secret-string "us-west-2_xxxxxxxxx" `
    --region us-west-2

aws secretsmanager create-secret `
    --name vidverse/cognito-client-id `
    --secret-string "xxxxxxxxxxxxxxxxxxxxxxxxxx" `
    --region us-west-2

aws secretsmanager create-secret `
    --name vidverse/cognito-domain `
    --secret-string "your-pool-domain.auth.us-west-2.amazoncognito.com" `
    --region us-west-2

# S3
aws secretsmanager create-secret `
    --name vidverse/s3-access-key-id `
    --secret-string "your-access-key" `
    --region us-west-2

aws secretsmanager create-secret `
    --name vidverse/s3-secret-access-key `
    --secret-string "your-secret-key" `
    --region us-west-2

# API Keys
aws secretsmanager create-secret `
    --name vidverse/replicate-api-token `
    --secret-string "r8_your-token" `
    --region us-west-2

aws secretsmanager create-secret `
    --name vidverse/openrouter-api-key `
    --secret-string "sk-or-v1_your-key" `
    --region us-west-2
```

### 3. Deploy CloudFormation Stack

First, get your VPC and subnet IDs:

```powershell
# Get VPC ID
$vpcId = aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text

# Get subnet IDs (at least 2 in different AZs)
$subnets = aws ec2 describe-subnets --filters "Name=vpc-id,Values=$vpcId" --query "Subnets[?MapPublicIpOnLaunch==\`true\`].SubnetId" --output text
```

Get or create an ACM certificate for your domain:

```powershell
# List existing certificates
aws acm list-certificates --region us-west-2

# Or create a new one (requires DNS validation)
aws acm request-certificate `
    --domain-name vidverseai.com `
    --subject-alternative-names "*.vidverseai.com" `
    --validation-method DNS `
    --region us-west-2
```

Deploy the CloudFormation stack:

```powershell
aws cloudformation create-stack `
    --stack-name vidverse-ecs-infrastructure `
    --template-body file://infrastructure/cloudformation-ecs.yaml `
    --parameters `
        ParameterKey=VpcId,ParameterValue=$vpcId `
        ParameterKey=SubnetIds,ParameterValue="$($subnets -replace '\s',',')" `
        ParameterKey=CertificateArn,ParameterValue="arn:aws:acm:us-west-2:ACCOUNT_ID:certificate/CERT_ID" `
    --capabilities CAPABILITY_NAMED_IAM `
    --region us-west-2
```

Wait for stack creation:

```powershell
aws cloudformation wait stack-create-complete `
    --stack-name vidverse-ecs-infrastructure `
    --region us-west-2
```

Get stack outputs:

```powershell
aws cloudformation describe-stacks `
    --stack-name vidverse-ecs-infrastructure `
    --query "Stacks[0].Outputs" `
    --region us-west-2
```

### 4. Update Task Definitions

Update the task definition JSON files with your account ID:

```powershell
$accountId = aws sts get-caller-identity --query Account --output text

# Update backend task definition
(Get-Content infrastructure/ecs-task-definition-backend.json) `
    -replace 'ACCOUNT_ID', $accountId | `
    Set-Content infrastructure/ecs-task-definition-backend.json

# Update frontend task definition
(Get-Content infrastructure/ecs-task-definition-frontend.json) `
    -replace 'ACCOUNT_ID', $accountId | `
    Set-Content infrastructure/ecs-task-definition-frontend.json
```

### 5. Build and Push Docker Images

```powershell
.\scripts\deploy-ecs.ps1 -Region us-west-2
```

This script:
- Creates ECR repositories if they don't exist
- Builds Docker images for backend and frontend
- Pushes images to ECR
- Registers task definitions

### 6. Create ECS Services

Get the required values from CloudFormation outputs:

```powershell
$stackOutputs = aws cloudformation describe-stacks `
    --stack-name vidverse-ecs-infrastructure `
    --query "Stacks[0].Outputs" `
    --region us-west-2 | ConvertFrom-Json

$backendTG = ($stackOutputs | Where-Object { $_.OutputKey -eq 'BackendTargetGroupArn' }).OutputValue
$frontendTG = ($stackOutputs | Where-Object { $_.OutputKey -eq 'FrontendTargetGroupArn' }).OutputValue
$backendSG = ($stackOutputs | Where-Object { $_.OutputKey -eq 'BackendSecurityGroupId' }).OutputValue
$frontendSG = ($stackOutputs | Where-Object { $_.OutputKey -eq 'FrontendSecurityGroupId' }).OutputValue
```

Create the services:

```powershell
.\scripts\create-ecs-services.ps1 `
    -ClusterName vidverse-cluster `
    -BackendTargetGroupArn $backendTG `
    -FrontendTargetGroupArn $frontendTG `
    -SubnetIds $subnets.Split(' ') `
    -BackendSecurityGroupId $backendSG `
    -FrontendSecurityGroupId $frontendSG `
    -Region us-west-2 `
    -DesiredCount 2
```

### 7. Configure DNS

Get the ALB DNS name:

```powershell
$albDNS = (aws cloudformation describe-stacks `
    --stack-name vidverse-ecs-infrastructure `
    --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerDNS'].OutputValue" `
    --output text `
    --region us-west-2)
```

Create Route53 records:

```powershell
# For vidverseai.com (frontend)
aws route53 change-resource-record-sets `
    --hosted-zone-id YOUR_HOSTED_ZONE_ID `
    --change-batch '{
        "Changes": [{
            "Action": "UPSERT",
            "ResourceRecordSet": {
                "Name": "vidverseai.com",
                "Type": "A",
                "AliasTarget": {
                    "HostedZoneId": "Z1D633PJN98FT9",
                    "DNSName": "' + $albDNS + '",
                    "EvaluateTargetHealth": true
                }
            }
        }]
    }'

# For api.vidverseai.com (backend)
aws route53 change-resource-record-sets `
    --hosted-zone-id YOUR_HOSTED_ZONE_ID `
    --change-batch '{
        "Changes": [{
            "Action": "UPSERT",
            "ResourceRecordSet": {
                "Name": "api.vidverseai.com",
                "Type": "A",
                "AliasTarget": {
                    "HostedZoneId": "Z1D633PJN98FT9",
                    "DNSName": "' + $albDNS + '",
                    "EvaluateTargetHealth": true
                }
            }
        }]
    }'
```

## Updating the Application

To deploy updates:

```powershell
.\scripts\deploy-ecs.ps1 -Region us-west-2 -BackendImageTag v1.0.1 -FrontendImageTag v1.0.1
```

This will:
1. Build new images
2. Push to ECR
3. Register new task definitions
4. Force new deployments in ECS services

## Monitoring

- **CloudWatch Logs**: `/ecs/vidverse-backend` and `/ecs/vidverse-frontend`
- **ECS Console**: Monitor service health and task status
- **ALB Metrics**: Monitor request counts, response times, error rates

## Troubleshooting

### Tasks not starting
- Check CloudWatch Logs for errors
- Verify task definition has correct image URI
- Check security group rules
- Verify secrets exist in Secrets Manager

### Health checks failing
- Verify health check paths (`/health`) are accessible
- Check security group allows traffic from ALB
- Review container logs

### Cannot connect to database
- Verify RDS security group allows traffic from ECS security group
- Check DATABASE_URL secret is correct
- Verify SSL certificate path if required

## Cost Optimization

- Use Fargate Spot for non-critical workloads (50-70% savings)
- Adjust desired count based on traffic
- Use CloudWatch Logs retention policies
- Consider using Application Auto Scaling

