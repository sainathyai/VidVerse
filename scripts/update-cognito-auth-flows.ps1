# Update Cognito App Client to Enable USER_PASSWORD_AUTH Flow
# This script updates an existing Cognito app client to enable password-based authentication

param(
    [Parameter(Mandatory=$true)]
    [string]$UserPoolId,
    
    [Parameter(Mandatory=$true)]
    [string]$ClientId,
    
    [string]$Region = "us-west-2"
)

Write-Host "Updating Cognito App Client authentication flows..." -ForegroundColor Cyan
Write-Host "  User Pool ID: $UserPoolId" -ForegroundColor Gray
Write-Host "  Client ID: $ClientId" -ForegroundColor Gray
Write-Host "  Region: $Region" -ForegroundColor Gray
Write-Host ""

try {
    # First, get the current client configuration
    Write-Host "Fetching current app client configuration..." -ForegroundColor Yellow
    $currentClient = aws cognito-idp describe-user-pool-client `
        --user-pool-id $UserPoolId `
        --client-id $ClientId `
        --region $Region `
        --output json | ConvertFrom-Json
    
    if (-not $currentClient.UserPoolClient) {
        throw "App client not found"
    }
    
    $client = $currentClient.UserPoolClient
    
    Write-Host "Current auth flows: $($client.ExplicitAuthFlows -join ', ')" -ForegroundColor Gray
    Write-Host ""
    
    # Update the client with USER_PASSWORD_AUTH enabled
    Write-Host "Updating app client to enable USER_PASSWORD_AUTH..." -ForegroundColor Yellow
    
    $updateCmd = "aws cognito-idp update-user-pool-client " +
        "--user-pool-id `"$UserPoolId`" " +
        "--client-id `"$ClientId`" " +
        "--region `"$Region`" " +
        "--explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_SRP_AUTH " +
        "--supported-identity-providers $($client.SupportedIdentityProviders -join ' ') " +
        "--callback-urls `"$($client.CallbackURLs -join '`" `"')`" " +
        "--logout-urls `"$($client.LogoutURLs -join '`" `"')`" "
    
    if ($client.AllowedOAuthFlows) {
        $updateCmd += "--allowed-o-auth-flows $($client.AllowedOAuthFlows -join ' ') "
    }
    
    if ($client.AllowedOAuthScopes) {
        $updateCmd += "--allowed-o-auth-scopes $($client.AllowedOAuthScopes -join ' ') "
    }
    
    if ($client.AllowedOAuthFlowsUserPoolClient) {
        $updateCmd += "--allowed-o-auth-flows-user-pool-client "
    }
    
    $updateCmd += "--output json"
    
    $result = & cmd /c "$updateCmd 2>&1"
    $exitCode = $LASTEXITCODE
    
    if ($exitCode -eq 0) {
        $updatedClient = $result | ConvertFrom-Json
        Write-Host "[OK] App client updated successfully!" -ForegroundColor Green
        Write-Host "  Enabled auth flows: $($updatedClient.UserPoolClient.ExplicitAuthFlows -join ', ')" -ForegroundColor Cyan
    } else {
        Write-Host "[ERROR] Failed to update app client" -ForegroundColor Red
        Write-Host $result -ForegroundColor Red
        exit 1
    }
    
} catch {
    Write-Host "[ERROR] Failed to update app client: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "Update Complete!" -ForegroundColor Green
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "The app client now supports:" -ForegroundColor Yellow
Write-Host "  - USER_PASSWORD_AUTH (username/password authentication)" -ForegroundColor White
Write-Host "  - USER_SRP_AUTH (Secure Remote Password)" -ForegroundColor White
Write-Host "  - REFRESH_TOKEN_AUTH (token refresh)" -ForegroundColor White
Write-Host ""

