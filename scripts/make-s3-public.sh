#!/bin/bash
# Script to make S3 bucket public using AWS CLI
# Usage: ./make-s3-public.sh [bucket-name] [region]

BUCKET_NAME="${1:-vidverse-assets}"
REGION="${2:-us-west-2}"

echo "Making S3 bucket '$BUCKET_NAME' public..."

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
echo "Step 2: Applying bucket policy..."
aws s3api put-bucket-policy \
  --bucket "$BUCKET_NAME" \
  --policy file://s3-bucket-policy.json

if [ $? -eq 0 ]; then
  echo "✓ Bucket policy applied"
else
  echo "✗ Failed to apply bucket policy"
  exit 1
fi

# Step 3: Configure CORS
echo "Step 3: Configuring CORS..."
aws s3api put-bucket-cors \
  --bucket "$BUCKET_NAME" \
  --cors-configuration file://s3-cors-config.json

if [ $? -eq 0 ]; then
  echo "✓ CORS configured"
else
  echo "✗ Failed to configure CORS"
  exit 1
fi

echo ""
echo "✅ S3 bucket '$BUCKET_NAME' is now public!"
echo "Test with: aws s3 ls s3://$BUCKET_NAME/"


