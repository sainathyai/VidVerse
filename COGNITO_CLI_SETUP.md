# AWS Cognito CLI Setup Guide

This guide explains how to set up AWS Cognito using the AWS CLI for the VidVerse application.

## Prerequisites

1. **AWS Account**: You need an active AWS account
2. **AWS CLI**: Install AWS CLI v2 from https://aws.amazon.com/cli/
3. **AWS Credentials**: Configure your AWS credentials using `aws configure`

### Configure AWS Credentials

If you haven't configured AWS credentials yet, run:

```powershell
aws configure
```

You'll be prompted for:
- **AWS Access Key ID**: Your AWS access key
- **AWS Secret Access Key**: Your AWS secret key
- **Default region**: `us-east-1` (or your preferred region)
- **Default output format**: `json`

## Quick Setup

### Option 1: Run the PowerShell Script (Recommended for Windows)

1. Open PowerShell in the project root directory
2. Navigate to the scripts folder:
   ```powershell
   cd scripts
   ```
3. Run the setup script:
   ```powershell
   .\setup-cognito.ps1
   ```

The script will:
- ✅ Check if AWS CLI is installed
- ✅ Verify AWS credentials
- ✅ Create a Cognito User Pool
- ✅ Create an App Client
- ✅ Create a Cognito Domain (for OAuth)
- ✅ Save configuration to `cognito-config.txt`

### Option 2: Manual AWS CLI Commands

If you prefer to run commands manually, here are the step-by-step commands:

#### Step 1: Create User Pool

```powershell
aws cognito-idp create-user-pool `
  --pool-name "vidverse-users" `
  --region "us-east-1" `
  --auto-verified-attributes email `
  --username-attributes email `
  --policies "PasswordPolicy={MinimumLength=8,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false}" `
  --schema "Name=email,AttributeDataType=String,Required=true,Mutable=true" "Name=name,AttributeDataType=String,Required=false,Mutable=true" `
  --account-recovery-setting "RecoveryMechanisms=[{Priority=1,Name=verified_email}]" `
  --verification-message-template "EmailSubject=Your VidVerse verification code" "EmailMessage=Your verification code is {####}"
```

**Save the User Pool ID** from the response (format: `us-east-1_xxxxxxxxx`)

#### Step 2: Create App Client

Replace `YOUR_USER_POOL_ID` with the ID from Step 1:

```powershell
aws cognito-idp create-user-pool-client `
  --user-pool-id "YOUR_USER_POOL_ID" `
  --client-name "vidverse-web-client" `
  --region "us-east-1" `
  --no-generate-secret `
  --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_SRP_AUTH `
  --supported-identity-providers COGNITO `
  --callback-urls "http://localhost:3000/auth/callback" "https://yourdomain.com/auth/callback" `
  --logout-urls "http://localhost:3000/login" "https://yourdomain.com/login" `
  --allowed-o-auth-flows code `
  --allowed-o-auth-scopes email openid profile `
  --allowed-o-auth-flows-user-pool-client
```

**Save the Client ID** from the response

#### Step 3: Create Cognito Domain

Replace `YOUR_USER_POOL_ID` with your User Pool ID:

```powershell
aws cognito-idp create-user-pool-domain `
  --domain "vidverse-$(Get-Date -Format 'yyyyMMddHHmmss')" `
  --user-pool-id "YOUR_USER_POOL_ID" `
  --region "us-east-1"
```

The domain will be: `vidverse-YYYYMMDDHHMMSS.auth.us-east-1.amazoncognito.com`

## Configuration Details

After running the script, you'll receive:

### User Pool Configuration
- **User Pool ID**: `us-east-1_xxxxxxxxx`
- **User Pool Name**: `vidverse-users`
- **Region**: `us-east-1`
- **Username**: Email-based authentication
- **Password Policy**: 
  - Minimum 8 characters
  - Requires uppercase, lowercase, and numbers
  - Symbols optional

### App Client Configuration
- **Client ID**: `xxxxxxxxxxxxxxxxxxxxxxxxxx`
- **Client Name**: `vidverse-web-client`
- **Auth Flows**: 
  - User password authentication
  - SRP authentication
  - Refresh token authentication
- **OAuth**: Enabled with code flow
- **Scopes**: email, openid, profile

### Domain Configuration
- **Domain**: `vidverse-YYYYMMDDHHMMSS.auth.us-east-1.amazoncognito.com`
- **Purpose**: OAuth redirects for Google/Apple sign-in

## Environment Variables

After setup, add these to your environment files:

### Backend `.env` (root directory)

```env
COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
AWS_REGION=us-east-1
```

### Frontend `.env` (frontend directory)

```env
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_AWS_REGION=us-east-1
VITE_COGNITO_DOMAIN=vidverse-YYYYMMDDHHMMSS.auth.us-east-1.amazoncognito.com
VITE_OAUTH_REDIRECT_SIGN_IN=http://localhost:3000/auth/callback
VITE_OAUTH_REDIRECT_SIGN_OUT=http://localhost:3000/login
VITE_API_URL=http://localhost:3001
```

## Verify Setup

### Check User Pool

```powershell
aws cognito-idp describe-user-pool `
  --user-pool-id "YOUR_USER_POOL_ID" `
  --region "us-east-1"
```

### Check App Client

```powershell
aws cognito-idp describe-user-pool-client `
  --user-pool-id "YOUR_USER_POOL_ID" `
  --client-id "YOUR_CLIENT_ID" `
  --region "us-east-1"
```

### List All User Pools

```powershell
aws cognito-idp list-user-pools `
  --max-results 10 `
  --region "us-east-1"
```

## Testing Authentication

1. Start your frontend application:
   ```powershell
   cd frontend
   npm run dev
   ```

2. Navigate to: http://localhost:3000/login

3. Click "Create account" and test the signup flow:
   - Enter your email
   - Enter a password (meets requirements)
   - Retype password
   - Submit

4. Check your email for the verification code

5. Enter the verification code to confirm your account

6. Sign in with your email and password

## Optional: Google OAuth Setup

To enable Google Sign-In:

1. **Get Google OAuth Credentials**:
   - Go to https://console.cloud.google.com/
   - Create a new project or select existing
   - Enable Google+ API
   - Go to Credentials → Create OAuth 2.0 Client ID
   - Application type: Web application
   - Authorized redirect URI: `https://YOUR_COGNITO_DOMAIN/oauth2/idpresponse`
   - Save Client ID and Client Secret

2. **Add Google Identity Provider in AWS Console**:
   - Go to AWS Console → Cognito → User Pools → Your User Pool
   - Navigate to "Sign-in experience" → "Federated identity provider sign-in"
   - Click "Add identity provider" → Select "Google"
   - Enter Google Client ID and Client Secret
   - Configure attribute mapping:
     - email → email
     - name → name
   - Save

3. **Update App Client via CLI**:

```powershell
aws cognito-idp update-user-pool-client `
  --user-pool-id "YOUR_USER_POOL_ID" `
  --client-id "YOUR_CLIENT_ID" `
  --region "us-east-1" `
  --supported-identity-providers COGNITO Google `
  --callback-urls "http://localhost:3000/auth/callback" "https://yourdomain.com/auth/callback" `
  --logout-urls "http://localhost:3000/login" "https://yourdomain.com/login" `
  --allowed-o-auth-flows code `
  --allowed-o-auth-scopes email openid profile `
  --allowed-o-auth-flows-user-pool-client
```

## Troubleshooting

### Error: "AWS CLI not found"
- Install AWS CLI from: https://aws.amazon.com/cli/
- Restart PowerShell after installation

### Error: "Unable to locate credentials"
- Run `aws configure` to set up credentials
- Verify credentials with: `aws sts get-caller-identity`

### Error: "User pool name already exists"
- Either delete the existing pool or use a different name
- List pools: `aws cognito-idp list-user-pools --max-results 10 --region us-east-1`
- Delete pool: `aws cognito-idp delete-user-pool --user-pool-id YOUR_POOL_ID --region us-east-1`

### Error: "Domain already exists"
- Cognito domains must be globally unique
- The script uses a timestamp-based domain name
- If it still fails, manually create a domain with a unique name

### Signup fails with "Invalid email"
- Ensure email format is valid
- Check that email verification is enabled in the user pool

### Verification code not received
- Check spam folder
- Verify email address is correct
- Check Cognito email sending limits (SES sandbox mode)

## Cleanup

To delete the Cognito resources:

```powershell
# Delete App Client
aws cognito-idp delete-user-pool-client `
  --user-pool-id "YOUR_USER_POOL_ID" `
  --client-id "YOUR_CLIENT_ID" `
  --region "us-east-1"

# Delete Domain
aws cognito-idp delete-user-pool-domain `
  --domain "YOUR_DOMAIN_PREFIX" `
  --region "us-east-1"

# Delete User Pool
aws cognito-idp delete-user-pool `
  --user-pool-id "YOUR_USER_POOL_ID" `
  --region "us-east-1"
```

**Warning**: This will permanently delete all users and data in the user pool!

## Additional Resources

- [AWS Cognito Documentation](https://docs.aws.amazon.com/cognito/)
- [AWS CLI Cognito Commands](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/)
- [Amplify Auth Documentation](https://docs.amplify.aws/react/build-a-backend/auth/)

## Support

If you encounter issues:
1. Check the `cognito-config.txt` file for your configuration details
2. Verify all environment variables are set correctly
3. Check AWS CloudWatch Logs for Cognito errors
4. Review the troubleshooting section above

