#!/bin/bash
# Update S3 bucket CORS configuration to allow file uploads
# Usage: bash update-s3-cors.sh

BUCKET_NAME="vidverse-assets"

echo "Updating CORS configuration for S3 bucket '$BUCKET_NAME'..."
echo ""

# Update CORS configuration
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
  echo "✓ CORS configuration updated successfully"
  echo ""
  echo "Verifying CORS configuration..."
  aws s3api get-bucket-cors --bucket "$BUCKET_NAME" --output json
  echo ""
  echo "✅ CORS configuration updated! File uploads should now work."
else
  echo "✗ Failed to update CORS configuration"
  exit 1
fi


