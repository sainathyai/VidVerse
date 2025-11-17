// Use AWS SDK v3 for Node.js 22.x
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { simpleParser } = require('mailparser');

const ses = new SESClient({ region: 'us-east-1' });
const s3 = new S3Client({ region: 'us-east-1' });

// Configure your forwarding rules here
const FORWARD_TO_EMAIL = 'sainatha.yatham@gmail.com';
const S3_BUCKET = process.env.S3_BUCKET || 'vidverse-email-storage'; // S3 bucket where SES stores emails

const FORWARDING_RULES = {
    'info@vidverseai.com': FORWARD_TO_EMAIL,
    'contact@vidverseai.com': FORWARD_TO_EMAIL,
    'support@vidverseai.com': FORWARD_TO_EMAIL,
    'hello@vidverseai.com': FORWARD_TO_EMAIL,
    '*': FORWARD_TO_EMAIL  // Default for all other addresses
};

// Helper function to extract text from email
function extractEmailText(parsed) {
    if (parsed.text) {
        return parsed.text;
    }
    if (parsed.html) {
        // Simple HTML to text conversion (remove tags)
        return parsed.html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    }
    return '';
}

exports.handler = async (event) => {
    console.log('Received event:', JSON.stringify(event, null, 2));
    
    const forwardTo = process.env.FORWARD_TO_EMAIL || FORWARD_TO_EMAIL;
    
    for (const record of event.Records) {
        const { mail, receipt } = record.ses;
        const originalRecipient = mail.destination[0];
        const originalSender = mail.commonHeaders.from[0];
        const subject = mail.commonHeaders.subject || '(No Subject)';
        
        // Determine forwarding address
        let targetEmail = FORWARDING_RULES[originalRecipient] || 
                         FORWARDING_RULES['*'] || 
                         forwardTo;
        
        try {
            let emailBody = '';
            let emailText = '';
            
            // Try to get email content from S3
            // S3 bucket is configured in receipt rule, key is typically the messageId
            const messageId = mail.messageId;
            const s3Bucket = S3_BUCKET;
            const s3KeyPrefix = 'emails/';
            
            // Try to find S3 action in receipt.actions array
            let s3Key = null;
            if (receipt && receipt.actions) {
                for (const action of receipt.actions) {
                    if (action.type === 'S3' && action.bucketName && action.objectKey) {
                        s3Key = action.objectKey;
                        console.log('Found S3 action in receipt:', action.bucketName, s3Key);
                        break;
                    }
                }
            }
            
            // If not found in actions, try to construct from messageId
            if (!s3Key && messageId) {
                // Remove angle brackets if present
                const cleanMessageId = messageId.replace(/[<>]/g, '');
                // Extract the SES message ID (last part after @)
                const sesMessageId = cleanMessageId.split('@')[0] || cleanMessageId;
                s3Key = s3KeyPrefix + sesMessageId;
                console.log('Constructed S3 key from messageId:', s3Key);
            }
            
            // Try to read from S3
            if (s3Key) {
                try {
                    console.log('Reading email from S3:', s3Bucket, s3Key);
                    const s3Command = new GetObjectCommand({
                        Bucket: s3Bucket,
                        Key: s3Key
                    });
                    const s3Object = await s3.send(s3Command);
                    
                    // Convert stream to buffer for mailparser
                    const chunks = [];
                    for await (const chunk of s3Object.Body) {
                        chunks.push(chunk);
                    }
                    const emailBuffer = Buffer.concat(chunks);
                    
                    // Parse the raw email
                    const parsed = await simpleParser(emailBuffer);
                    emailText = extractEmailText(parsed);
                    emailBody = emailText || parsed.html || '';
                    
                    console.log('Email parsed successfully from S3');
                } catch (s3Error) {
                    console.error('Error reading from S3:', s3Error.message);
                    // Try alternative key format (just the messageId without prefix)
                    if (s3Key.includes('/')) {
                        try {
                            const altKey = s3Key.split('/').pop();
                            console.log('Trying alternative S3 key:', altKey);
                            const altCommand = new GetObjectCommand({
                                Bucket: s3Bucket,
                                Key: altKey
                            });
                            const altObject = await s3.send(altCommand);
                            const altChunks = [];
                            for await (const chunk of altObject.Body) {
                                altChunks.push(chunk);
                            }
                            const altBuffer = Buffer.concat(altChunks);
                            const parsed = await simpleParser(altBuffer);
                            emailText = extractEmailText(parsed);
                            emailBody = emailText || parsed.html || '';
                            console.log('Email parsed successfully with alternative key');
                        } catch (altError) {
                            console.error('Alternative S3 key also failed:', altError.message);
                        }
                    }
                }
            }
            
            // Fallback: Try to get content from event (if available)
            if (!emailBody && record.ses && record.ses.content) {
                const content = record.ses.content;
                if (typeof content === 'string') {
                    emailBody = content;
                } else if (content.data) {
                    const rawEmail = Buffer.from(content.data, 'base64').toString('utf-8');
                    try {
                        const parsed = await simpleParser(rawEmail);
                        emailText = extractEmailText(parsed);
                        emailBody = emailText || parsed.html || '';
                    } catch (parseError) {
                        console.error('Error parsing email content:', parseError);
                        emailBody = rawEmail;
                    }
                }
            }
            
            // If still no content, use a placeholder
            if (!emailBody) {
                emailBody = '[Email content could not be extracted]';
                console.warn('Could not extract email content from event or S3');
            }
            
            // Create forwarded email
            const forwardedSubject = 'Fwd: ' + subject;
            const forwardedBody = [
                '---------- Forwarded Message ----------',
                'From: ' + originalSender,
                'To: ' + originalRecipient,
                'Date: ' + (mail.commonHeaders.date || new Date().toISOString()),
                'Subject: ' + subject,
                '',
                emailBody || emailText || '[Email content]'
            ].join('\n');
            
            // Send email via SES
            // Use a verified sender address (domain is verified, so any @vidverseai.com works)
            const verifiedSender = originalRecipient.includes('@vidverseai.com') 
                ? originalRecipient 
                : 'noreply@vidverseai.com';
            
            const sendEmailCommand = new SendEmailCommand({
                Source: verifiedSender,
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
            });
            await ses.send(sendEmailCommand);
            
            console.log('Forwarded email from ' + originalSender + ' to ' + originalRecipient + ' -> ' + targetEmail);
        } catch (error) {
            console.error('Error forwarding email:', error);
            console.error('Error details:', JSON.stringify(error, null, 2));
            // Don't throw - log the error but don't cause SES to reject
            // SES will still accept the email even if forwarding fails
            // You can check CloudWatch logs to see forwarding failures
        }
    }
    
    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Email forwarded successfully' })
    };
};

