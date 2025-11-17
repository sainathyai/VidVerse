# Quick fix script to enable USER_PASSWORD_AUTH flow
# This script reads from environment variables or prompts for values

param(
    [string]$UserPoolId,
    [string]$ClientId,
    [string]$Region = "us-west-2"
)

# Try to read from environment variables if not provided
if (-not $UserPoolId) {
    $UserPoolId = $env:COGNITO_USER_POOL_ID
}

if (-not $ClientId) {
    $ClientId = $env:COGNITO_CLIENT_ID
}

if (-not $UserPoolId -or -not $ClientId) {
    Write-Host "Error: User Pool ID and Client ID are required" -ForegroundColor Red
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor Yellow
    Write-Host "  .\scripts\fix-cognito-auth-flow.ps1 -UserPoolId <POOL_ID> -ClientId <CLIENT_ID> [-Region us-west-2]" -ForegroundColor White
    Write-Host ""
    Write-Host "Or set environment variables:" -ForegroundColor Yellow
    Write-Host "  `$env:COGNITO_USER_POOL_ID = 'us-west-2_xxxxxxxxx'" -ForegroundColor White
    Write-Host "  `$env:COGNITO_CLIENT_ID = 'xxxxxxxxxxxxxxxxxxxxxxxxxx'" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host "Enabling USER_PASSWORD_AUTH flow for Cognito client..." -ForegroundColor Cyan
Write-Host "  User Pool ID: $UserPoolId" -ForegroundColor Gray
Write-Host "  Client ID: $ClientId" -ForegroundColor Gray
Write-Host "  Region: $Region" -ForegroundColor Gray
Write-Host ""

# Get current client configuration
Write-Host "Fetching current configuration..." -ForegroundColor Yellow
try {
    $currentClient = aws cognito-idp describe-user-pool-client `
        --user-pool-id $UserPoolId `
        --client-id $ClientId `
        --region $Region `
        --output json 2>&1 | ConvertFrom-Json
    
    if (-not $currentClient.UserPoolClient) {
        Write-Host "Error: Could not find app client. Please verify your User Pool ID and Client ID." -ForegroundColor Red
        exit 1
    }
    
    $client = $currentClient.UserPoolClient
    Write-Host "Current auth flows: $($client.ExplicitAuthFlows -join ', ')" -ForegroundColor Gray
    Write-Host ""
    
    # Check if USER_PASSWORD_AUTH is already enabled
    if ($client.ExplicitAuthFlows -contains "ALLOW_USER_PASSWORD_AUTH") {
        Write-Host "USER_PASSWORD_AUTH is already enabled!" -ForegroundColor Green
        exit 0
    }
    
    # Build update command
    Write-Host "Updating app client..." -ForegroundColor Yellow
    
    $params = @(
        "cognito-idp",
        "update-user-pool-client",
        "--user-pool-id", $UserPoolId,
        "--client-id", $ClientId,
        "--region", $Region,
        "--explicit-auth-flows", "ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"
    )
    
    # Preserve existing settings
    if ($client.SupportedIdentityProviders) {
        $params += "--supported-identity-providers"
        $params += $client.SupportedIdentityProviders
    }
    
    if ($client.CallbackURLs) {
        $params += "--callback-urls"
        $params += $client.CallbackURLs
    }
    
    if ($client.LogoutURLs) {
        $params += "--logout-urls"
        $params += $client.LogoutURLs
    }
    
    if ($client.AllowedOAuthFlows) {
        $params += "--allowed-o-auth-flows"
        $params += $client.AllowedOAuthFlows
    }
    
    if ($client.AllowedOAuthScopes) {
        $params += "--allowed-o-auth-scopes"
        $params += $client.AllowedOAuthScopes
    }
    
    if ($client.AllowedOAuthFlowsUserPoolClient) {
        $params += "--allowed-o-auth-flows-user-pool-client"
    }
    
    $params += "--output", "json"
    
    $result = & aws $params 2>&1
    $exitCode = $LASTEXITCODE
    
    if ($exitCode -eq 0) {
        $updatedClient = $result | ConvertFrom-Json
        Write-Host ""
        Write-Host "===============================================================" -ForegroundColor Green
        Write-Host "Success! USER_PASSWORD_AUTH flow has been enabled." -ForegroundColor Green
        Write-Host "===============================================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "Enabled auth flows:" -ForegroundColor Cyan
        Write-Host "  $($updatedClient.UserPoolClient.ExplicitAuthFlows -join ', ')" -ForegroundColor White
        Write-Host ""
        Write-Host "You can now sign in with username and password!" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "Error: Failed to update app client" -ForegroundColor Red
        Write-Host $result -ForegroundColor Red
        exit 1
    }
    
} catch {
    Write-Host ""
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Make sure:" -ForegroundColor Yellow
    Write-Host "  1. AWS CLI is installed and configured" -ForegroundColor White
    Write-Host "  2. You have permissions to update Cognito User Pool clients" -ForegroundColor White
    Write-Host "  3. Your User Pool ID and Client ID are correct" -ForegroundColor White
    exit 1
}

