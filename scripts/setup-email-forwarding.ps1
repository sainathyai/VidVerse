# Email Forwarding Setup Script for sainathayai.com
# This script automates the setup of email forwarding using AWS SES and Lambda

param(
    [string]$Domain = "sainathayai.com",
    [string]$Region = "us-east-1",
    [string]$ForwardToEmail = "",
    [string]$AccountId = ""
)

Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Email Forwarding Setup for $Domain" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Validate inputs
if ([string]::IsNullOrEmpty($ForwardToEmail)) {
    $ForwardToEmail = Read-Host "Enter email address to forward emails to"
}

if ([string]::IsNullOrEmpty($AccountId)) {
    Write-Host "Getting AWS Account ID..." -ForegroundColor Yellow
    try {
        $AccountId = (aws sts get-caller-identity --query Account --output text 2>&1)
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to get account ID"
        }
        Write-Host "  Account ID: $AccountId" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Failed to get AWS Account ID. Please provide it manually." -ForegroundColor Red
        $AccountId = Read-Host "Enter your AWS Account ID"
    }
}

Write-Host ""
Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Domain: $Domain" -ForegroundColor Gray
Write-Host "  Region: $Region" -ForegroundColor Gray
Write-Host "  Forward To: $ForwardToEmail" -ForegroundColor Gray
Write-Host "  Account ID: $AccountId" -ForegroundColor Gray
Write-Host ""

# Sanitize domain name for use in AWS resource names (replace dots with hyphens)
# Lambda function names cannot contain dots, and it's cleaner for other resources too
$domainSanitized = $Domain -replace '\.', '-'

# Step 1: Check Domain Verification Status
Write-Host "Step 1: Checking domain verification status..." -ForegroundColor Yellow
try {
    $verificationResponse = aws ses get-identity-verification-attributes `
        --identities $Domain `
        --region $Region `
        --output json 2>&1
    
    if ($LASTEXITCODE -eq 0 -and $verificationResponse) {
        $verificationJson = $verificationResponse | ConvertFrom-Json
        
        # Access the verification attributes using the domain as a key
        $domainKey = $Domain
        if ($verificationJson.VerificationAttributes.PSObject.Properties.Name -contains $domainKey) {
            $verificationStatus = $verificationJson.VerificationAttributes.$domainKey.VerificationStatus
            
            if ($verificationStatus -eq "Success") {
                Write-Host "  ✓ Domain is verified!" -ForegroundColor Green
            } else {
                Write-Host "  ⚠ Domain verification status: $verificationStatus" -ForegroundColor Yellow
                if ($verificationStatus -and $verificationStatus -ne "None") {
                    Write-Host "  Current status: $verificationStatus" -ForegroundColor Gray
                } else {
                    Write-Host "  Domain not found in SES or not yet verified." -ForegroundColor Yellow
                }
                Write-Host "  Please wait a few minutes and ensure DNS records are propagated." -ForegroundColor Yellow
                $continue = Read-Host "Continue anyway? (y/n)"
                if ($continue -ne "y") {
                    exit 1
                }
            }
        } else {
            Write-Host "  ⚠ Domain not found in SES verification attributes." -ForegroundColor Yellow
            Write-Host "  The domain may not be added to SES yet." -ForegroundColor Yellow
            $continue = Read-Host "Continue anyway? (y/n)"
            if ($continue -ne "y") {
                exit 1
            }
        }
    } else {
        Write-Host "  ⚠ Could not retrieve verification status from AWS SES." -ForegroundColor Yellow
        Write-Host "  This might mean the domain is not yet added to SES." -ForegroundColor Yellow
        $continue = Read-Host "Continue anyway? (y/n)"
        if ($continue -ne "y") {
            exit 1
        }
    }
} catch {
    Write-Host "  ⚠ Could not check verification status: $_" -ForegroundColor Yellow
    $continue = Read-Host "Continue anyway? (y/n)"
    if ($continue -ne "y") {
        exit 1
    }
}

Write-Host ""

# Step 2: Enable DKIM
Write-Host "Step 2: Enabling DKIM..." -ForegroundColor Yellow
try {
    aws ses set-identity-dkim-enabled `
        --identity $Domain `
        --dkim-enabled `
        --region $Region `
        --output json | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ DKIM enabled" -ForegroundColor Green
        
        # Get DKIM tokens
        Write-Host "  Getting DKIM tokens..." -ForegroundColor Gray
        $dkimTokens = aws ses get-identity-dkim-attributes `
            --identities $Domain `
            --region $Region `
            --query "DkimAttributes.$Domain.DkimTokens" `
            --output json | ConvertFrom-Json
        
        Write-Host "  ⚠ Please add these 3 CNAME records to Route 53:" -ForegroundColor Yellow
        for ($i = 0; $i -lt $dkimTokens.Count; $i++) {
            $token = $dkimTokens[$i]
            Write-Host "    $token._domainkey.$Domain → $token.dkim.amazonses.com" -ForegroundColor Cyan
        }
        Write-Host ""
    }
} catch {
    Write-Host "  ⚠ DKIM may already be enabled or failed to enable" -ForegroundColor Yellow
}

Write-Host ""

# Step 3: Create IAM Role for Lambda
Write-Host "Step 3: Creating IAM role for Lambda..." -ForegroundColor Yellow
$roleName = "$domainSanitized-email-forwarder-role"

# Check if role exists
$roleExists = $false
try {
    $roleOutput = aws iam get-role --role-name $roleName --output json 2>&1
    if ($LASTEXITCODE -eq 0) {
        $roleExists = $true
        Write-Host "  ✓ IAM role already exists" -ForegroundColor Green
        # Get the actual role ARN from AWS
        $roleJson = $roleOutput | ConvertFrom-Json
        $roleArn = $roleJson.Role.Arn
        Write-Host "  Using existing role: $roleArn" -ForegroundColor Gray
        
        # Verify trust policy allows Lambda to assume the role
        Write-Host "  Verifying trust policy..." -ForegroundColor Gray
        $trustPolicyDoc = $roleJson.Role.AssumeRolePolicyDocument
        $trustPolicyJson = $trustPolicyDoc | ConvertTo-Json -Depth 10
        if ($trustPolicyJson -match "lambda\.amazonaws\.com") {
            Write-Host "  ✓ Trust policy is correct" -ForegroundColor Green
        } else {
            Write-Host "  ⚠ Trust policy may not allow Lambda. Updating trust policy..." -ForegroundColor Yellow
            $trustPolicy = @{
                Version = "2012-10-17"
                Statement = @(
                    @{
                        Effect = "Allow"
                        Principal = @{
                            Service = "lambda.amazonaws.com"
                        }
                        Action = "sts:AssumeRole"
                    }
                )
            } | ConvertTo-Json -Depth 10
            
            $trustPolicyFile = [System.IO.Path]::GetTempFileName()
            $trustPolicy | Out-File -FilePath $trustPolicyFile -Encoding UTF8
            
            aws iam update-assume-role-policy `
                --role-name $roleName `
                --policy-document "file://$trustPolicyFile" `
                --output json | Out-Null
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  ✓ Trust policy updated" -ForegroundColor Green
            }
            Remove-Item $trustPolicyFile -ErrorAction SilentlyContinue
        }
        
        # Verify and attach required policies if missing
        Write-Host "  Verifying policies are attached..." -ForegroundColor Gray
        $lambdaPolicy = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
        $sesPolicy = "arn:aws:iam::aws:policy/AmazonSESFullAccess"
        
        # Check attached policies
        $attachedPolicies = aws iam list-attached-role-policies --role-name $roleName --output json | ConvertFrom-Json
        $policyArns = $attachedPolicies.AttachedPolicies | ForEach-Object { $_.PolicyArn }
        
        # Check if Lambda execution policy is attached
        if ($policyArns -notcontains $lambdaPolicy) {
            Write-Host "  Attaching Lambda execution policy..." -ForegroundColor Gray
            aws iam attach-role-policy `
                --role-name $roleName `
                --policy-arn $lambdaPolicy `
                --output json | Out-Null
            Write-Host "  ✓ Lambda execution policy attached" -ForegroundColor Green
        } else {
            Write-Host "  ✓ Lambda execution policy already attached" -ForegroundColor Green
        }
        
        # Check if SES policy is attached
        if ($policyArns -notcontains $sesPolicy) {
            Write-Host "  Attaching SES policy..." -ForegroundColor Gray
            aws iam attach-role-policy `
                --role-name $roleName `
                --policy-arn $sesPolicy `
                --output json | Out-Null
            Write-Host "  ✓ SES policy attached" -ForegroundColor Green
        } else {
            Write-Host "  ✓ SES policy already attached" -ForegroundColor Green
        }
    }
} catch {
    # Role doesn't exist, will create it below
}

if (-not $roleExists) {
    # Create trust policy
    $trustPolicy = @{
        Version = "2012-10-17"
        Statement = @(
            @{
                Effect = "Allow"
                Principal = @{
                    Service = "lambda.amazonaws.com"
                }
                Action = "sts:AssumeRole"
            }
        )
    } | ConvertTo-Json -Depth 10
    
    $trustPolicyFile = [System.IO.Path]::GetTempFileName()
    $trustPolicy | Out-File -FilePath $trustPolicyFile -Encoding UTF8
    
    # Create role
    aws iam create-role `
        --role-name $roleName `
        --assume-role-policy-document "file://$trustPolicyFile" `
        --description "Role for email forwarding Lambda function" `
        --output json | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ IAM role created" -ForegroundColor Green
        
        # Get the actual role ARN
        $roleOutput = aws iam get-role --role-name $roleName --output json | ConvertFrom-Json
        $roleArn = $roleOutput.Role.Arn
        
        # Attach policies
        Write-Host "  Attaching policies..." -ForegroundColor Gray
        aws iam attach-role-policy `
            --role-name $roleName `
            --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" `
            --output json | Out-Null
        
        aws iam attach-role-policy `
            --role-name $roleName `
            --policy-arn "arn:aws:iam::aws:policy/AmazonSESFullAccess" `
            --output json | Out-Null
        
        Write-Host "  ✓ Policies attached" -ForegroundColor Green
    } else {
        $roleArn = "arn:aws:iam::${AccountId}:role/$roleName"
    }
    
    Remove-Item $trustPolicyFile -ErrorAction SilentlyContinue
}

Write-Host "  Role ARN: $roleArn" -ForegroundColor Gray
Write-Host ""

# Wait for role to be available and propagate
Write-Host "  Waiting for role to be available..." -ForegroundColor Gray
if (-not $roleExists) {
    # New role needs more time to propagate
    Write-Host "  Waiting for new role to propagate (this may take up to 30 seconds)..." -ForegroundColor Gray
    Start-Sleep -Seconds 20
} else {
    # Existing role should be ready, but wait a bit for any policy updates
    Start-Sleep -Seconds 5
}

# Verify role can be retrieved (ensures it's fully propagated)
$retryCount = 0
$maxRetries = 6
while ($retryCount -lt $maxRetries) {
    $roleCheck = aws iam get-role --role-name $roleName --output json 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Role is ready" -ForegroundColor Green
        break
    }
    $retryCount++
    Write-Host "  Waiting for role propagation... ($retryCount/$maxRetries)" -ForegroundColor Gray
    Start-Sleep -Seconds 5
}

# Step 4: Create Lambda Function
Write-Host "Step 4: Creating Lambda function..." -ForegroundColor Yellow
$functionName = "$domainSanitized-email-forwarder"

# Lambda function code
$lambdaCode = @"
const AWS = require('aws-sdk');
const ses = new AWS.SES({ region: '$Region' });

// Configure your forwarding rules here
const FORWARDING_RULES = {
    'user@$Domain': '$ForwardToEmail',
    'info@$Domain': '$ForwardToEmail',
    'contact@$Domain': '$ForwardToEmail',
    'support@$Domain': '$ForwardToEmail',
    'hello@$Domain': '$ForwardToEmail',
    '*': '$ForwardToEmail'  // Default for all other addresses
};

exports.handler = async (event) => {
    console.log('Received event:', JSON.stringify(event, null, 2));
    
    const forwardTo = process.env.FORWARD_TO_EMAIL || '$ForwardToEmail';
    
    for (const record of event.Records) {
        const { mail, content } = record.ses;
        const originalRecipient = mail.destination[0];
        const originalSender = mail.commonHeaders.from[0];
        const subject = mail.commonHeaders.subject || '(No Subject)';
        
        // Determine forwarding address
        let targetEmail = FORWARDING_RULES[originalRecipient] || 
                         FORWARDING_RULES['*'] || 
                         forwardTo;
        
        try {
            // Parse the email content
            let emailBody = '';
            if (content) {
                if (typeof content === 'string') {
                    emailBody = content;
                } else if (content.data) {
                    emailBody = Buffer.from(content.data, 'base64').toString('utf-8');
                }
            }
            
            // Create forwarded email
            const forwardedSubject = `Fwd: `${subject}`;
            const forwardedBody = `
---------- Forwarded Message ----------
From: `${originalSender}`
To: `${originalRecipient}`
Date: `${mail.commonHeaders.date}`
Subject: `${subject}`

`${emailBody}`
            `.trim();
            
            // Send email via SES
            await ses.sendEmail({
                Source: originalRecipient,
                Destination: {
                    ToAddresses: [targetEmail]
                },
                Message: {
                    Subject: {
                        Data: forwardedSubject,
                        Charset: 'UTF-8'
                    },
                    Body: {
                        Text: {
                            Data: forwardedBody,
                            Charset: 'UTF-8'
                        }
                    }
                }
            }).promise();
            
            console.log(`Forwarded email from `${originalSender}` to `${originalRecipient}` → `${targetEmail}`);
        } catch (error) {
            console.error('Error forwarding email:', error);
            throw error;
        }
    }
    
    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Email forwarded successfully' })
    };
};
"@

# Create deployment package
$tempDir = Join-Path $env:TEMP "lambda-email-forwarder-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
$lambdaCode | Out-File -FilePath "$tempDir/index.js" -Encoding UTF8

# Initialize package.json
$packageJson = @{
    name = "email-forwarder"
    version = "1.0.0"
    description = "Email forwarding Lambda function"
    main = "index.js"
    dependencies = @{
        "aws-sdk" = "^2.1000.0"
    }
} | ConvertTo-Json -Depth 10

$packageJson | Out-File -FilePath "$tempDir/package.json" -Encoding UTF8

# Create zip file
$zipFile = "$tempDir.zip"
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipFile -Force

try {
    # Check if function exists
    aws lambda get-function --function-name $functionName --region $Region --output json | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Function exists, updating code..." -ForegroundColor Gray
        aws lambda update-function-code `
            --function-name $functionName `
            --zip-file "fileb://$zipFile" `
            --region $Region `
            --output json | Out-Null
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ Lambda function updated" -ForegroundColor Green
        }
    }
} catch {
    # Create function with retry logic
    Write-Host "  Creating Lambda function..." -ForegroundColor Gray
    $retryCount = 0
    $maxRetries = 5
    $lambdaCreated = $false
    
    while ($retryCount -lt $maxRetries) {
        aws lambda create-function `
            --function-name $functionName `
            --runtime nodejs18.x `
            --role $roleArn `
            --handler index.handler `
            --zip-file "fileb://$zipFile" `
            --timeout 30 `
            --memory-size 256 `
            --region $Region `
            --output json | Out-Null
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ Lambda function created" -ForegroundColor Green
            $lambdaCreated = $true
            break
        } else {
            $retryCount++
            if ($retryCount -lt $maxRetries) {
                Write-Host "  ⚠ Lambda creation failed, retrying in 10 seconds... ($retryCount/$maxRetries)" -ForegroundColor Yellow
                Start-Sleep -Seconds 10
            } else {
                Write-Host "  [ERROR] Failed to create Lambda function after $maxRetries attempts" -ForegroundColor Red
                Write-Host "  This might be due to:" -ForegroundColor Yellow
                Write-Host "    1. Role not fully propagated (wait a minute and try again)" -ForegroundColor Yellow
                Write-Host "    2. Invalid role ARN: $roleArn" -ForegroundColor Yellow
                Write-Host "    3. Insufficient permissions" -ForegroundColor Yellow
                exit 1
            }
        }
    }
}

# Cleanup
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $zipFile -Force -ErrorAction SilentlyContinue

$functionArn = "arn:aws:lambda:${Region}:${AccountId}:function:$functionName"
Write-Host "  Function ARN: $functionArn" -ForegroundColor Gray
Write-Host ""

# Step 5: Create SES Receipt Rule Set
Write-Host "Step 5: Creating SES receipt rule set..." -ForegroundColor Yellow
$ruleSetName = "$domainSanitized-forwarding"

try {
    # Create rule set
    aws ses create-receipt-rule-set `
        --rule-set-name $ruleSetName `
        --region $Region `
        --output json | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Rule set created" -ForegroundColor Green
    }
} catch {
    Write-Host "  Rule set may already exist" -ForegroundColor Yellow
}

# Set as active
Write-Host "  Setting as active rule set..." -ForegroundColor Gray
aws ses set-active-receipt-rule-set `
    --rule-set-name $ruleSetName `
    --region $Region `
    --output json | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Rule set activated" -ForegroundColor Green
}

Write-Host ""

# Step 6: Create Receipt Rule
Write-Host "Step 6: Creating receipt rule..." -ForegroundColor Yellow
$ruleName = "forward-all"

# Create rule JSON
$ruleJson = @{
    Name = $ruleName
    Enabled = $true
    Recipients = @("*@$Domain")
    Actions = @(
        @{
            LambdaAction = @{
                FunctionArn = $functionArn
                InvocationType = "Event"
            }
        }
    )
} | ConvertTo-Json -Depth 10

$ruleFile = [System.IO.Path]::GetTempFileName()
$ruleJson | Out-File -FilePath $ruleFile -Encoding UTF8

try {
    # Check if rule exists
    aws ses describe-receipt-rule `
        --rule-set-name $ruleSetName `
        --rule-name $ruleName `
        --region $Region `
        --output json | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Rule exists, updating..." -ForegroundColor Gray
        aws ses update-receipt-rule `
            --rule-set-name $ruleSetName `
            --rule "file://$ruleFile" `
            --region $Region `
            --output json | Out-Null
    }
} catch {
    # Create rule
    aws ses create-receipt-rule `
        --rule-set-name $ruleSetName `
        --rule "file://$ruleFile" `
        --region $Region `
        --output json | Out-Null
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Receipt rule created" -ForegroundColor Green
}

Remove-Item $ruleFile -ErrorAction SilentlyContinue
Write-Host ""

# Step 7: Grant Lambda Permission to SES
Write-Host "Step 7: Granting Lambda permission to SES..." -ForegroundColor Yellow
$sourceArn = "arn:aws:ses:${Region}:${AccountId}:receipt-rule-set/$ruleSetName"
$statementId = "allow-ses-invoke-$(Get-Date -Format 'yyyyMMddHHmmss')"

try {
    aws lambda add-permission `
        --function-name $functionName `
        --statement-id $statementId `
        --action lambda:InvokeFunction `
        --principal ses.amazonaws.com `
        --source-arn $sourceArn `
        --region $Region `
        --output json | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Permission granted" -ForegroundColor Green
    }
} catch {
    Write-Host "  Permission may already exist" -ForegroundColor Yellow
}

Write-Host ""

# Step 8: Summary
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Add DKIM CNAME records to Route 53 (shown above)" -ForegroundColor White
Write-Host "  2. Request production access in SES Console:" -ForegroundColor White
Write-Host "     https://console.aws.amazon.com/ses/home?region=$Region#/account" -ForegroundColor Cyan
Write-Host "  3. Test by sending email to: info@$Domain" -ForegroundColor White
Write-Host ""
Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Domain: $Domain" -ForegroundColor Gray
Write-Host "  Forward To: $ForwardToEmail" -ForegroundColor Gray
Write-Host "  Lambda Function: $functionName" -ForegroundColor Gray
Write-Host "  Rule Set: $ruleSetName" -ForegroundColor Gray
Write-Host ""
Write-Host "To update forwarding email, edit the Lambda function code." -ForegroundColor Yellow
Write-Host ""

