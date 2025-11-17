#!/bin/bash

# Update Cognito App Client to Enable USER_PASSWORD_AUTH Flow
# This script updates an existing Cognito app client to enable password-based authentication

set -e

if [ $# -lt 2 ]; then
    echo "Usage: $0 <USER_POOL_ID> <CLIENT_ID> [REGION]"
    echo "Example: $0 us-east-1_xxxxxxxxx abc123def456 us-east-1"
    exit 1
fi

USER_POOL_ID="$1"
CLIENT_ID="$2"
REGION="${3:-us-east-1}"

echo "Updating Cognito App Client authentication flows..."
echo "  User Pool ID: $USER_POOL_ID"
echo "  Client ID: $CLIENT_ID"
echo "  Region: $REGION"
echo ""

# Get current client configuration
echo "Fetching current app client configuration..."
CURRENT_CLIENT=$(aws cognito-idp describe-user-pool-client \
    --user-pool-id "$USER_POOL_ID" \
    --client-id "$CLIENT_ID" \
    --region "$REGION" \
    --output json)

if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to fetch app client configuration"
    exit 1
fi

# Update the client with USER_PASSWORD_AUTH enabled
echo "Updating app client to enable USER_PASSWORD_AUTH..."

aws cognito-idp update-user-pool-client \
    --user-pool-id "$USER_POOL_ID" \
    --client-id "$CLIENT_ID" \
    --region "$REGION" \
    --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_SRP_AUTH \
    --output json > /dev/null

if [ $? -eq 0 ]; then
    echo "[OK] App client updated successfully!"
    echo ""
    echo "The app client now supports:"
    echo "  - USER_PASSWORD_AUTH (username/password authentication)"
    echo "  - USER_SRP_AUTH (Secure Remote Password)"
    echo "  - REFRESH_TOKEN_AUTH (token refresh)"
else
    echo "[ERROR] Failed to update app client"
    exit 1
fi

