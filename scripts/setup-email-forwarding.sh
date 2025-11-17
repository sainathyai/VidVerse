#!/bin/bash

# Email Forwarding Setup Script for sainathayai.com
# This script automates the setup of email forwarding using AWS SES and Lambda

set -e

DOMAIN="${1:-sainathayai.com}"
REGION="${2:-us-east-1}"
FORWARD_TO_EMAIL="${3:-}"
ACCOUNT_ID="${4:-}"

echo "═══════════════════════════════════════════════════════════════"
echo "  Email Forwarding Setup for $DOMAIN"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Validate inputs
if [ -z "$FORWARD_TO_EMAIL" ]; then
    read -p "Enter email address to forward emails to: " FORWARD_TO_EMAIL
fi

if [ -z "$ACCOUNT_ID" ]; then
    echo "Getting AWS Account ID..."
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
    if [ -z "$ACCOUNT_ID" ]; then
        echo "[ERROR] Failed to get AWS Account ID. Please provide it manually."
        read -p "Enter your AWS Account ID: " ACCOUNT_ID
    else
        echo "  Account ID: $ACCOUNT_ID"
    fi
fi

echo ""
echo "Configuration:"
echo "  Domain: $DOMAIN"
echo "  Region: $REGION"
echo "  Forward To: $FORWARD_TO_EMAIL"
echo "  Account ID: $ACCOUNT_ID"
echo ""

# Sanitize domain name for use in AWS resource names (replace dots with hyphens)
# Lambda function names cannot contain dots, and it's cleaner for other resources too
DOMAIN_SANITIZED=$(echo "$DOMAIN" | tr '.' '-')

# Step 1: Check Domain Verification Status
echo "Step 1: Checking domain verification status..."
VERIFICATION_RESPONSE=$(aws ses get-identity-verification-attributes \
    --identities "$DOMAIN" \
    --region "$REGION" \
    --output json 2>/dev/null)

if [ $? -eq 0 ] && [ -n "$VERIFICATION_RESPONSE" ]; then
    # Extract verification status using jq if available, otherwise use grep/sed
    if command -v jq > /dev/null 2>&1; then
        VERIFICATION_STATUS=$(echo "$VERIFICATION_RESPONSE" | jq -r ".VerificationAttributes.\"$DOMAIN\".VerificationStatus // \"None\"" 2>/dev/null)
    else
        # Fallback: use grep to find the status
        VERIFICATION_STATUS=$(echo "$VERIFICATION_RESPONSE" | grep -o '"VerificationStatus"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -o '"[^"]*"' | tail -1 | tr -d '"' || echo "None")
    fi
    
    if [ -z "$VERIFICATION_STATUS" ] || [ "$VERIFICATION_STATUS" = "null" ]; then
        VERIFICATION_STATUS="None"
    fi
    
    if [ "$VERIFICATION_STATUS" = "Success" ]; then
        echo "  ✓ Domain is verified!"
    else
        echo "  ⚠ Domain verification status: $VERIFICATION_STATUS"
        if [ "$VERIFICATION_STATUS" != "None" ] && [ "$VERIFICATION_STATUS" != "null" ]; then
            echo "  Current status: $VERIFICATION_STATUS"
        else
            echo "  Domain not found in SES or not yet verified."
        fi
        echo "  Please wait a few minutes and ensure DNS records are propagated."
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
else
    echo "  ⚠ Could not retrieve verification status from AWS SES."
    echo "  This might mean the domain is not yet added to SES."
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""

# Step 2: Enable DKIM
echo "Step 2: Enabling DKIM..."
if aws ses set-identity-dkim-enabled \
    --identity "$DOMAIN" \
    --dkim-enabled \
    --region "$REGION" \
    --output json > /dev/null 2>&1; then
    echo "  ✓ DKIM enabled"
    
    # Get DKIM tokens
    echo "  Getting DKIM tokens..."
    DKIM_TOKENS=$(aws ses get-identity-dkim-attributes \
        --identities "$DOMAIN" \
        --region "$REGION" \
        --query "DkimAttributes.$DOMAIN.DkimTokens" \
        --output json)
    
    echo "  ⚠ Please add these 3 CNAME records to Route 53:"
    echo "$DKIM_TOKENS" | jq -r '.[] | "    \(.)._domainkey.'"$DOMAIN"' → \(.).dkim.amazonses.com"'
    echo ""
fi

# Step 3: Create IAM Role for Lambda
echo "Step 3: Creating IAM role for Lambda..."
ROLE_NAME="${DOMAIN_SANITIZED}-email-forwarder-role"
# Also check for old naming convention (with dots) for backward compatibility
OLD_ROLE_NAME="${DOMAIN}-email-forwarder-role"

# Check if role exists and get its ARN (try new name first, then old name)
ROLE_EXISTS=false
if aws iam get-role --role-name "$ROLE_NAME" > /dev/null 2>&1; then
    ROLE_EXISTS=true
    echo "  ✓ IAM role already exists (using sanitized name)"
    # Get the actual role ARN from AWS
    ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || echo "arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}")
    echo "  Using existing role: $ROLE_ARN"
elif aws iam get-role --role-name "$OLD_ROLE_NAME" > /dev/null 2>&1; then
    # Role exists with old naming convention (with dots)
    ROLE_EXISTS=true
    echo "  ✓ IAM role already exists (found with old naming convention)"
    echo "  Note: Using existing role '$OLD_ROLE_NAME' (with dots)"
    echo "  Consider renaming to '$ROLE_NAME' for consistency"
    ROLE_NAME="$OLD_ROLE_NAME"
    # Get the actual role ARN from AWS
    ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || echo "arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}")
    echo "  Using existing role: $ROLE_ARN"
    
    # Verify trust policy allows Lambda to assume the role
    echo "  Verifying trust policy..."
    TRUST_POLICY=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.AssumeRolePolicyDocument' --output json 2>/dev/null)
    if echo "$TRUST_POLICY" | grep -q "lambda.amazonaws.com"; then
        echo "  ✓ Trust policy is correct"
    else
        echo "  ⚠ Trust policy may not allow Lambda. Updating trust policy..."
        cat > /tmp/trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
        aws iam update-assume-role-policy \
            --role-name "$ROLE_NAME" \
            --policy-document "file:///tmp/trust-policy.json" \
            > /dev/null 2>&1 && echo "  ✓ Trust policy updated"
        rm -f /tmp/trust-policy.json
    fi
    
    # Verify and attach required policies if missing
    echo "  Verifying policies are attached..."
    LAMBDA_POLICY="arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
    SES_POLICY="arn:aws:iam::aws:policy/AmazonSESFullAccess"
    
    # Get list of attached policies
    ATTACHED_POLICIES=$(aws iam list-attached-role-policies --role-name "$ROLE_NAME" --output text 2>/dev/null || echo "")
    
    # Check if Lambda execution policy is attached
    if echo "$ATTACHED_POLICIES" | grep -q "$LAMBDA_POLICY"; then
        echo "  ✓ Lambda execution policy already attached"
    else
        echo "  Attaching Lambda execution policy..."
        aws iam attach-role-policy \
            --role-name "$ROLE_NAME" \
            --policy-arn "$LAMBDA_POLICY" \
            > /dev/null 2>&1 && echo "  ✓ Lambda execution policy attached"
    fi
    
    # Check if SES policy is attached
    if echo "$ATTACHED_POLICIES" | grep -q "$SES_POLICY"; then
        echo "  ✓ SES policy already attached"
    else
        echo "  Attaching SES policy..."
        aws iam attach-role-policy \
            --role-name "$ROLE_NAME" \
            --policy-arn "$SES_POLICY" \
            > /dev/null 2>&1 && echo "  ✓ SES policy attached"
    fi
else
    # Create trust policy
    cat > /tmp/trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
    
    # Create role
    CREATE_ROLE_OUTPUT=$(aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document "file:///tmp/trust-policy.json" \
        --description "Role for email forwarding Lambda function" \
        --output json 2>&1)
    CREATE_ROLE_EXIT=$?
    
    if [ $CREATE_ROLE_EXIT -eq 0 ]; then
        echo "  ✓ IAM role created"
        
        # Get the actual role ARN
        ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null)
        if [ -z "$ROLE_ARN" ]; then
            echo "  ⚠ Could not retrieve role ARN, using constructed ARN"
            ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
        fi
        
        # Attach policies
        echo "  Attaching policies..."
        aws iam attach-role-policy \
            --role-name "$ROLE_NAME" \
            --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" \
            > /dev/null 2>&1
        
        aws iam attach-role-policy \
            --role-name "$ROLE_NAME" \
            --policy-arn "arn:aws:iam::aws:policy/AmazonSESFullAccess" \
            > /dev/null 2>&1
        
        echo "  ✓ Policies attached"
    else
        echo "  [ERROR] Failed to create IAM role"
        echo "  Error: $CREATE_ROLE_OUTPUT" | head -3 | sed 's/^/    /'
        echo ""
        echo "  This might be due to:"
        echo "    1. Role already exists with a different name"
        echo "    2. Insufficient permissions to create IAM roles"
        echo "    3. Invalid role name"
        rm -f /tmp/trust-policy.json
        exit 1
    fi
    
    rm -f /tmp/trust-policy.json
fi

echo "  Role ARN: $ROLE_ARN"
echo ""

# Wait for role to be available and propagate
echo "  Waiting for role to be available..."
if [ "$ROLE_EXISTS" = "false" ]; then
    # New role needs more time to propagate - AWS can take 30-60 seconds
    echo "  Waiting for new role to propagate (this may take up to 60 seconds)..."
    echo "  Note: AWS IAM role propagation can take time. Waiting 30 seconds..."
    sleep 30
    # Verify role exists and is accessible
    if aws iam get-role --role-name "$ROLE_NAME" > /dev/null 2>&1; then
        echo "  ✓ Role is accessible"
    else
        echo "  ⚠ Role check failed, but continuing (role may still be propagating)..."
    fi
else
    # Existing role should be ready, but wait a bit for any policy updates
    echo "  Waiting 10 seconds for any policy updates to propagate..."
    sleep 10
    echo "  ✓ Role is ready"
fi

# Step 4: Create Lambda Function
echo "Step 4: Creating Lambda function..."
FUNCTION_NAME="${DOMAIN_SANITIZED}-email-forwarder"

# Create temp directory
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

# Create Lambda function code
cat > index.js <<EOF
const AWS = require('aws-sdk');
const ses = new AWS.SES({ region: '$REGION' });

// Configure your forwarding rules here
const FORWARDING_RULES = {
    'info@$DOMAIN': '$FORWARD_TO_EMAIL',
    'contact@$DOMAIN': '$FORWARD_TO_EMAIL',
    'support@$DOMAIN': '$FORWARD_TO_EMAIL',
    'hello@$DOMAIN': '$FORWARD_TO_EMAIL',
    '*': '$FORWARD_TO_EMAIL'  // Default for all other addresses
};

exports.handler = async (event) => {
    console.log('Received event:', JSON.stringify(event, null, 2));
    
    const forwardTo = process.env.FORWARD_TO_EMAIL || '$FORWARD_TO_EMAIL';
    
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
            const forwardedSubject = \`Fwd: \${subject}\`;
            const forwardedBody = \`
---------- Forwarded Message ----------
From: \${originalSender}
To: \${originalRecipient}
Date: \${mail.commonHeaders.date}
Subject: \${subject}

\${emailBody}
            \`.trim();
            
            // Send email via SES
            await ses.sendEmail({
                Source: originalRecipient,
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
            
            console.log(\`Forwarded email from \${originalSender} to \${originalRecipient} → \${targetEmail}\`);
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
EOF

# Create package.json
cat > package.json <<EOF
{
  "name": "email-forwarder",
  "version": "1.0.0",
  "description": "Email forwarding Lambda function",
  "main": "index.js",
  "dependencies": {
    "aws-sdk": "^2.1000.0"
  }
}
EOF

# Install dependencies
npm install --production --silent

# Create zip file - try multiple methods for cross-platform compatibility
if command -v zip > /dev/null 2>&1; then
    # Use zip command if available (Linux/Mac/Git Bash with zip installed)
    zip -r function.zip . > /dev/null
elif command -v node > /dev/null 2>&1; then
    # Use Node.js to create zip file (works on all platforms)
    echo "  Creating zip file using Node.js..."
    
    # Create a temporary script to create the zip
    cat > create-zip.js << 'ZIP_SCRIPT'
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Install archiver if not available
let archiver;
try {
    archiver = require('archiver');
} catch (e) {
    console.log('  Installing archiver package...');
    execSync('npm install archiver --no-save --silent', { stdio: 'inherit' });
    archiver = require('archiver');
}

const output = fs.createWriteStream('function.zip');
const archive = archiver('zip', { zlib: { level: 9 } });

// Use promises to handle async operations
const createZip = new Promise((resolve, reject) => {
    output.on('close', () => {
        console.log('  ✓ Zip file created');
        resolve();
    });

    archive.on('error', (err) => {
        console.error('  [ERROR] Failed to create zip file:', err.message);
        reject(err);
    });

    archive.pipe(output);

    // Add all files except node_modules and the zip file itself
    const files = fs.readdirSync('.');
    files.forEach(file => {
        if (file !== 'function.zip' && file !== 'create-zip.js') {
            const stat = fs.statSync(file);
            if (stat.isDirectory() && file !== 'node_modules') {
                archive.directory(file, file);
            } else if (stat.isFile()) {
                archive.file(file, { name: file });
            }
        }
    });

    archive.finalize();
});

// Wait for zip to be created
createZip
    .then(() => {
        // Clean up archiver
        try {
            execSync('npm uninstall archiver --silent', { stdio: 'ignore' });
        } catch (e) {
            // Ignore cleanup errors
        }
        process.exit(0);
    })
    .catch((err) => {
        process.exit(1);
    });
ZIP_SCRIPT
    
    # Run the script and wait for it to complete
    if node create-zip.js; then
        # Verify zip file was created
        if [ -f function.zip ]; then
            echo "  ✓ Zip file ready"
        else
            echo "  [ERROR] Zip file was not created"
            rm -f create-zip.js
            exit 1
        fi
    else
        echo "  [ERROR] Failed to create zip file"
        rm -f create-zip.js
        exit 1
    fi
    rm -f create-zip.js
else
    echo "  [ERROR] Neither 'zip' command nor Node.js found."
    echo "  Please install one of the following:"
    echo "    - zip: On Ubuntu/Debian: sudo apt-get install zip"
    echo "    - zip: On Windows with Git Bash: Install from https://www.7-zip.org/"
    echo "    - Node.js: Required for this script anyway"
    echo ""
    echo "  Alternatively, use the PowerShell version:"
    echo "    ./scripts/setup-email-forwarding.ps1"
    exit 1
fi

# Check if function exists
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" > /dev/null 2>&1; then
    echo "  Function exists, updating code..."
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file "fileb://function.zip" \
        --region "$REGION" \
        --output json > /dev/null
    echo "  ✓ Lambda function updated"
else
    echo "  Creating Lambda function..."
    # Retry logic for Lambda creation (AWS sometimes needs time for role propagation)
    RETRY_COUNT=0
    MAX_RETRIES=5
    LAMBDA_CREATED=false
    
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        echo "  Attempting to create Lambda function (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)..."
        # Use timeout to prevent hanging (60 seconds should be enough)
        if command -v timeout > /dev/null 2>&1; then
            LAMBDA_OUTPUT=$(timeout 60 aws lambda create-function \
                --function-name "$FUNCTION_NAME" \
                --runtime nodejs18.x \
                --role "$ROLE_ARN" \
                --handler index.handler \
                --zip-file "fileb://function.zip" \
                --timeout 30 \
                --memory-size 256 \
                --region "$REGION" \
                --output json 2>&1)
            LAMBDA_EXIT_CODE=$?
        else
            # Fallback if timeout command not available
            LAMBDA_OUTPUT=$(aws lambda create-function \
                --function-name "$FUNCTION_NAME" \
                --runtime nodejs18.x \
                --role "$ROLE_ARN" \
                --handler index.handler \
                --zip-file "fileb://function.zip" \
                --timeout 30 \
                --memory-size 256 \
                --region "$REGION" \
                --output json 2>&1)
            LAMBDA_EXIT_CODE=$?
        fi
        
        if [ $LAMBDA_EXIT_CODE -eq 0 ]; then
            echo "  ✓ Lambda function created"
            LAMBDA_CREATED=true
            break
        else
            RETRY_COUNT=$((RETRY_COUNT + 1))
            if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
                echo "  ⚠ Lambda creation failed, retrying in 10 seconds... ($RETRY_COUNT/$MAX_RETRIES)"
                # Show the error message
                echo "$LAMBDA_OUTPUT" | grep -i "error\|exception" | head -1 | sed 's/^/    Error: /' || true
                sleep 10
            else
                echo "  [ERROR] Failed to create Lambda function after $MAX_RETRIES attempts"
                echo "  Last error:"
                echo "$LAMBDA_OUTPUT" | head -5 | sed 's/^/    /'
                echo ""
                echo "  This might be due to:"
                echo "    1. Role not fully propagated (wait a minute and try again)"
                echo "    2. Invalid role ARN: $ROLE_ARN"
                echo "    3. Insufficient permissions"
                echo "    4. Role trust policy issue"
                echo ""
                echo "  To debug, try:"
                echo "    aws iam get-role --role-name $ROLE_NAME"
                echo "    aws iam get-role-policy --role-name $ROLE_NAME --policy-name AssumeRolePolicy"
                exit 1
            fi
        fi
    done
fi

# Cleanup
cd - > /dev/null
rm -rf "$TEMP_DIR"

FUNCTION_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}"
echo "  Function ARN: $FUNCTION_ARN"
echo ""

# Step 5: Create SES Receipt Rule Set
echo "Step 5: Creating SES receipt rule set..."
RULE_SET_NAME="${DOMAIN_SANITIZED}-forwarding"

if aws ses create-receipt-rule-set \
    --rule-set-name "$RULE_SET_NAME" \
    --region "$REGION" \
    --output json > /dev/null 2>&1; then
    echo "  ✓ Rule set created"
fi

# Set as active
echo "  Setting as active rule set..."
aws ses set-active-receipt-rule-set \
    --rule-set-name "$RULE_SET_NAME" \
    --region "$REGION" \
    --output json > /dev/null

echo "  ✓ Rule set activated"
echo ""

# Step 6: Create Receipt Rule
echo "Step 6: Creating receipt rule..."
RULE_NAME="forward-all"

# Create rule JSON
cat > /tmp/rule.json <<EOF
{
  "Name": "$RULE_NAME",
  "Enabled": true,
  "Recipients": ["*@$DOMAIN"],
  "Actions": [
    {
      "LambdaAction": {
        "FunctionArn": "$FUNCTION_ARN",
        "InvocationType": "Event"
      }
    }
  ]
}
EOF

if aws ses describe-receipt-rule \
    --rule-set-name "$RULE_SET_NAME" \
    --rule-name "$RULE_NAME" \
    --region "$REGION" > /dev/null 2>&1; then
    echo "  Rule exists, updating..."
    aws ses update-receipt-rule \
        --rule-set-name "$RULE_SET_NAME" \
        --rule "file:///tmp/rule.json" \
        --region "$REGION" \
        --output json > /dev/null
else
    aws ses create-receipt-rule \
        --rule-set-name "$RULE_SET_NAME" \
        --rule "file:///tmp/rule.json" \
        --region "$REGION" \
        --output json > /dev/null
fi

echo "  ✓ Receipt rule created"
rm -f /tmp/rule.json
echo ""

# Step 7: Grant Lambda Permission to SES
echo "Step 7: Granting Lambda permission to SES..."
SOURCE_ARN="arn:aws:ses:${REGION}:${ACCOUNT_ID}:receipt-rule-set/${RULE_SET_NAME}"
STATEMENT_ID="allow-ses-invoke-$(date +%Y%m%d%H%M%S)"

if aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id "$STATEMENT_ID" \
    --action lambda:InvokeFunction \
    --principal ses.amazonaws.com \
    --source-arn "$SOURCE_ARN" \
    --region "$REGION" \
    --output json > /dev/null 2>&1; then
    echo "  ✓ Permission granted"
else
    echo "  Permission may already exist"
fi

echo ""

# Step 8: Summary
echo "═══════════════════════════════════════════════════════════════"
echo "  Setup Complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Next Steps:"
echo "  1. Add DKIM CNAME records to Route 53 (shown above)"
echo "  2. Request production access in SES Console:"
echo "     https://console.aws.amazon.com/ses/home?region=$REGION#/account"
echo "  3. Test by sending email to: info@$DOMAIN"
echo ""
echo "Configuration:"
echo "  Domain: $DOMAIN"
echo "  Forward To: $FORWARD_TO_EMAIL"
echo "  Lambda Function: $FUNCTION_NAME"
echo "  Rule Set: $RULE_SET_NAME"
echo ""
echo "To update forwarding email, edit the Lambda function code."
echo ""

