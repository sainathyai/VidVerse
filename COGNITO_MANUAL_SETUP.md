# AWS Cognito Manual Setup Guide (AWS Console)

This guide walks you through setting up AWS Cognito User Pool manually via the AWS Console.

## Prerequisites

- AWS Account with appropriate permissions
- Access to AWS Console

## Step 1: Create User Pool

1. **Navigate to Cognito**
   - Go to [AWS Console](https://console.aws.amazon.com/)
   - Search for "Cognito" in the services search bar
   - Click on "Amazon Cognito"

2. **Create User Pool**
   - Click the **"Create user pool"** button

3. **Configure Sign-in Options**
   - Select **"Email"** as the sign-in option
   - Click **"Next"**

4. **Configure Security Requirements**
   - **Password policy**: 
     - Minimum length: `8`
     - Require uppercase letters: ✅ **Yes**
     - Require lowercase letters: ✅ **Yes**
     - Require numbers: ✅ **Yes**
     - Require symbols: ❌ **No** (optional)
   - **Multi-factor authentication**: Choose based on your needs (optional for now)
   - Click **"Next"**

5. **Configure Sign-up Experience**
   - **Self-service sign-up**: ✅ **Enabled**
   - **Cognito-assisted verification**: Select **"Email"**
   - **Required attributes**: 
     - ✅ **email** (already selected)
     - ❌ Uncheck any others you don't need
   - **Custom attributes**: Leave as default (or add if needed)
   - Click **"Next"**

6. **Configure Message Delivery**
   - **Email provider**: Select **"Send email with Cognito"**
   - **Email subject**: `Your VidVerse verification code`
   - **Email message**: `Your verification code is {####}`
   - Click **"Next"**

7. **Integrate Your App**
   - **User pool name**: `vidverse-users`
   - **App client name**: `vidverse-web-client`
   - **Client secret**: ❌ **Don't generate a client secret** (uncheck this - needed for public clients)
   - Click **"Next"**

8. **Review and Create**
   - Review all settings
   - Click **"Create user pool"**

9. **Save Your User Pool ID**
   - After creation, you'll see your User Pool ID (format: `us-west-2_xxxxxxxxx`)
   - **Copy and save this ID** - you'll need it later

## Step 2: Configure App Client Settings

1. **Navigate to App Integration**
   - In your User Pool, click on **"App integration"** tab (left sidebar)

2. **Configure App Client**
   - Under "App clients and analytics", click on your app client (`vidverse-web-client`)

3. **Edit App Client Settings**
   - Click **"Edit"** button

4. **Configure Authentication Flows**
   - Under "Authentication flows configuration":
     - ✅ **ALLOW_USER_PASSWORD_AUTH**
     - ✅ **ALLOW_REFRESH_TOKEN_AUTH**
     - ✅ **ALLOW_USER_SRP_AUTH**

5. **Configure OAuth 2.0 Settings**
   - **Allowed OAuth flows**: ✅ **Authorization code grant**
   - **Allowed OAuth scopes**: 
     - ✅ **email**
     - ✅ **openid**
     - ✅ **profile**
   - **Allowed callback URLs**: Add these URLs (one per line):
     ```
     http://localhost:3000/auth/callback
     https://yourdomain.com/auth/callback
     ```
   - **Allowed sign-out URLs**: Add these URLs (one per line):
     ```
     http://localhost:3000/login
     https://yourdomain.com/login
     ```
   - **Default redirect URI** (Optional but recommended):
     ```
     http://localhost:3000/auth/callback
     ```
   - Click **"Save changes"**

6. **Save Your Client ID**
   - After saving, you'll see your **Client ID** (a long alphanumeric string)
   - **Copy and save this ID** - you'll need it later

## Step 3: Create Cognito Domain (for OAuth)

1. **Navigate to Domain**
   - In your User Pool, click on **"App integration"** tab
   - Scroll down to **"Domain"** section
   - Click **"Create Cognito domain"**

2. **Configure Domain**
   - **Domain prefix**: Enter a unique prefix (e.g., `vidverse-20241114` or `vidverse-yourname`)
     - Note: This must be globally unique across all AWS accounts
   - Click **"Create Cognito domain"**

3. **Save Your Domain**
   - Your domain will be: `your-prefix.auth.us-west-2.amazoncognito.com`
   - **Copy and save this domain** - you'll need it later

## Step 4: Add OAuth Integration Code

### Install Dependencies

1. **Navigate to backend directory**:
   ```powershell
   cd backend
   ```

2. **Install openid-client package**:
   ```powershell
   npm install openid-client
   ```

   Or if using yarn:
   ```powershell
   yarn add openid-client
   ```

### Complete Express.js Example

Here's a complete Express.js implementation with session management:

#### 1. Install Required Packages

```bash
npm install express express-session openid-client ejs
```

#### 2. Complete Application Code (app.js)

```javascript
const express = require('express');
const session = require('express-session');
const { Issuer, generators } = require('openid-client');

const app = express();

let client;

// Initialize OpenID Client
async function initializeClient() {
    // Use your User Pool ID and region
    // Format: https://cognito-idp.{region}.amazonaws.com/{userPoolId}
    const issuer = await Issuer.discover('https://cognito-idp.us-west-2.amazonaws.com/us-west-2_xxxxxxxxx');
    
    client = new issuer.Client({
        client_id: 'your-client-id-here',
        // client_secret: 'your-client-secret', // Only if using confidential client
        redirect_uris: ['http://localhost:3000/auth/callback'],
        response_types: ['code']
    });
}

initializeClient().catch(console.error);

// Configure the Node view engine
app.set('view engine', 'ejs');

// Configure the session middleware
app.use(session({
    secret: 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true in production with HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Add a middleware component that checks if a user is authenticated
const checkAuth = (req, res, next) => {
    if (!req.session.userInfo) {
        req.isAuthenticated = false;
    } else {
        req.isAuthenticated = true;
    }
    next();
};

// Configure a home route at the root of your application
app.get('/', checkAuth, (req, res) => {
    res.render('home', {
        isAuthenticated: req.isAuthenticated,
        userInfo: req.session.userInfo
    });
});

// Configure a login route to direct to Amazon Cognito managed login
app.get('/login', (req, res) => {
    const nonce = generators.nonce();
    const state = generators.state();

    req.session.nonce = nonce;
    req.session.state = state;

    const authUrl = client.authorizationUrl({
        scope: 'openid email profile',
        state: state,
        nonce: nonce,
    });

    res.redirect(authUrl);
});

// Helper function to get the path from the URL
function getPathFromURL(urlString) {
    try {
        const url = new URL(urlString);
        return url.pathname;
    } catch (error) {
        console.error('Invalid URL:', error);
        return null;
    }
}

// Configure the page for the return URL that Amazon Cognito redirects to after authentication
app.get('/auth/callback', async (req, res) => {
    try {
        const params = client.callbackParams(req);
        const tokenSet = await client.callback(
            'http://localhost:3000/auth/callback',
            params,
            {
                nonce: req.session.nonce,
                state: req.session.state
            }
        );

        const userInfo = await client.userinfo(tokenSet.access_token);
        req.session.userInfo = userInfo;

        res.redirect('/');
    } catch (err) {
        console.error('Callback error:', err);
        res.redirect('/login?error=authentication_failed');
    }
});

// Configure a logout route that erases user session data and redirects to Cognito logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destroy error:', err);
        }
        
        // Replace with your Cognito domain and client ID
        const cognitoDomain = 'your-prefix.auth.us-west-2.amazoncognito.com';
        const clientId = 'your-client-id-here';
        const logoutUri = encodeURIComponent('http://localhost:3000/');
        
        const logoutUrl = `https://${cognitoDomain}/logout?client_id=${clientId}&logout_uri=${logoutUri}`;
        res.redirect(logoutUrl);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
```

#### 3. Create Home Page View (views/home.ejs)

Create a `views` directory and add `home.ejs`:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Amazon Cognito authentication with Node example</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
        }
        .user-info {
            background: #f5f5f5;
            padding: 20px;
            border-radius: 5px;
            margin: 20px 0;
        }
        pre {
            background: #fff;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 3px;
            overflow-x: auto;
        }
        a {
            display: inline-block;
            margin: 10px 10px 10px 0;
            padding: 10px 20px;
            background: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 3px;
        }
        a:hover {
            background: #0056b3;
        }
    </style>
</head>
<body>
    <div>
        <h1>Amazon Cognito User Pool Demo</h1>

        <% if (isAuthenticated) { %>
            <div class="user-info">
                <h2>Welcome, <%= userInfo.username || userInfo.email %></h2>
                <p>Here are some attributes you can use as a developer:</p>
                <pre><%= JSON.stringify(userInfo, null, 4) %></pre>
            </div>
            <a href="/logout">Logout</a>
        <% } else { %>
            <p>Please log in to continue</p>
            <a href="/login">Login</a>
        <% } %>
    </div>
</body>
</html>
```

#### 4. Replace Placeholders

**In app.js, replace:**
- `us-west-2_xxxxxxxxx` → Your User Pool ID
- `your-client-id-here` → Your Client ID
- `your-prefix.auth.us-west-2.amazoncognito.com` → Your Cognito Domain
- `your-secret-key-change-this-in-production` → A secure random string for session encryption
- `http://localhost:3000` → Your application URL

**Important Notes:**
- The callback URL in `client.callback()` must match the one configured in your Cognito App Client
- The `scope` should match what you configured in Cognito (typically `openid email profile`)
- In production, set `secure: true` in session cookie configuration and use HTTPS
- Store session secret securely (use environment variables)

### Fastify Implementation (VidVerse Backend)

The VidVerse backend uses Fastify and already includes OAuth routes in `backend/src/routes/auth.ts`. The routes are automatically registered when you start the server.

**Available OAuth endpoints:**
- `GET /api/auth/login` - Initiate OAuth login
- `GET /api/auth/callback` - Handle OAuth callback
- `GET /api/auth/logout` - Logout and redirect to Cognito
- `GET /api/auth/user` - Get current user info (requires token)

**Note:** The Fastify implementation uses PKCE (Proof Key for Code Exchange) for enhanced security and doesn't require sessions for the OAuth flow itself. Tokens are passed via URL parameters to the frontend, which should store them securely (e.g., in httpOnly cookies or secure storage).

## Step 5: Configure Environment Variables

After completing the setup, add these values to your environment files:

### Backend `.env` (root directory)

```env
COGNITO_USER_POOL_ID=us-west-2_xxxxxxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_CLIENT_SECRET=your-client-secret  # Optional - only if using confidential client
AWS_REGION=us-west-2
COGNITO_DOMAIN=your-prefix.auth.us-west-2.amazoncognito.com  # Optional - for hosted UI
```

### Frontend `.env` (frontend directory)

```env
VITE_COGNITO_USER_POOL_ID=us-west-2_xxxxxxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_AWS_REGION=us-west-2
VITE_COGNITO_DOMAIN=your-prefix.auth.us-west-2.amazoncognito.com
VITE_OAUTH_REDIRECT_SIGN_IN=http://localhost:3000/auth/callback
VITE_OAUTH_REDIRECT_SIGN_OUT=http://localhost:3000/login
VITE_API_URL=http://localhost:3001
```

**Replace the placeholder values with your actual values:**
- `us-west-2_xxxxxxxxx` → Your User Pool ID
- `xxxxxxxxxxxxxxxxxxxxxxxxxx` → Your Client ID
- `your-prefix.auth.us-west-2.amazoncognito.com` → Your Cognito Domain

## Step 6: Verify Configuration

### Check User Pool Settings

1. Go to your User Pool in AWS Console
2. Verify:
   - ✅ Username attributes: Email
   - ✅ Self-service sign-up: Enabled
   - ✅ Email verification: Enabled

### Check App Client Settings

1. Go to App integration → App clients
2. Click on your app client
3. Verify:
   - ✅ Client secret: Not generated (for public clients)
   - ✅ Callback URLs: Include `http://localhost:3000/auth/callback`
   - ✅ Sign-out URLs: Include `http://localhost:3000/login`
   - ✅ OAuth flows: Authorization code grant enabled
   - ✅ OAuth scopes: email, openid, profile

## Step 7: Test the Setup

1. **Start your frontend application**:
   ```powershell
   cd frontend
   npm run dev
   ```

2. **Navigate to login page**:
   - Go to: http://localhost:3000/login

3. **Test Sign-up**:
   - Click "Create account"
   - Enter your email
   - Enter a password (meets requirements)
   - Retype password
   - Submit

4. **Check Email**:
   - Check your email for the verification code
   - Enter the code in the confirmation modal

5. **Test Sign-in**:
   - Sign in with your email and password
   - You should be redirected to the dashboard

## Step 8: Test OAuth Flow

1. **Start your backend server**:
   ```powershell
   cd backend
   npm run dev
   ```

2. **Initiate OAuth login**:
   - Navigate to: `http://localhost:3001/api/auth/login`
   - You should be redirected to Cognito login page

3. **Complete authentication**:
   - Sign in with your credentials
   - You'll be redirected back to your callback URL with tokens

4. **Test user info endpoint**:
   ```bash
   curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" http://localhost:3001/api/auth/user
   ```

## Step 9: Enable Google Sign-In

Follow these detailed steps to enable Google as a sign-in option:

### Part 1: Get Google OAuth Credentials

1. **Go to Google Cloud Console**:
   - Visit: https://console.cloud.google.com/
   - Sign in with your Google account

2. **Create or Select a Project**:
   - Click the project dropdown at the top
   - Click **"New Project"** (or select an existing project)
   - Enter project name: `VidVerse` (or your preferred name)
   - Click **"Create"**

3. **Enable Google+ API** (or Google Identity Services):
   - In the left sidebar, go to **"APIs & Services"** → **"Library"**
   - Search for **"Google+ API"** or **"Google Identity Services"**
   - Click on it and click **"Enable"**

4. **Configure OAuth Consent Screen**:
   - Go to **"APIs & Services"** → **"OAuth consent screen"**
   - Select **"External"** (unless you have a Google Workspace)
   - Click **"Create"**
   - Fill in the required fields:
     - **App name**: `VidVerse` (or your app name)
     - **User support email**: Your email
     - **Developer contact information**: Your email
   - Click **"Save and Continue"**
   - On "Scopes" page, click **"Save and Continue"** (default scopes are fine)
   - On "Test users" page, click **"Save and Continue"** (add test users if needed)
   - Review and click **"Back to Dashboard"**

5. **Create OAuth 2.0 Client ID**:
   - Go to **"APIs & Services"** → **"Credentials"**
   - Click **"+ CREATE CREDENTIALS"** → **"OAuth client ID"**
   - **Application type**: Select **"Web application"**
   - **Name**: `VidVerse Cognito` (or your preferred name)
   - **Authorized redirect URIs**: Click **"+ ADD URI"** and enter:
     ```
     https://YOUR_COGNITO_DOMAIN/oauth2/idpresponse
     ```
     Replace `YOUR_COGNITO_DOMAIN` with your actual Cognito domain (e.g., `vidverse-20241114.auth.us-west-2.amazoncognito.com`)
   - Click **"Create"**
   - **IMPORTANT**: Copy and save both:
     - **Client ID** (looks like: `123456789-abcdefghijklmnop.apps.googleusercontent.com`)
     - **Client secret** (click "Show" to reveal it)

### Part 2: Add Google Identity Provider in Cognito

1. **Navigate to Your User Pool**:
   - Go to [AWS Console](https://console.aws.amazon.com/)
   - Navigate to **Cognito** → **User Pools**
   - Click on your user pool (`vidverse-users`)

2. **Add Google Identity Provider**:
   - Click on the **"Sign-in experience"** tab (left sidebar)
   - Scroll down to **"Federated identity provider sign-in"** section
   - Click **"Add identity provider"** button

3. **Configure Google Provider**:
   - Select **"Google"** from the list
   - Enter your credentials:
     - **App client ID**: Paste your Google Client ID
       - Example: `2f61vrhsru8qhss8mpeumvrcqv`
     - **App client secret**: Paste your Google Client Secret
       - Example: `1g1mjreeccoi7mog6jhbclrl3oh5fae0dc4vkhvv2rpec8v4ipfi`
   - Click **"Next"**
   
   **Important**: These credentials are stored securely in AWS Cognito. You do NOT need to add them to your application's environment variables or code.

4. **Configure Attribute Mapping**:
   - Map Google attributes to Cognito attributes:
     - **Email**: Select `email` → Maps to `email`
     - **Name**: Select `name` → Maps to `name` (optional)
     - **Given name**: Select `given_name` → Maps to `given_name` (optional)
     - **Family name**: Select `family_name` → Maps to `family_name` (optional)
   - Click **"Next"**

5. **Review and Save**:
   - Review your configuration
   - Click **"Add identity provider"**

### Part 3: Update App Client to Include Google

1. **Navigate to App Client Settings**:
   - In your User Pool, go to **"App integration"** tab
   - Under **"App clients and analytics"**, click on your app client (`vidverse-web-client`)

2. **Edit App Client**:
   - Click the **"Edit"** button

3. **Enable Google Identity Provider**:
   - Scroll down to **"Identity providers"** section
   - Under **"Federated identity provider sign-in"**, check the box for **"Google"**
   - Ensure **"Cognito user pool"** is also checked (to allow both email/password and Google sign-in)

4. **Save Changes**:
   - Scroll to the bottom
   - Click **"Save changes"**

### Part 4: Update Frontend Configuration

Your frontend Amplify configuration already includes Google in the providers list. Verify it's set correctly:

**File: `frontend/src/lib/amplify.ts`**

```typescript
providers: ['Google'], // This should already be set
```

If you want to add more providers later (like Apple), you can add them:
```typescript
providers: ['Google', 'Apple'], // Add more as needed
```

### Part 5: Test Google Sign-In

1. **Start your frontend application**:
   ```powershell
   cd frontend
   npm run dev
   ```

2. **Navigate to login page**:
   - Go to: http://localhost:3000/login

3. **Test Google Sign-In**:
   - You should see a **"Google"** button on the login page
   - Click the **"Google"** button
   - You'll be redirected to Google's sign-in page
   - Sign in with your Google account
   - Grant permissions if prompted
   - You'll be redirected back to your application

4. **Verify User Creation**:
   - Go to AWS Console → Cognito → User Pools → Your Pool
   - Click **"Users"** tab
   - You should see a new user created with your Google email
   - The user's **"Sign-in method"** will show as **"Federated"**

### Troubleshooting Google Sign-In

#### "Error 400: redirect_uri_mismatch"
- **Problem**: The redirect URI in Google Console doesn't match Cognito domain
- **Solution**: 
  - Go to Google Cloud Console → Credentials
  - Edit your OAuth 2.0 Client ID
  - Ensure the authorized redirect URI is exactly: `https://YOUR_COGNITO_DOMAIN/oauth2/idpresponse`
  - Make sure there are no trailing slashes or typos

#### "Invalid client" error
- **Problem**: Google Client ID or Secret is incorrect
- **Solution**: 
  - Double-check you copied the Client ID and Secret correctly
  - Ensure there are no extra spaces
  - Re-enter them in Cognito User Pool settings

#### Google button doesn't appear
- **Problem**: App client not configured to use Google
- **Solution**: 
  - Verify Google is enabled in App Client settings
  - Check that `providers: ['Google']` is in your Amplify config
  - Restart your frontend dev server

#### "Access blocked: This app's request is invalid"
- **Problem**: OAuth consent screen not properly configured
- **Solution**: 
  - Go to Google Cloud Console → OAuth consent screen
  - Ensure all required fields are filled
  - If in testing mode, add your email to "Test users"
  - Publish the app if you want it available to all users

#### User created but can't sign in with email/password
- **Problem**: Federated users can only sign in with their provider
- **Solution**: This is expected behavior. Users who sign in with Google can only use Google to sign in. They cannot use email/password unless you link accounts.

### Optional: Link Federated Accounts

If you want users to be able to sign in with either Google or email/password:

1. In your application, implement account linking
2. Use Cognito's `AdminLinkProviderForUser` API
3. This allows users to link their Google account to an existing email/password account

### Where to Store Google OAuth Credentials

**IMPORTANT**: Google OAuth credentials are stored in AWS Cognito, NOT in your application code.

#### ✅ Where to Store (AWS Cognito Console):
1. **Google Client ID and Secret** → Stored in AWS Cognito User Pool
   - Go to: AWS Console → Cognito → User Pools → Your Pool → Sign-in experience → Federated identity provider sign-in → Google
   - Enter both Client ID and Client Secret here
   - AWS Cognito stores these securely and uses them for OAuth flows

#### ❌ Where NOT to Store:
- **DO NOT** add Google Client Secret to your `.env` files
- **DO NOT** add Google Client Secret to frontend code (it's public)
- **DO NOT** commit Google Client Secret to version control
- **DO NOT** add it to backend environment variables (not needed)

#### Why This Works:
- When a user clicks "Sign in with Google" on your frontend, the request goes to Cognito
- Cognito uses the stored Google credentials to authenticate with Google
- Your application never directly handles the Google Client Secret
- This keeps the secret secure and centralized

### Security Best Practices

1. **Keep Client Secret Secure**:
   - ✅ Store it ONLY in AWS Cognito User Pool settings
   - ❌ Never commit Google Client Secret to version control
   - ❌ Never add it to frontend code or environment variables
   - ✅ AWS Cognito handles all OAuth communication securely

2. **Restrict OAuth Consent Screen**:
   - In testing, only add specific test users
   - Review and approve access requests

3. **Monitor Usage**:
   - Check Google Cloud Console for unusual activity
   - Review Cognito User Pool logs for authentication events

4. **Use HTTPS in Production**:
   - Ensure all redirect URIs use HTTPS
   - Update callback URLs to use your production domain

## Troubleshooting

### "Invalid redirect URI" error
- Ensure your callback URLs in App Client settings match exactly
- Check that `http://localhost:3000/auth/callback` is in the allowed callback URLs

### Email verification code not received
- Check spam folder
- Verify email address is correct
- Check Cognito email sending limits (SES sandbox mode may apply)

### "User pool not found" error
- Verify your User Pool ID is correct
- Ensure you're using the correct AWS region (us-west-2)

### Sign-in fails
- Verify Client ID is correct
- Check that email verification is completed
- Ensure password meets requirements

## Quick Reference: Where to Find Your Values

- **User Pool ID**: User Pool → General settings → User pool ID
- **Client ID**: App integration → App clients → Client ID
- **Cognito Domain**: App integration → Domain → Domain name
- **Region**: User Pool → General settings → Region (should be us-west-2)

## Next Steps

After setup:
1. ✅ Copy all configuration values to your `.env` files
2. ✅ Test sign-up and sign-in flow
3. ✅ Verify email verification works
4. ✅ (Optional) Configure Google/Apple OAuth providers

---

**Note**: Keep your User Pool ID, Client ID, and Domain secure. These are needed for your application to authenticate users, but the Client ID can be public (it's used in frontend code).

