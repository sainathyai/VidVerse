# Email Forwarding Setup for sainathayai.com

## Step 1: Add Domain Verification TXT Record to Route 53

1. Go to **AWS Route 53 Console** → **Hosted zones**
2. Select your domain: `sainathayai.com`
3. Click **Create record**
4. Configure:
   - **Record name**: `_amazonses` (leave blank for root domain, or use `_amazonses.sainathayai.com`)
   - **Record type**: `TXT`
   - **Value**: `iphKNblQtShu79SnPCcXzyEsgDozNNjtXYIL/orpC4s=`
   - **TTL**: `300` (or default)
5. Click **Create records**

**Note**: For root domain verification, the record name should be just `_amazonses` (not `_amazonses.sainathayai.com`)

## Step 2: Verify Domain Status

Wait a few minutes, then check verification status:

```bash
aws ses get-identity-verification-attributes --identities sainathayai.com --region us-east-1
```

Once verified, you'll see `"VerificationStatus": "Success"`

## Step 3: Enable DKIM (Recommended for Email Authentication)

After domain verification, enable DKIM:

```bash
aws ses set-identity-dkim-enabled --identity sainathayai.com --dkim-enabled --region us-east-1
```

Get DKIM tokens:

```bash
aws ses get-identity-dkim-attributes --identities sainathayai.com --region us-east-1
```

Add the 3 CNAME records provided to Route 53:
- Record type: `CNAME`
- Record name: `[token1]._domainkey.sainathayai.com`
- Value: `[token1].dkim.amazonses.com`
- Repeat for token2 and token3

## Step 4: Create Lambda Function for Email Forwarding

Create a file `lambda-email-forwarder.js`:

```javascript
const AWS = require('aws-sdk');
const ses = new AWS.SES({ region: 'us-east-1' });

// Configure your forwarding rules here
const FORWARDING_RULES = {
    'info@sainathayai.com': 'your-email@gmail.com',
    'contact@sainathayai.com': 'your-email@gmail.com',
    'support@sainathayai.com': 'your-email@gmail.com',
    'hello@sainathayai.com': 'your-email@gmail.com',
    // Add '*' to forward all unmatched emails
    '*': 'your-email@gmail.com'
};

exports.handler = async (event) => {
    console.log('Received event:', JSON.stringify(event, null, 2));
    
    const forwardTo = process.env.FORWARD_TO_EMAIL || 'your-email@gmail.com';
    
    for (const record of event.Records) {
        const { mail, content } = record.ses;
        const originalRecipient = mail.destination[0];
        const originalSender = mail.commonHeaders.from[0];
        const subject = mail.commonHeaders.subject || '(No Subject)';
        
        // Determine forwarding address
        let targetEmail = FORWARDING_RULES[originalRecipient] || 
                         FORWARDING_RULES['*'] || 
                         forwardTo;
        
        try {
            // Parse the email content
            let emailBody = '';
            if (content) {
                // Try to extract text content
                if (typeof content === 'string') {
                    emailBody = content;
                } else if (content.data) {
                    emailBody = Buffer.from(content.data, 'base64').toString('utf-8');
                }
            }
            
            // Create forwarded email
            const forwardedSubject = `Fwd: ${subject}`;
            const forwardedBody = `
---------- Forwarded Message ----------
From: ${originalSender}
To: ${originalRecipient}
Date: ${mail.commonHeaders.date}
Subject: ${subject}

${emailBody}
            `.trim();
            
            // Send email via SES
            await ses.sendEmail({
                Source: originalRecipient, // Use original recipient as sender
                Destination: {
                    ToAddresses: [targetEmail]
                },
                Message: {
                    Subject: {
                        Data: forwardedSubject,
                        Charset: 'UTF-8'
                    },
                    Body: {
                        Text: {
                            Data: forwardedBody,
                            Charset: 'UTF-8'
                        }
                    }
                }
            }).promise();
            
            console.log(`Forwarded email from ${originalSender} to ${originalRecipient} → ${targetEmail}`);
        } catch (error) {
            console.error('Error forwarding email:', error);
            throw error;
        }
    }
    
    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Email forwarded successfully' })
    };
};
```

## Step 5: Deploy Lambda Function

### Option A: Using AWS Console

1. Go to **Lambda Console** → **Create function**
2. Choose **Author from scratch**
3. Function name: `sainathayai-email-forwarder`
4. Runtime: **Node.js 18.x** (or latest)
5. Create function
6. Paste the code above
7. Update `FORWARDING_RULES` with your email addresses
8. Click **Deploy**

### Option B: Using AWS CLI

```bash
# Create deployment package
zip email-forwarder.zip lambda-email-forwarder.js

# Create Lambda function
aws lambda create-function \
  --function-name sainathayai-email-forwarder \
  --runtime nodejs18.x \
  --role arn:aws:iam::YOUR_ACCOUNT_ID:role/lambda-ses-role \
  --handler index.handler \
  --zip-file fileb://email-forwarder.zip \
  --region us-east-1

# Or update existing function
aws lambda update-function-code \
  --function-name sainathayai-email-forwarder \
  --zip-file fileb://email-forwarder.zip \
  --region us-east-1
```

## Step 6: Set Up IAM Role for Lambda

The Lambda function needs permissions to:
- Read from S3 (where SES stores emails)
- Send emails via SES

Create IAM role with this policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::YOUR_SES_BUCKET/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

## Step 7: Configure SES Receipt Rules

### Create Receipt Rule Set

```bash
# Create rule set
aws ses create-receipt-rule-set --rule-set-name sainathayai-forwarding --region us-east-1

# Set as active rule set
aws ses set-active-receipt-rule-set --rule-set-name sainathayai-forwarding --region us-east-1
```

### Create Receipt Rule

```bash
# Create rule that forwards all emails to Lambda
aws ses create-receipt-rule \
  --rule-set-name sainathayai-forwarding \
  --rule '{
    "Name": "forward-all",
    "Enabled": true,
    "Recipients": ["*@sainathayai.com"],
    "Actions": [
      {
        "LambdaAction": {
          "FunctionArn": "arn:aws:lambda:us-east-1:YOUR_ACCOUNT_ID:function:sainathayai-email-forwarder",
          "InvocationType": "Event"
        }
      }
    ]
  }' \
  --region us-east-1
```

**Or via Console:**
1. Go to **SES Console** → **Email receiving** → **Rule sets**
2. Create rule set: `sainathayai-forwarding`
3. Set as active
4. Add rule:
   - Rule name: `forward-all`
   - Recipients: `*@sainathayai.com` (or specific addresses)
   - Action: **Invoke AWS Lambda function**
   - Function: `sainathayai-email-forwarder`
   - Invocation type: **Event**

## Step 8: Grant Lambda Permission to SES

```bash
aws lambda add-permission \
  --function-name sainathayai-email-forwarder \
  --statement-id allow-ses-invoke \
  --action lambda:InvokeFunction \
  --principal ses.amazonaws.com \
  --source-arn arn:aws:ses:us-east-1:YOUR_ACCOUNT_ID:receipt-rule-set/sainathayai-forwarding \
  --region us-east-1
```

## Step 9: Request Production Access (Important!)

SES starts in sandbox mode. Request production access:

1. Go to **SES Console** → **Account dashboard**
2. Click **Request production access**
3. Fill out the form:
   - Mail type: **Transactional**
   - Website URL: Your website
   - Use case description: "Email forwarding for domain sainathayai.com"
   - Expected sending volume: Your estimate
4. Submit (usually approved within 24 hours)

## Step 10: Test Email Forwarding

Send a test email to one of your configured addresses:

```bash
# Test email (if you have mailx or similar)
echo "Test email" | mail -s "Test" info@sainathayai.com
```

Or use SES to send a test:

```bash
aws ses send-email \
  --from "test@example.com" \
  --destination "ToAddresses=info@sainathayai.com" \
  --message "Subject={Data=Test},Body={Text={Data=This is a test}}" \
  --region us-east-1
```

## Troubleshooting

### Check Lambda Logs
```bash
aws logs tail /aws/lambda/sainathayai-email-forwarder --follow --region us-east-1
```

### Verify SES Configuration
```bash
# Check domain verification
aws ses get-identity-verification-attributes --identities sainathayai.com --region us-east-1

# Check receipt rules
aws ses describe-receipt-rule-set --rule-set-name sainathayai-forwarding --region us-east-1
```

### Common Issues

1. **Domain not verified**: Wait 5-10 minutes after adding TXT record
2. **Lambda not receiving emails**: Check receipt rule is active and recipients match
3. **Permission denied**: Ensure Lambda has SES invoke permission
4. **Emails not forwarding**: Check CloudWatch logs for errors

## Cost Estimate

- **SES**: $0.10 per 1,000 emails received, $0.12 per 1,000 sent
- **Lambda**: Free tier (1M requests/month)
- **Total**: ~$0-5/month for typical personal/business use

## Next Steps

1. ✅ Add TXT record to Route 53 (Step 1)
2. ✅ Wait for domain verification
3. ✅ Create Lambda function
4. ✅ Set up receipt rules
5. ✅ Request production access
6. ✅ Test email forwarding

