#!/bin/bash
# Run this script in Git Bash to make S3 bucket public
# Usage: bash make-s3-public.sh

BUCKET_NAME="vidverse-assets"

echo "Making S3 bucket '$BUCKET_NAME' public..."
echo ""

# Step 1: Disable Block Public Access
echo "Step 1: Disabling block public access..."
aws s3api put-public-access-block \
  --bucket "$BUCKET_NAME" \
  --public-access-block-configuration \
  "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

if [ $? -eq 0 ]; then
  echo "✓ Block public access disabled"
else
  echo "✗ Failed to disable block public access"
  exit 1
fi

# Step 2: Apply bucket policy
echo ""
echo "Step 2: Applying bucket policy..."
aws s3api put-bucket-policy \
  --bucket "$BUCKET_NAME" \
  --policy '{
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
  }'

if [ $? -eq 0 ]; then
  echo "✓ Bucket policy applied"
else
  echo "✗ Failed to apply bucket policy"
  exit 1
fi

# Step 3: Configure CORS
echo ""
echo "Step 3: Configuring CORS..."
aws s3api put-bucket-cors \
  --bucket "$BUCKET_NAME" \
  --cors-configuration '{
    "CORSRules": [
      {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
        "AllowedOrigins": ["*"],
        "ExposeHeaders": ["ETag", "x-amz-request-id", "x-amz-version-id"],
        "MaxAgeSeconds": 3000
      }
    ]
  }'

if [ $? -eq 0 ]; then
  echo "✓ CORS configured"
else
  echo "✗ Failed to configure CORS"
  exit 1
fi

# Step 4: Verify
echo ""
echo "Step 4: Verifying configuration..."
echo ""
echo "Public Access Block:"
aws s3api get-public-access-block --bucket "$BUCKET_NAME" --query 'PublicAccessBlockConfiguration' --output json

echo ""
echo "Bucket Policy:"
aws s3api get-bucket-policy --bucket "$BUCKET_NAME" --query Policy --output text | python -m json.tool 2>/dev/null || echo "Policy exists"

echo ""
echo "CORS Configuration:"
aws s3api get-bucket-cors --bucket "$BUCKET_NAME" --output json

echo ""
echo "✅ S3 bucket '$BUCKET_NAME' is now public!"
echo ""
echo "Test with: aws s3 ls s3://$BUCKET_NAME/"

