#!/bin/bash
# Script to make S3 bucket public using AWS CLI
# Run this in Git Bash: bash scripts/make-s3-public-bash.sh

BUCKET_NAME="vidverse-assets"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "Making S3 bucket '$BUCKET_NAME' public..."
echo "Working directory: $PROJECT_ROOT"
echo ""

# Step 1: Disable Block Public Access (already done, but verify)
echo "Step 1: Verifying block public access is disabled..."
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
if [ -f "s3-bucket-policy.json" ]; then
  aws s3api put-bucket-policy \
    --bucket "$BUCKET_NAME" \
    --policy "file://s3-bucket-policy.json"
  
  if [ $? -eq 0 ]; then
    echo "✓ Bucket policy applied"
  else
    echo "✗ Failed to apply bucket policy"
    exit 1
  fi
else
  echo "✗ s3-bucket-policy.json not found in $PROJECT_ROOT"
  exit 1
fi

# Step 3: Configure CORS
echo ""
echo "Step 3: Configuring CORS..."
if [ -f "s3-cors-config.json" ]; then
  aws s3api put-bucket-cors \
    --bucket "$BUCKET_NAME" \
    --cors-configuration "file://s3-cors-config.json"
  
  if [ $? -eq 0 ]; then
    echo "✓ CORS configured"
  else
    echo "✗ Failed to configure CORS"
    exit 1
  fi
else
  echo "✗ s3-cors-config.json not found in $PROJECT_ROOT"
  exit 1
fi

# Step 4: Verify
echo ""
echo "Step 4: Verifying configuration..."
echo ""
echo "Public Access Block Configuration:"
aws s3api get-public-access-block --bucket "$BUCKET_NAME" --query 'PublicAccessBlockConfiguration' --output json

echo ""
echo "Bucket Policy (first statement):"
aws s3api get-bucket-policy --bucket "$BUCKET_NAME" --query Policy --output text | python -m json.tool 2>/dev/null | head -15 || echo "Policy applied successfully"

echo ""
echo "CORS Configuration:"
aws s3api get-bucket-cors --bucket "$BUCKET_NAME" --output json

echo ""
echo "✅ S3 bucket '$BUCKET_NAME' is now public!"
echo ""
echo "Test with: aws s3 ls s3://$BUCKET_NAME/"


