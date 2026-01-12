# Multi-stage build for Node.js application
FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY src/ ./src/
COPY .eslintrc* ./
COPY jest.config.js ./

# Build the application (backend - no compilation needed)
RUN npm run build

# Production image, copy all the files and run the app
FROM base AS runner
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 taskloot

# Copy application source code
COPY --from=builder --chown=taskloot:nodejs /app/src ./src
COPY --from=deps --chown=taskloot:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=taskloot:nodejs /app/package.json ./package.json

# Create logs directory
RUN mkdir -p /app/logs && chown taskloot:nodejs /app/logs

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node src/utils/healthcheck.js || exit 1

# Switch to non-root user
USER nextjs

# Start the application
CMD ["node", "src/index.js"]
