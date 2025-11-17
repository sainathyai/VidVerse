# Frontend Dockerfile for ECS (multi-stage build)
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY tsconfig.node.json ./
COPY vite.config.ts ./
COPY tailwind.config.ts ./
COPY postcss.config.js ./
COPY components.json ./

# Install dependencies
RUN npm install

# Copy source code and public assets
COPY src ./src
COPY public ./public
COPY index.html ./

# Build the application
# Note: Vite environment variables need to be set at build time
# For production, these should be set via build args or env vars
ARG VITE_API_URL=https://api.vidverseai.com
ARG VITE_COGNITO_USER_POOL_ID
ARG VITE_COGNITO_CLIENT_ID
ARG VITE_AWS_REGION=us-west-2
ARG VITE_COGNITO_DOMAIN
ARG VITE_OAUTH_REDIRECT_SIGN_IN=https://vidverseai.com/auth/callback
ARG VITE_OAUTH_REDIRECT_SIGN_OUT=https://vidverseai.com/login

ENV NODE_ENV=production
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_COGNITO_USER_POOL_ID=$VITE_COGNITO_USER_POOL_ID
ENV VITE_COGNITO_CLIENT_ID=$VITE_COGNITO_CLIENT_ID
ENV VITE_AWS_REGION=$VITE_AWS_REGION
ENV VITE_COGNITO_DOMAIN=$VITE_COGNITO_DOMAIN
ENV VITE_OAUTH_REDIRECT_SIGN_IN=$VITE_OAUTH_REDIRECT_SIGN_IN
ENV VITE_OAUTH_REDIRECT_SIGN_OUT=$VITE_OAUTH_REDIRECT_SIGN_OUT

RUN npm run build

# Production stage with nginx
FROM nginx:alpine

# Copy built files from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]

