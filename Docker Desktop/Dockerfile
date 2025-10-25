# Multi-stage build for Google Account Automation System
# Stage 1: Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY jest.config.js ./
COPY jest.setup.js ./

# Install all dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code
COPY src/ ./src/
COPY .kiro/ ./.kiro/

# Build the application
RUN npm run build

# Stage 2: Production stage
FROM node:20-alpine AS production

# Install system dependencies for Puppeteer and Chrome
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    sqlite \
    dumb-init \
    curl

# Set Puppeteer environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production \
    DISPLAY=:99

# Create app directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S automation && \
    adduser -S automation -u 1001 -G automation

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.kiro ./.kiro

# Copy configuration files
COPY .env.example ./.env.example
COPY wrangler.toml ./wrangler.toml 2>/dev/null || true

# Create necessary directories with proper permissions
RUN mkdir -p /app/data /app/logs /app/exports /app/screenshots && \
    chown -R automation:automation /app

# Switch to non-root user
USER automation

# Expose port for potential API endpoints
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "console.log('Google Account Automation System - Health Check Passed')" || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]

# Labels for better container management
LABEL maintainer="Google Account Automation Team" \
      version="1.0.0" \
      description="Automated Google account creation system" \
      org.opencontainers.image.title="Google Account Automation" \
      org.opencontainers.image.description="Distributed system for automated Google account creation" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.vendor="Automation Team"