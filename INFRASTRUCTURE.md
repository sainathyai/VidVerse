# Infrastructure Architecture & Setup

## Overview

VidVerse uses AWS services for authentication and storage, with a modern serverless-ready architecture that can scale efficiently.

## AWS Services

### 1. AWS Cognito (Authentication)

**Purpose:** User authentication and authorization

**Components:**
- **User Pool**: `vidverse-users` - Manages user accounts
- **App Client**: `vidverse-web-client` - Public client for web app
- **JWT Tokens**: Access tokens for API authentication

**Configuration:**
- Sign-in method: Email
- Password policy: Custom (min 8 chars, uppercase, lowercase, numbers, symbols)
- MFA: Optional (recommended for production)
- Self-service sign-up: Enabled
- Email verification: Required

**Environment Variables:**
```env
# Backend
COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
AWS_REGION=us-east-1

# Frontend
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_AWS_REGION=us-east-1
```

**Setup Guide:** See `COGNITO_SETUP.md`

### 2. AWS S3 (Object Storage)

**Purpose:** Store all assets (videos, frames, audio, images, brand kits)

**Bucket Configuration:**
- **Bucket Name**: `vidverse-assets` (globally unique)
- **Region**: `us-east-1` (or your preferred region)
- **Public Access**: Configured for public reads (or use presigned URLs)
- **Versioning**: Enabled (optional, for recovery)
- **Lifecycle Policies**: Archive old assets after 90 days (optional)

**Folder Structure:**
```
vidverse-assets/
├── users/
│   └── {cognitoUserId}/
│       ├── audio/              # User-uploaded audio
│       ├── image/              # User-uploaded images
│       ├── video/              # User-uploaded videos
│       ├── brand_kit/          # Brand assets
│       └── projects/
│           └── {projectId}/
│               ├── audio/      # Project audio files
│               ├── video/      # Generated videos
│               ├── frame/      # First/last frames
│               └── image/      # Generated images
```

**IAM Policy (Minimal Permissions):**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:PutObjectAcl"
      ],
      "Resource": "arn:aws:s3:::vidverse-assets/users/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::vidverse-assets",
      "Condition": {
        "StringLike": {
          "s3:prefix": "users/${cognito-identity.amazonaws.com:sub}/*"
        }
      }
    }
  ]
}
```

**CORS Configuration:**
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://yourdomain.com"
    ],
    "ExposeHeaders": ["ETag", "x-amz-request-id"],
    "MaxAgeSeconds": 3000
  }
]
```

**Bucket Policy (Public Reads):**
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

**Environment Variables:**
```env
S3_BUCKET_NAME=vidverse-assets
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your-access-key-id
S3_SECRET_ACCESS_KEY=your-secret-access-key
S3_ENDPOINT=https://s3.amazonaws.com
```

### 3. CloudFront CDN (Optional but Recommended)

**Purpose:** Fast global delivery of generated videos and assets

**Configuration:**
- Origin: S3 bucket `vidverse-assets`
- Distribution type: Web
- Price class: Use all edge locations (or reduce for cost savings)
- Caching: 24 hours for videos, 1 hour for images
- HTTPS: Required

**Benefits:**
- Reduced latency for video playback
- Lower S3 egress costs
- Better user experience globally

## Infrastructure Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    AWS Cloud Infrastructure                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │  AWS Cognito     │         │   AWS S3         │         │
│  │  User Pool       │         │   vidverse-assets│         │
│  │                  │         │                  │         │
│  │  • User accounts │         │  • Videos        │         │
│  │  • JWT tokens    │         │  • Frames        │         │
│  │  • MFA           │         │  • Audio         │         │
│  └────────┬─────────┘         │  • Images        │         │
│           │                    └────────┬─────────┘         │
│           │                             │                   │
│           │                    ┌────────▼─────────┐         │
│           │                    │  CloudFront CDN  │         │
│           │                    │  (Optional)      │         │
│           │                    └──────────────────┘         │
│           │                                                  │
└───────────┼──────────────────────────────────────────────────┘
            │
            │ JWT Tokens
            │
┌───────────▼──────────────────────────────────────────────────┐
│              Application Layer                                │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐              ┌──────────────┐             │
│  │   Frontend   │              │   Backend    │             │
│  │   Next.js    │◄────────────►│   Fastify    │             │
│  │              │   API Calls  │              │             │
│  │ • Amplify    │              │ • Cognito    │             │
│  │ • Auth UI    │              │   Middleware │             │
│  └──────────────┘              │ • S3 Service │             │
│                                 └──────────────┘             │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## Setup Checklist

### AWS Cognito Setup
- [ ] Create Cognito User Pool
- [ ] Configure sign-in options (Email)
- [ ] Set password policy
- [ ] Create App Client (no client secret)
- [ ] Enable self-service sign-up
- [ ] Configure email verification
- [ ] Test sign-up/sign-in flow
- [ ] Add environment variables

### AWS S3 Setup
- [ ] Create S3 bucket (`vidverse-assets`)
- [ ] Configure bucket region
- [ ] Set up bucket policy (public reads or presigned URLs)
- [ ] Configure CORS policy
- [ ] Create IAM user for S3 access
- [ ] Generate access keys
- [ ] Test upload/download
- [ ] Add environment variables
- [ ] (Optional) Set up CloudFront distribution
- [ ] (Optional) Configure lifecycle policies

### IAM Setup
- [ ] Create IAM user for application
- [ ] Attach S3 access policy
- [ ] Generate access keys
- [ ] Store keys securely (AWS Secrets Manager or environment variables)
- [ ] (Optional) Create IAM role for EC2/Lambda (if using)

### Security Best Practices
- [ ] Enable MFA on AWS root account
- [ ] Use IAM roles instead of access keys when possible
- [ ] Rotate access keys regularly
- [ ] Enable CloudTrail for audit logging
- [ ] Set up S3 bucket versioning
- [ ] Configure S3 bucket encryption (SSE-S3 or SSE-KMS)
- [ ] Set up CloudWatch alarms for unusual activity
- [ ] Use VPC endpoints for S3 (if in VPC)

## Cost Estimation

### AWS Cognito
- **Free Tier**: 50,000 MAU (Monthly Active Users)
- **Pricing**: $0.0055 per MAU after free tier
- **Estimated Cost**: $0-50/month (depending on usage)

### AWS S3
- **Storage**: $0.023 per GB/month (Standard)
- **PUT Requests**: $0.005 per 1,000 requests
- **GET Requests**: $0.0004 per 1,000 requests
- **Data Transfer Out**: $0.09 per GB (first 10 TB)
- **Estimated Cost**: $10-100/month (depending on storage and traffic)

### CloudFront (Optional)
- **Data Transfer Out**: $0.085 per GB (first 10 TB)
- **Requests**: $0.0075 per 10,000 HTTPS requests
- **Estimated Cost**: $5-50/month (depending on traffic)

**Total Estimated Monthly Cost**: $15-200/month (depending on usage)

## Monitoring & Alerts

### CloudWatch Metrics to Monitor
- Cognito sign-in failures
- S3 bucket size
- S3 request counts
- API Gateway errors (if using)
- Lambda invocations (if using)

### Recommended Alerts
- S3 bucket size > 100 GB
- Unusual API error rates
- Cognito authentication failures > threshold
- Cost anomalies

## Disaster Recovery

### Backup Strategy
- **S3 Versioning**: Enable for critical assets
- **Cross-Region Replication**: Optional, for critical data
- **Database Backups**: Daily automated backups (PostgreSQL)
- **Configuration Backups**: Infrastructure as Code (Terraform/CloudFormation)

### Recovery Procedures
1. **S3 Data Loss**: Restore from versioning or cross-region replica
2. **Cognito Issues**: User data can be exported/imported
3. **Application Failure**: Redeploy from version control

## Scaling Considerations

### Horizontal Scaling
- Frontend: Vercel/Cloudflare Pages (auto-scales)
- Backend: Railway/Render (auto-scales based on load)
- S3: Automatically scales (no configuration needed)
- Cognito: Automatically scales (no configuration needed)

### Performance Optimization
- CloudFront CDN for asset delivery
- S3 Transfer Acceleration for uploads
- Redis caching for frequently accessed data
- Database connection pooling

## Compliance & Security

### Data Privacy
- User data encrypted at rest (S3 SSE)
- User data encrypted in transit (HTTPS/TLS)
- Cognito user data stored in AWS (GDPR compliant)
- User can request data deletion

### Access Control
- IAM policies for least privilege access
- Cognito user pools for authentication
- S3 bucket policies for object access
- API rate limiting per user

## Troubleshooting

### Common Issues

**Cognito Token Verification Fails**
- Check User Pool ID and Client ID are correct
- Verify token hasn't expired
- Check token format (Bearer token)
- Verify Cognito region matches configuration

**S3 Upload Fails**
- Check IAM permissions
- Verify bucket policy allows uploads
- Check CORS configuration
- Verify access keys are correct
- Check bucket exists and is accessible

**CORS Errors**
- Verify CORS policy on S3 bucket
- Check allowed origins include your domain
- Verify allowed methods include PUT/GET
- Check browser console for specific CORS error

## Next Steps

1. **Set up AWS Account** (if not already done)
2. **Create Cognito User Pool** (see `COGNITO_SETUP.md`)
3. **Create S3 Bucket** and configure policies
4. **Set up IAM User** for S3 access
5. **Configure Environment Variables** in both frontend and backend
6. **Test Authentication Flow**
7. **Test File Uploads to S3**
8. **Set up CloudFront** (optional, for production)
9. **Configure Monitoring** and alerts
10. **Document Access Credentials** securely

---

**Last Updated**: After PR2 completion  
**Status**: Infrastructure ready for PR3 (MVP Pipeline)

