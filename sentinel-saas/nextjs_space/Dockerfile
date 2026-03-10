FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Install dependencies with npm (bypasses yarn TS patch issue)
RUN npm ci --legacy-peer-deps

# Generate Prisma client
RUN npx prisma generate

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build Next.js (no standalone — use next start instead)
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy everything needed to run next start
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.js ./next.config.js

# Startup script: push schema changes to DB then start Next.js
RUN printf '#!/bin/sh\necho "🔄 Applying Prisma schema to database..."\nnpx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "⚠️ prisma db push failed (continuing)"\necho "🚀 Starting Next.js..."\nexec npx next start -p 8080\n' > /app/start.sh && chmod +x /app/start.sh

EXPOSE 8080

CMD ["/bin/sh", "/app/start.sh"]

