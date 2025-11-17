# Manual Email Forwarding Setup for sainathayai.com

## Prerequisites
- Domain: `sainathayai.com` registered on AWS Route 53
- AWS Account with access to:
  - Route 53
  - SES (Simple Email Service)
  - Lambda
  - IAM
- Verification Token: `iphKNblQtShu79SnPCcXzyEsgDozNNjtXYIL/orpC4s=`

---

## Step 1: Add Domain Verification TXT Record to Route 53

### Via AWS Console:

1. **Go to Route 53 Console**
   - Navigate to: https://console.aws.amazon.com/route53/
   - Click **Hosted zones** in the left sidebar

2. **Select Your Domain**
   - Click on `sainathayai.com`

3. **Create New Record**
   - Click **Create record** button

4. **Configure the Record**
   - **Record name**: `_amazonses` (leave blank for root domain, or enter `_amazonses`)
   - **Record type**: Select `TXT`
   - **Value**: `iphKNblQtShu79SnPCcXzyEsgDozNNjtXYIL/orpC4s=`
   - **TTL**: `300` (or leave default)
   - **Routing policy**: Simple routing

5. **Create Record**
   - Click **Create records**

6. **Wait for Propagation**
   - Wait 5-10 minutes for DNS propagation
   - Verify status: Go to SES Console → Verified identities → Check `sainathayai.com` status

---

## Step 2: Verify Domain Status in SES

1. **Go to SES Console**
   - Navigate to: https://console.aws.amazon.com/ses/
   - Make sure you're in **us-east-1** region (top right)

2. **Check Verification Status**
   - Click **Verified identities** in left sidebar
   - Find `sainathayai.com` in the list
   - Status should show **Verified** (green checkmark)
   - If not verified, wait a few more minutes and refresh

---

## Step 3: Enable DKIM (Email Authentication)

1. **In SES Console**
   - Still in **Verified identities**
   - Click on `sainathayai.com`

2. **Enable DKIM**
   - Scroll to **DKIM authentication** section
   - Click **Edit**
   - Select **Easy DKIM**
   - Click **Save changes**

3. **Get DKIM Tokens**
   - After enabling, you'll see 3 CNAME records
   - Copy all 3 CNAME records (they look like):
     - `[token1]._domainkey.sainathayai.com` → `[token1].dkim.amazonses.com`
     - `[token2]._domainkey.sainathayai.com` → `[token2].dkim.amazonses.com`
     - `[token3]._domainkey.sainathayai.com` → `[token3].dkim.amazonses.com`

4. **Add DKIM Records to Route 53**
   - Go back to Route 53 → Hosted zones → `sainathayai.com`
   - For each of the 3 CNAME records:
     - Click **Create record**
     - **Record name**: `[token1]._domainkey` (just the part before `.sainathayai.com`)
     - **Record type**: `CNAME`
     - **Value**: `[token1].dkim.amazonses.com` (the full value)
     - **TTL**: `300`
     - Click **Create records**
   - Repeat for all 3 tokens

---

## Step 4: Create IAM Role for Lambda

1. **Go to IAM Console**
   - Navigate to: https://console.aws.amazon.com/iam/
   - Click **Roles** in left sidebar
   - Click **Create role**

2. **Select Trusted Entity**
   - Select **AWS service**
   - Under "Use cases for other AWS services", select **Lambda**
   - Click **Next**

3. **Add Permissions**
   - Search for and select: **AmazonSESFullAccess**
   - Search for and select: **CloudWatchLogsFullAccess**
   - Click **Next**

4. **Name the Role**
   - **Role name**: `sainathayai-email-forwarder-role`
   - **Description**: `Role for email forwarding Lambda function`
   - Click **Create role**

5. **Note the Role ARN**
   - Copy the Role ARN (you'll need it later)
   - Format: `arn:aws:iam::YOUR_ACCOUNT_ID:role/sainathayai-email-forwarder-role`

---

## Step 5: Create Lambda Function

1. **Go to Lambda Console**
   - Navigate to: https://console.aws.amazon.com/lambda/
   - Make sure you're in **us-east-1** region
   - Click **Create function**

2. **Configure Function**
   - Select **Author from scratch**
   - **Function name**: `sainathayai-email-forwarder`
   - **Runtime**: `Node.js 18.x` (or latest)
   - **Architecture**: `x86_64`
   - Under **Permissions**, expand **Change default execution role**
   - Select **Use an existing role**
   - Choose: `sainathayai-email-forwarder-role`
   - Click **Create function**

3. **Add Function Code**
   - In the function editor, replace the default code with:

```javascript
const AWS = require('aws-sdk');
const ses = new AWS.SES({ region: 'us-east-1' });

// Configure your forwarding rules here
const FORWARDING_RULES = {
    'info@sainathayai.com': 'your-email@gmail.com',
    'contact@sainathayai.com': 'your-email@gmail.com',
    'support@sainathayai.com': 'your-email@gmail.com',
    'hello@sainathayai.com': 'your-email@gmail.com',
    // Add '*' to forward all unmatched emails to a default address
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

4. **Update Forwarding Rules**
   - Replace `'your-email@gmail.com'` with your actual email address
   - Add or modify forwarding rules as needed
   - Example:
     ```javascript
     'info@sainathayai.com': 'sainatha@gmail.com',
     'contact@sainathayai.com': 'sainatha@gmail.com',
     '*': 'sainatha@gmail.com'  // Default for all other addresses
     ```

5. **Deploy Function**
   - Click **Deploy** button (top right)
   - Wait for "Changes deployed" message

6. **Test the Function (Optional)**
   - Click **Test** tab
   - Create a test event (you can use default template)
   - Click **Test** to verify function works

---

## Step 6: Configure SES Receipt Rules

1. **Go to SES Console**
   - Navigate to: https://console.aws.amazon.com/ses/
   - Make sure you're in **us-east-1** region
   - Click **Email receiving** in left sidebar
   - Click **Rule sets**

2. **Create Rule Set**
   - Click **Create rule set**
   - **Rule set name**: `sainathayai-forwarding`
   - Click **Create rule set**

3. **Set as Active Rule Set**
   - Find your new rule set: `sainathayai-forwarding`
   - Click the **three dots** (⋮) next to it
   - Click **Set as active rule set**
   - Confirm by clicking **Set as active**

4. **Create Receipt Rule**
   - Click on the rule set name: `sainathayai-forwarding`
   - Click **Create rule**

5. **Configure Rule**
   - **Rule name**: `forward-all`
   - Click **Next**

6. **Add Recipients**
   - Under **Recipients**, click **Add recipient**
   - Enter: `*@sainathayai.com` (to catch all emails)
   - Or add specific addresses:
     - `info@sainathayai.com`
     - `contact@sainathayai.com`
     - `support@sainathayai.com`
   - Click **Next**

7. **Add Action**
   - Under **Actions**, click **Add action**
   - Select **Invoke AWS Lambda function**
   - **Lambda function**: Select `sainathayai-email-forwarder`
   - **Invocation type**: `Event` (asynchronous)
   - Click **Next**

8. **Review and Create**
   - Review your rule configuration
   - Click **Create rule**

---

## Step 7: Grant Lambda Permission to SES

1. **Go to Lambda Console**
   - Navigate to: https://console.aws.amazon.com/lambda/
   - Click on function: `sainathayai-email-forwarder`
   - Click **Configuration** tab
   - Click **Permissions** in left sidebar
   - Under **Resource-based policy**, click **Add permissions**

2. **Configure Permission**
   - **Policy statement**: `Allow`
   - **Principal**: `ses.amazonaws.com`
   - **Source ARN**: 
     - Format: `arn:aws:ses:us-east-1:YOUR_ACCOUNT_ID:receipt-rule-set/sainathayai-forwarding`
     - Replace `YOUR_ACCOUNT_ID` with your AWS account ID
     - You can find your account ID in the top right of AWS Console (click your username)
   - **Action**: `lambda:InvokeFunction`
   - Click **Save**

---

## Step 8: Request Production Access (IMPORTANT!)

SES starts in **sandbox mode** which has limitations. You need production access.

1. **Go to SES Console**
   - Navigate to: https://console.aws.amazon.com/ses/
   - Click **Account dashboard** in left sidebar

2. **Check Sandbox Status**
   - You'll see "Your account is in the Amazon SES sandbox"
   - Click **Request production access**

3. **Fill Out Request Form**
   - **Mail type**: Select `Transactional`
   - **Website URL**: Enter your website URL (e.g., `https://sainathayai.com`)
   - **Use case description**: 
     ```
     Email forwarding for domain sainathayai.com. 
     We need to receive and forward emails sent to various addresses 
     (info@, contact@, support@) to our personal email addresses.
     ```
   - **Expected sending volume**: Enter your estimate (e.g., `1000` emails/month)
   - **How do you plan to build or maintain your mailing list?**: 
     ```
     We are not building a mailing list. This is for receiving 
     and forwarding emails sent to our domain addresses.
     ```
   - **Do you use AWS to send marketing emails?**: `No`
   - **Do you use AWS to send transactional emails?**: `Yes`
   - **Do you have a process to handle bounces and complaints?**: `Yes`
     - Describe: "We will monitor email delivery and handle bounces/complaints appropriately"

4. **Submit Request**
   - Click **Submit request**
   - Approval usually takes 24-48 hours
   - You'll receive an email when approved

**Note**: While in sandbox mode, you can only send/receive emails to/from verified email addresses. After production access, you can receive emails from anyone.

---

## Step 9: Test Email Forwarding

### Option 1: Send Test Email from Verified Address

1. **Verify Your Personal Email**
   - Go to SES Console → Verified identities
   - Click **Create identity**
   - Select **Email address**
   - Enter your personal email (e.g., `your-email@gmail.com`)
   - Click **Create identity**
   - Check your email and click verification link

2. **Send Test Email**
   - From your verified email, send an email to: `info@sainathayai.com`
   - Check your forwarding destination email
   - You should receive the forwarded email

### Option 2: Use SES Send Email (After Production Access)

1. **Go to SES Console**
   - Click **Verified identities**
   - Click **Send test email**

2. **Configure Test Email**
   - **From**: Your verified email
   - **To**: `info@sainathayai.com`
   - **Subject**: Test Email
   - **Body**: This is a test email
   - Click **Send test email**

3. **Check Forwarding**
   - Check your forwarding destination email
   - You should receive the forwarded email

---

## Step 10: Monitor and Troubleshoot

### View Lambda Logs

1. **Go to CloudWatch Console**
   - Navigate to: https://console.aws.amazon.com/cloudwatch/
   - Click **Log groups** in left sidebar
   - Find: `/aws/lambda/sainathayai-email-forwarder`
   - Click on it to view logs

### Check SES Metrics

1. **Go to SES Console**
   - Click **Account dashboard**
   - View metrics:
     - Emails received
     - Emails sent
     - Bounces
     - Complaints

### Common Issues

**Issue**: Domain not verified
- **Solution**: Wait 10-15 minutes after adding TXT record, then refresh SES console

**Issue**: Lambda not receiving emails
- **Solution**: 
  - Check receipt rule is active
  - Verify recipients match (`*@sainathayai.com`)
  - Check Lambda permissions

**Issue**: Emails not forwarding
- **Solution**:
  - Check CloudWatch logs for errors
  - Verify forwarding email address in Lambda code
  - Check SES sending limits (sandbox mode)

**Issue**: Permission denied errors
- **Solution**:
  - Verify IAM role has SES permissions
  - Check Lambda resource-based policy
  - Ensure SES can invoke Lambda function

---

## Summary Checklist

- [ ] Step 1: Added TXT record to Route 53
- [ ] Step 2: Domain verified in SES
- [ ] Step 3: DKIM enabled and CNAME records added
- [ ] Step 4: IAM role created
- [ ] Step 5: Lambda function created and deployed
- [ ] Step 6: SES receipt rule set created and active
- [ ] Step 7: Lambda permission granted to SES
- [ ] Step 8: Production access requested
- [ ] Step 9: Test email sent and received
- [ ] Step 10: Monitoring set up

---

## Cost Estimate

- **SES**: 
  - $0.10 per 1,000 emails received
  - $0.12 per 1,000 emails sent
- **Lambda**: 
  - Free tier: 1M requests/month
  - After free tier: $0.20 per 1M requests
- **Route 53**: Already included with domain
- **Total**: Approximately $0-5/month for typical personal/business use

---

## Next Steps After Setup

1. **Add More Forwarding Rules**: Edit Lambda function to add more email addresses
2. **Set Up Email Aliases**: Create more forwarding rules for different purposes
3. **Monitor Usage**: Check SES dashboard regularly
4. **Set Up Alerts**: Create CloudWatch alarms for failed email deliveries

---

## Support

If you encounter issues:
1. Check CloudWatch logs for Lambda function
2. Verify all DNS records are correct
3. Ensure production access is granted
4. Check SES sending/receiving limits

