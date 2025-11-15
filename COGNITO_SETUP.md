# AWS Cognito Authentication Setup Guide

## Overview

VidVerse uses AWS Cognito for user authentication. This guide explains how to set up Cognito and configure the application.

## AWS Cognito Setup

### 1. Create Cognito User Pool

1. Go to AWS Console → Cognito → User Pools
2. Click "Create user pool"
3. Configure sign-in options:
   - Choose "Email" as sign-in option
   - Click "Next"
4. Configure security requirements:
   - Password policy: Choose your requirements
   - MFA: Optional (recommended for production)
   - Click "Next"
5. Configure sign-up experience:
   - Self-service sign-up: Enabled
   - Cognito-assisted verification: Email
   - Click "Next"
6. Configure message delivery:
   - Email provider: Send email with Cognito
   - Click "Next"
7. Integrate your app:
   - User pool name: `vidverse-users`
   - App client name: `vidverse-web-client`
   - Don't generate client secret (for public clients)
   - Click "Next"
8. Review and create

### 2. Get Configuration Values

After creating the user pool, note down:

- **User Pool ID**: `us-east-1_xxxxxxxxx` (found in User Pool details)
- **App Client ID**: `xxxxxxxxxxxxxxxxxxxxxxxxxx` (found in App integration → App clients)

### 3. Configure Environment Variables

#### Backend (`.env` or environment variables)

```env
COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
AWS_REGION=us-east-1
```

#### Frontend (`.env.local`)

```env
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_AWS_REGION=us-east-1
```

## S3 Storage Setup

### 1. Create S3 Bucket

1. Go to AWS Console → S3
2. Click "Create bucket"
3. Configure:
   - Bucket name: `vidverse-assets` (must be globally unique)
   - AWS Region: `us-east-1` (or your preferred region)
   - Block Public Access: Uncheck (or configure bucket policy for public reads)
   - Click "Create bucket"

### 2. Configure Bucket Policy (for public reads)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::vidverse-assets/*"
    }
  ]
}
```

### 3. Configure CORS (if needed)

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedOrigins": ["http://localhost:3000", "https://yourdomain.com"],
    "ExposeHeaders": ["ETag"]
  }
]
```

### 4. Create IAM User for S3 Access

1. Go to IAM → Users → Create user
2. User name: `vidverse-s3-user`
3. Attach policy: `AmazonS3FullAccess` (or create custom policy with minimal permissions)
4. Create access key:
   - Access key type: Application running outside AWS
   - Save Access Key ID and Secret Access Key

### 5. Configure S3 Environment Variables

```env
S3_BUCKET_NAME=vidverse-assets
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your-access-key-id
S3_SECRET_ACCESS_KEY=your-secret-access-key
S3_ENDPOINT=https://s3.amazonaws.com
```

## S3 Folder Structure

All assets are organized in S3 with the following structure:

```
vidverse-assets/
├── users/
│   ├── {userId}/
│   │   ├── audio/              # User-uploaded audio files
│   │   ├── image/              # User-uploaded images
│   │   ├── video/              # User-uploaded videos
│   │   ├── brand_kit/          # Brand assets
│   │   └── projects/
│   │       ├── {projectId}/
│   │       │   ├── audio/      # Project-specific audio
│   │       │   ├── video/      # Generated videos
│   │       │   ├── frame/      # First/last frames
│   │       │   └── image/      # Generated images
```

## Testing Authentication

### 1. Sign Up

1. Visit http://localhost:3000/login
2. Click "Don't have an account? Sign up"
3. Enter email, username, and password
4. Submit form
5. Check email for confirmation code

### 2. Confirm Account

1. Enter confirmation code from email
2. Click "Confirm"
3. You'll be redirected to sign in

### 3. Sign In

1. Enter username and password
2. Click "Sign In"
3. You'll be redirected to dashboard

## Development Mode

If Cognito is not configured, the application will:
- Allow requests without authentication (development fallback)
- Use a default user ID: `dev-user-123`
- Log warnings about missing Cognito configuration

To enable full authentication, configure all Cognito environment variables.

## Security Best Practices

1. **Never commit credentials**: Use environment variables, never hardcode
2. **Use IAM roles**: In production, use IAM roles instead of access keys when possible
3. **Restrict S3 permissions**: Create custom IAM policy with minimal required permissions
4. **Enable MFA**: Enable MFA for Cognito user pool in production
5. **Use HTTPS**: Always use HTTPS in production
6. **Rotate keys**: Regularly rotate access keys
7. **Monitor access**: Enable CloudTrail for S3 access logging

## Troubleshooting

### "Unable to determine transport target"
- Install `pino-pretty`: `npm install -D pino-pretty`

### "Unauthorized" errors
- Check Cognito configuration in environment variables
- Verify user pool ID and client ID are correct
- Ensure user has confirmed their account

### S3 upload failures
- Verify S3 credentials are correct
- Check bucket policy allows uploads
- Verify CORS configuration if uploading from browser
- Check IAM user has necessary permissions

### Token verification fails
- Ensure `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` are set
- Verify token is being sent in Authorization header
- Check token hasn't expired

## Next Steps

1. Set up Cognito User Pool
2. Configure environment variables
3. Create S3 bucket
4. Set up IAM user for S3
5. Test authentication flow
6. Test file uploads

---

For production deployment, consider:
- Using AWS Secrets Manager for credentials
- Setting up CloudFront CDN for S3 assets
- Implementing proper error handling and logging
- Setting up monitoring and alerts

