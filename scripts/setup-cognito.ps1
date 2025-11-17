# AWS Cognito Setup Script for VidVerse (PowerShell)
# This script creates a Cognito User Pool with email-based authentication
# Region: us-west-2
#
# Configuration:
# - You can customize the RETURN_URL variable below to set where Cognito
#   redirects users after successful sign-in with managed login pages
# - The return URL must be included in the callback URLs list

$ErrorActionPreference = "Stop"

# Configuration
$REGION = "us-west-2"
$USER_POOL_NAME = "vidverse-users"
$APP_CLIENT_NAME = "vidverse-web-client"
$DOMAIN_PREFIX = "vidverse-$(Get-Date -Format 'yyyyMMddHHmmss')"
# Optional: Return URL for managed login pages (defaults to auth callback if not specified)
$RETURN_URL = "http://localhost:3000/auth/callback"  # Change this to your desired return URL

Write-Host "Setting up AWS Cognito User Pool in $REGION..." -ForegroundColor Cyan
Write-Host ""

# Check if AWS CLI is installed
try {
    $awsVersion = aws --version 2>&1
    Write-Host "[OK] AWS CLI found: $awsVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] AWS CLI not found. Please install it from: https://aws.amazon.com/cli/" -ForegroundColor Red
    exit 1
}

# Check AWS credentials
try {
    $awsIdentity = aws sts get-caller-identity --region $REGION 2>&1 | ConvertFrom-Json
    Write-Host "[OK] AWS credentials configured for: $($awsIdentity.Arn)" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] AWS credentials not configured. Please run 'aws configure'" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 1: Create User Pool
Write-Host "Step 1: Creating User Pool..." -ForegroundColor Yellow
Write-Host "   Pool Name: $USER_POOL_NAME" -ForegroundColor Gray
Write-Host "   Region: $REGION" -ForegroundColor Gray
Write-Host "   Username: Email" -ForegroundColor Gray
Write-Host ""

try {
    # Create temporary JSON files for complex parameters
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $tempDir = Join-Path $scriptDir "temp"
    if (-not (Test-Path $tempDir)) {
        New-Item -ItemType Directory -Path $tempDir | Out-Null
    }

    $passwordPolicyFile = Join-Path $tempDir "cognito-password-policy.json"
    $schemaFile = Join-Path $tempDir "cognito-schema.json"
    $recoveryFile = Join-Path $tempDir "cognito-recovery.json"
    $verificationFile = Join-Path $tempDir "cognito-verification.json"

    # Password policy JSON
    $passwordPolicy = @{
        PasswordPolicy = @{
            MinimumLength = 8
            RequireUppercase = $true
            RequireLowercase = $true
            RequireNumbers = $true
            RequireSymbols = $false
        }
    }
    $passwordPolicy | ConvertTo-Json -Depth 10 | Out-File -FilePath $passwordPolicyFile -Encoding UTF8 -Force

    # Schema JSON
    $schema = @(
        @{
            Name = "email"
            AttributeDataType = "String"
            Required = $true
            Mutable = $true
        },
        @{
            Name = "name"
            AttributeDataType = "String"
            Required = $false
            Mutable = $true
        }
    )
    $schema | ConvertTo-Json -Depth 10 | Out-File -FilePath $schemaFile -Encoding UTF8 -Force

    # Account recovery JSON
    $recovery = @{
        RecoveryMechanisms = @(
            @{
                Priority = 1
                Name = "verified_email"
            }
        )
    }
    $recovery | ConvertTo-Json -Depth 10 | Out-File -FilePath $recoveryFile -Encoding UTF8 -Force

    # Verification message template JSON
    $verification = @{
        EmailSubject = "Your VidVerse verification code"
        EmailMessage = "Your verification code is {####}"
    }
    $verification | ConvertTo-Json -Depth 10 | Out-File -FilePath $verificationFile -Encoding UTF8 -Force

    # For Windows, try using direct file paths (AWS CLI should accept them)
    # Escape the paths properly for use in command line
    $passwordPolicyPath = $passwordPolicyFile -replace '"', '`"'
    $schemaPath = $schemaFile -replace '"', '`"'
    $recoveryPath = $recoveryFile -replace '"', '`"'
    $verificationPath = $verificationFile -replace '"', '`"'
    
    # Build the AWS CLI command using direct file paths with file:// prefix
    # Try file:/// format with forward slashes
    $passwordPolicyUrl = "file:///" + ($passwordPolicyFile -replace '\\', '/')
    $schemaUrl = "file:///" + ($schemaFile -replace '\\', '/')
    $recoveryUrl = "file:///" + ($recoveryFile -replace '\\', '/')
    $verificationUrl = "file:///" + ($verificationFile -replace '\\', '/')
    
    # Alternative: Use --cli-input-json with a single comprehensive JSON file
    # This is more reliable on Windows
    $cliInputFile = Join-Path $tempDir "cognito-create-pool.json"
    $cliInputJson = @{
        PoolName = $USER_POOL_NAME
        UsernameAttributes = @("email")
        Policies = $passwordPolicy.PasswordPolicy
        Schema = $schema
        AccountRecoverySetting = $recovery
        VerificationMessageTemplate = $verification
    } | ConvertTo-Json -Depth 10
    
    $cliInputJson | Out-File -FilePath $cliInputFile -Encoding UTF8 -Force
    
    Write-Host "   Executing AWS CLI command..." -ForegroundColor Gray
    
    # Read JSON content and pass via stdin to avoid file path issues
    $jsonContent = Get-Content -Path $cliInputFile -Raw -Encoding UTF8
    
    # Use PowerShell to pipe JSON content to AWS CLI via stdin
    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = "aws"
    $processInfo.Arguments = "cognito-idp create-user-pool --cli-input-json - --region $REGION --output json"
    $processInfo.UseShellExecute = $false
    $processInfo.RedirectStandardInput = $true
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $processInfo.CreateNoWindow = $true
    
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $processInfo
    
    try {
        $process.Start() | Out-Null
        $process.StandardInput.Write($jsonContent)
        $process.StandardInput.Close()
        
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        $exitCode = $process.ExitCode
        
        if ($stderr) {
            $userPoolOutput = $stderr
        } else {
            $userPoolOutput = $stdout
        }
    } finally {
        if (-not $process.HasExited) {
            $process.Kill()
        }
        $process.Dispose()
    }
    
    if ($exitCode -ne 0) {
        Write-Host "[ERROR] AWS CLI command failed with exit code $exitCode" -ForegroundColor Red
        Write-Host "Output:" -ForegroundColor Yellow
        $userPoolOutput | ForEach-Object { Write-Host $_ -ForegroundColor Red }
        throw "Failed to create user pool"
    }

    # Try to parse JSON output
    try {
        $userPoolResponse = $userPoolOutput | ConvertFrom-Json
    } catch {
        Write-Host "[ERROR] Failed to parse JSON response:" -ForegroundColor Red
        Write-Host $userPoolOutput -ForegroundColor Red
        throw "Invalid JSON response from AWS CLI"
    }

    # Clean up temporary files
    Remove-Item -Path $passwordPolicyFile -ErrorAction SilentlyContinue
    Remove-Item -Path $schemaFile -ErrorAction SilentlyContinue
    Remove-Item -Path $recoveryFile -ErrorAction SilentlyContinue
    Remove-Item -Path $verificationFile -ErrorAction SilentlyContinue
    Remove-Item -Path $cliInputFile -ErrorAction SilentlyContinue
    Remove-Item -Path $tempDir -ErrorAction SilentlyContinue

    if (-not $userPoolResponse.UserPool.Id) {
        throw "User Pool ID not found in response"
    }

    $USER_POOL_ID = $userPoolResponse.UserPool.Id
    Write-Host "[OK] User Pool created successfully!" -ForegroundColor Green
    Write-Host "   User Pool ID: $USER_POOL_ID" -ForegroundColor Cyan
} catch {
    Write-Host "[ERROR] Failed to create User Pool: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 2: Create App Client
Write-Host "Step 2: Creating App Client..." -ForegroundColor Yellow
Write-Host "   Client Name: $APP_CLIENT_NAME" -ForegroundColor Gray
Write-Host ""

try {
    if (-not $USER_POOL_ID) {
        throw "User Pool ID is required to create App Client"
    }

    # Build callback URLs array (include return URL if specified)
    $callbackUrls = @("http://localhost:3000/auth/callback", "https://yourdomain.com/auth/callback")
    if ($RETURN_URL -and $callbackUrls -notcontains $RETURN_URL) {
        $callbackUrls += $RETURN_URL
    }

    # Build command as string to avoid array issues
    $createClientCmd = "aws cognito-idp create-user-pool-client " +
        "--user-pool-id `"$USER_POOL_ID`" " +
        "--client-name `"$APP_CLIENT_NAME`" " +
        "--region `"$REGION`" " +
        "--no-generate-secret " +
        "--explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_SRP_AUTH " +
        "--supported-identity-providers COGNITO " +
        "--callback-urls `"$($callbackUrls -join '`" `"')`" " +
        "--logout-urls `"http://localhost:3000/login`" `"https://yourdomain.com/login`" " +
        "--allowed-o-auth-flows code " +
        "--allowed-o-auth-scopes email openid profile " +
        "--allowed-o-auth-flows-user-pool-client " +
        "--default-redirect-uri `"$RETURN_URL`" " +
        "--output json"

    Write-Host "   Executing AWS CLI command..." -ForegroundColor Gray
    
    # Capture both stdout and stderr
    $appClientOutput = & cmd /c "$createClientCmd 2>&1"
    $exitCode = $LASTEXITCODE
    
    if ($exitCode -ne 0) {
        Write-Host "[ERROR] AWS CLI command failed with exit code $exitCode" -ForegroundColor Red
        Write-Host "Command: $createClientCmd" -ForegroundColor Yellow
        Write-Host "Output:" -ForegroundColor Yellow
        $appClientOutput | ForEach-Object { Write-Host $_ -ForegroundColor Red }
        throw "Failed to create app client"
    }

    # Try to parse JSON output
    try {
        $appClientResponse = $appClientOutput | ConvertFrom-Json
    } catch {
        Write-Host "[ERROR] Failed to parse JSON response:" -ForegroundColor Red
        Write-Host $appClientOutput -ForegroundColor Red
        throw "Invalid JSON response from AWS CLI"
    }

    if (-not $appClientResponse.UserPoolClient.ClientId) {
        throw "Client ID not found in response"
    }

    $APP_CLIENT_ID = $appClientResponse.UserPoolClient.ClientId
    Write-Host "[OK] App Client created successfully!" -ForegroundColor Green
    Write-Host "   Client ID: $APP_CLIENT_ID" -ForegroundColor Cyan
    Write-Host "   Return URL: $RETURN_URL" -ForegroundColor Gray
} catch {
    Write-Host "[ERROR] Failed to create App Client: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 3: Create Cognito Domain (for OAuth)
Write-Host "Step 3: Creating Cognito Domain (for OAuth)..." -ForegroundColor Yellow
Write-Host "   Domain Prefix: $DOMAIN_PREFIX" -ForegroundColor Gray
Write-Host ""

try {
    if (-not $USER_POOL_ID) {
        throw "User Pool ID is required to create domain"
    }

    $createDomainCmd = "aws cognito-idp create-user-pool-domain " +
        "--domain `"$DOMAIN_PREFIX`" " +
        "--user-pool-id `"$USER_POOL_ID`" " +
        "--region `"$REGION`" " +
        "--output json"

    Write-Host "   Executing AWS CLI command..." -ForegroundColor Gray
    
    # Capture both stdout and stderr
    $domainOutput = & cmd /c "$createDomainCmd 2>&1"
    $exitCode = $LASTEXITCODE
    
    if ($exitCode -ne 0) {
        Write-Host "[WARNING] Domain creation failed (may already exist):" -ForegroundColor Yellow
        Write-Host "Command: $createDomainCmd" -ForegroundColor Gray
        Write-Host "Output:" -ForegroundColor Yellow
        $domainOutput | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
        throw "Domain creation failed"
    }

    $COGNITO_DOMAIN = "$DOMAIN_PREFIX.auth.$REGION.amazoncognito.com"
    Write-Host "[OK] Domain created successfully!" -ForegroundColor Green
    Write-Host "   Domain: $COGNITO_DOMAIN" -ForegroundColor Cyan
} catch {
    Write-Host "[WARNING] Domain creation failed (may already exist): $_" -ForegroundColor Yellow
    Write-Host "   Trying to get existing domain..." -ForegroundColor Gray
    try {
        $describeDomainCmd = "aws cognito-idp describe-user-pool-domain " +
            "--domain `"$DOMAIN_PREFIX`" " +
            "--region `"$REGION`" " +
            "--output json"
        
        $domainOutput = & cmd /c "$describeDomainCmd 2>&1"
        $exitCode = $LASTEXITCODE
        
        if ($exitCode -eq 0) {
            try {
                $domainResponse = $domainOutput | ConvertFrom-Json
                $COGNITO_DOMAIN = $domainResponse.DomainDescription.Domain
                Write-Host "[OK] Using existing domain: $COGNITO_DOMAIN" -ForegroundColor Green
            } catch {
                throw "Could not parse domain response"
            }
        } else {
            throw "Could not retrieve domain"
        }
    } catch {
        Write-Host "[ERROR] Could not retrieve domain. You may need to create it manually." -ForegroundColor Red
        $COGNITO_DOMAIN = "$DOMAIN_PREFIX.auth.$REGION.amazoncognito.com"
    }
}

Write-Host ""

# Output configuration
Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "[OK] Cognito Setup Complete!" -ForegroundColor Green
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

# Save configuration to file
$configFile = "cognito-config.txt"
$configContent = @"
===============================================================
AWS Cognito Configuration Details
===============================================================

User Pool Details:
  User Pool ID: $USER_POOL_ID
  User Pool Name: $USER_POOL_NAME
  Region: $REGION

App Client Details:
  Client ID: $APP_CLIENT_ID
  Client Name: $APP_CLIENT_NAME

Domain Details:
  Cognito Domain: $COGNITO_DOMAIN

Return URL (Default Redirect URI):
  Return URL: $RETURN_URL
  Note: This is the URL Cognito redirects to after successful sign-in with managed login pages

===============================================================
Environment Variables
===============================================================

# Backend .env (root directory)
COGNITO_USER_POOL_ID=$USER_POOL_ID
COGNITO_CLIENT_ID=$APP_CLIENT_ID
AWS_REGION=$REGION

# Frontend .env (frontend directory)
VITE_COGNITO_USER_POOL_ID=$USER_POOL_ID
VITE_COGNITO_CLIENT_ID=$APP_CLIENT_ID
VITE_AWS_REGION=$REGION
VITE_COGNITO_DOMAIN=$COGNITO_DOMAIN
VITE_OAUTH_REDIRECT_SIGN_IN=http://localhost:3000/auth/callback
VITE_OAUTH_REDIRECT_SIGN_OUT=http://localhost:3000/login
VITE_API_URL=http://localhost:3001

===============================================================
Next Steps
===============================================================

1. Copy the environment variables above to your .env files
2. Test the signup flow at http://localhost:3000/login
3. (Optional) Configure Google/Apple OAuth providers in AWS Console

===============================================================
"@

$configContent | Out-File -FilePath $configFile -Encoding UTF8
Write-Host "[INFO] Configuration saved to: $configFile" -ForegroundColor Cyan
Write-Host ""

Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "Environment Variables" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "# Backend .env (root directory)" -ForegroundColor Yellow
Write-Host "COGNITO_USER_POOL_ID=$USER_POOL_ID"
Write-Host "COGNITO_CLIENT_ID=$APP_CLIENT_ID"
Write-Host "AWS_REGION=$REGION"
Write-Host ""
Write-Host "# Frontend .env (frontend directory)" -ForegroundColor Yellow
Write-Host "VITE_COGNITO_USER_POOL_ID=$USER_POOL_ID"
Write-Host "VITE_COGNITO_CLIENT_ID=$APP_CLIENT_ID"
Write-Host "VITE_AWS_REGION=$REGION"
Write-Host "VITE_COGNITO_DOMAIN=$COGNITO_DOMAIN"
Write-Host "VITE_OAUTH_REDIRECT_SIGN_IN=http://localhost:3000/auth/callback"
Write-Host "VITE_OAUTH_REDIRECT_SIGN_OUT=http://localhost:3000/login"
Write-Host "VITE_API_URL=http://localhost:3001"
Write-Host ""
Write-Host "Return URL (Default Redirect URI):" -ForegroundColor Yellow
Write-Host "  $RETURN_URL" -ForegroundColor White
Write-Host "  (This is the URL Cognito redirects to after successful sign-in)" -ForegroundColor Gray
Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

# Optional: Google OAuth setup instructions
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "Optional: Google OAuth Setup" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To enable Google Sign-In (optional):" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Go to AWS Console -> Cognito -> User Pools -> $USER_POOL_ID" -ForegroundColor White
Write-Host "2. Navigate to 'Sign-in experience' -> 'Federated identity provider sign-in'" -ForegroundColor White
Write-Host "3. Click 'Add identity provider' -> Select 'Google'" -ForegroundColor White
Write-Host "4. Get Google OAuth credentials from: https://console.cloud.google.com/" -ForegroundColor White
Write-Host "5. Authorized redirect URI: https://$COGNITO_DOMAIN/oauth2/idpresponse" -ForegroundColor White
Write-Host "6. After adding Google, update app client with:" -ForegroundColor White
Write-Host ""
Write-Host "   aws cognito-idp update-user-pool-client \" -ForegroundColor Gray
Write-Host "     --user-pool-id $USER_POOL_ID \" -ForegroundColor Gray
Write-Host "     --client-id $APP_CLIENT_ID \" -ForegroundColor Gray
Write-Host "     --region $REGION \" -ForegroundColor Gray
Write-Host "     --supported-identity-providers COGNITO Google" -ForegroundColor Gray
Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""
