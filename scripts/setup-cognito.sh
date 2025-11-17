#!/bin/bash

# AWS Cognito Setup Script for VidVerse
# This script creates a Cognito User Pool with Google authentication enabled
# Region: us-west-2

set -e

REGION="us-west-2"
USER_POOL_NAME="vidverse-users"
APP_CLIENT_NAME="vidverse-web-client"
DOMAIN_PREFIX="vidverse-$(date +%s)"

echo "🚀 Setting up AWS Cognito User Pool in $REGION..."

# Step 1: Create User Pool
echo "📝 Creating User Pool..."
USER_POOL_ID=$(aws cognito-idp create-user-pool \
  --pool-name "$USER_POOL_NAME" \
  --region "$REGION" \
  --username-attributes email \
  --policies "PasswordPolicy={MinimumLength=8,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false}" \
  --schema \
    Name=email,AttributeDataType=String,Required=true,Mutable=true \
    Name=name,AttributeDataType=String,Required=false,Mutable=true \
  --query 'UserPool.Id' \
  --output text)

echo "✅ User Pool created: $USER_POOL_ID"

# Step 2: Create App Client (without client secret for public clients)
echo "📱 Creating App Client..."
APP_CLIENT_ID=$(aws cognito-idp create-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-name "$APP_CLIENT_NAME" \
  --region "$REGION" \
  --no-generate-secret \
  --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_SRP_AUTH \
  --supported-identity-providers COGNITO \
  --callback-urls "http://localhost:3000/auth/callback" "https://yourdomain.com/auth/callback" \
  --logout-urls "http://localhost:3000/login" "https://yourdomain.com/login" \
  --allowed-o-auth-flows code \
  --allowed-o-auth-scopes email openid profile \
  --allowed-o-auth-flows-user-pool-client \
  --query 'UserPoolClient.ClientId' \
  --output text)

echo "✅ App Client created: $APP_CLIENT_ID"

# Step 3: Create Cognito Domain
echo "🌐 Creating Cognito Domain..."
aws cognito-idp create-user-pool-domain \
  --domain "$DOMAIN_PREFIX" \
  --user-pool-id "$USER_POOL_ID" \
  --region "$REGION" \
  > /dev/null

COGNITO_DOMAIN="$DOMAIN_PREFIX.auth.$REGION.amazoncognito.com"
echo "✅ Domain created: $COGNITO_DOMAIN"

# Step 4: Create Identity Provider (Google) - Note: You need Google Client ID and Secret
echo "⚠️  Google Identity Provider setup requires manual configuration:"
echo ""
echo "1. Go to AWS Console → Cognito → User Pools → $USER_POOL_ID"
echo "2. Navigate to 'Sign-in experience' → 'Federated identity provider sign-in'"
echo "3. Click 'Add identity provider' → Select 'Google'"
echo "4. Enter your Google Client ID and Client Secret"
echo "5. Configure attribute mapping:"
echo "   - email → email"
echo "   - name → name"
echo "6. Save the configuration"
echo ""
echo "To get Google Client ID and Secret:"
echo "1. Go to https://console.cloud.google.com/"
echo "2. Create a new project or select existing"
echo "3. Enable Google+ API"
echo "4. Go to Credentials → Create OAuth 2.0 Client ID"
echo "5. Application type: Web application"
echo "6. Authorized redirect URIs: https://$COGNITO_DOMAIN/oauth2/idpresponse"
echo "7. Copy Client ID and Client Secret"
echo ""

# Step 5: Update App Client to include Google as identity provider
echo "📋 After adding Google identity provider, run this command:"
echo ""
echo "aws cognito-idp update-user-pool-client \\"
echo "  --user-pool-id $USER_POOL_ID \\"
echo "  --client-id $APP_CLIENT_ID \\"
echo "  --region $REGION \\"
echo "  --supported-identity-providers COGNITO Google \\"
echo "  --callback-urls http://localhost:3000/auth/callback https://yourdomain.com/auth/callback \\"
echo "  --logout-urls http://localhost:3000/login https://yourdomain.com/login \\"
echo "  --allowed-o-auth-flows code \\"
echo "  --allowed-o-auth-scopes email openid profile \\"
echo "  --allowed-o-auth-flows-user-pool-client"
echo ""

# Output configuration
echo "═══════════════════════════════════════════════════════════════"
echo "✅ Cognito Setup Complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Add these to your .env files:"
echo ""
echo "# Backend .env"
echo "COGNITO_USER_POOL_ID=$USER_POOL_ID"
echo "COGNITO_CLIENT_ID=$APP_CLIENT_ID"
echo "AWS_REGION=$REGION"
echo ""
echo "# Frontend .env"
echo "VITE_COGNITO_USER_POOL_ID=$USER_POOL_ID"
echo "VITE_COGNITO_CLIENT_ID=$APP_CLIENT_ID"
echo "VITE_AWS_REGION=$REGION"
echo "VITE_COGNITO_DOMAIN=$COGNITO_DOMAIN"
echo "VITE_OAUTH_REDIRECT_SIGN_IN=http://localhost:3000/auth/callback"
echo "VITE_OAUTH_REDIRECT_SIGN_OUT=http://localhost:3000/login"
echo "VITE_API_URL=http://localhost:3001"
echo ""
echo "═══════════════════════════════════════════════════════════════"

