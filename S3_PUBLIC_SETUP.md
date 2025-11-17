# S3 Bucket Public Access Setup Guide

This guide will help you make your S3 bucket public so videos can be accessed directly via URL.

## Step 1: Disable Block Public Access

1. Go to AWS Console → S3 → Your bucket (`vidverse-assets`)
2. Click on the **Permissions** tab
3. Scroll down to **Block public access (bucket settings)**
4. Click **Edit**
5. **Uncheck all 4 boxes**:
   - ☐ Block all public access
   - ☐ Block public access to buckets and objects granted through new access control lists (ACLs)
   - ☐ Block public access to buckets and objects granted through any access control lists (ACLs)
   - ☐ Block public access to buckets and objects granted through new public bucket or access point policies
6. Click **Save changes**
7. Type `confirm` and click **Confirm**

## Step 2: Add Bucket Policy

1. Still in the **Permissions** tab
2. Scroll to **Bucket policy**
3. Click **Edit**
4. Paste the following policy (replace `vidverse-assets` with your bucket name if different):

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

5. Click **Save changes**

## Step 3: Configure CORS (Required for Video Playback)

1. Still in the **Permissions** tab
2. Scroll to **Cross-origin resource sharing (CORS)**
3. Click **Edit**
4. Paste the following CORS configuration:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3000
  }
]
```

5. Click **Save changes**

## Step 4: Update Backend Configuration

1. Open your `backend/.env` file (or create it from `backend/env.example`)
2. Set the following:

```env
S3_USE_PRESIGNED_URLS=false
```

3. Restart your backend server

## Step 5: Verify Public Access

Test that your bucket is public by accessing a file directly:

1. Upload a test file to your bucket
2. Get the public URL (format: `https://vidverse-assets.s3.us-west-2.amazonaws.com/path/to/file.mp4`)
3. Open the URL in a browser or use curl:
   ```bash
   curl -I https://vidverse-assets.s3.us-west-2.amazonaws.com/path/to/file.mp4
   ```
4. You should see `HTTP/1.1 200 OK` (not 403 Forbidden)

## Troubleshooting

### If you get 403 Forbidden:
- Double-check that Block Public Access is disabled (all 4 boxes unchecked)
- Verify the bucket policy is saved correctly
- Make sure the bucket name in the policy matches your actual bucket name
- Wait a few minutes for changes to propagate

### If videos don't load in browser:
- Check CORS configuration is set correctly
- Verify the video URL format matches: `https://bucket-name.s3.region.amazonaws.com/key`
- Check browser console for CORS errors

### Security Note:
Making a bucket public means anyone with the URL can access the files. This is fine for public video hosting, but be aware that:
- URLs are not secret (though they're long and hard to guess)
- Files are accessible to anyone who has the URL
- Consider using CloudFront CDN for better performance and additional security options

## Alternative: Use CloudFront (Recommended for Production)

For better performance and security, consider using AWS CloudFront:
1. Create a CloudFront distribution pointing to your S3 bucket
2. Use CloudFront URLs instead of direct S3 URLs
3. Configure CloudFront to allow public access
4. Update your code to use CloudFront domain


