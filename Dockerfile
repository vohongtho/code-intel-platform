FROM node:22-alpine AS base
WORKDIR /app

# Install build dependencies for native modules (better-sqlite3, bcrypt)
RUN apk add --no-cache python3 make g++ libc6-compat

# ── Dependencies stage ────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY code-intel/shared/package.json ./code-intel/shared/
COPY code-intel/core/package.json ./code-intel/core/
COPY code-intel/web/package.json ./code-intel/web/
RUN npm ci --legacy-peer-deps

# ── Build stage ───────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN npm run build --workspace=code-intel/core
RUN npm run build --workspace=code-intel/web

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS production

# Security: run as non-root user (uid=1000)
RUN addgroup -g 1000 codeuser && adduser -u 1000 -G codeuser -s /bin/sh -D codeuser

WORKDIR /app

# Install only runtime native deps
RUN apk add --no-cache libc6-compat

# Copy built artifacts and production node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/code-intel/core/dist ./code-intel/core/dist
COPY --from=builder /app/code-intel/core/package.json ./code-intel/core/package.json
COPY --from=builder /app/code-intel/web/dist ./code-intel/web/dist
COPY --from=builder /app/code-intel/shared/dist ./code-intel/shared/dist
COPY --from=builder /app/code-intel/shared/package.json ./code-intel/shared/package.json

# Set permissions
RUN chown -R codeuser:codeuser /app

USER codeuser

# Expose default port
EXPOSE 4747

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -q -O- http://localhost:4747/health/live || exit 1

ENV NODE_ENV=production
ENV PORT=4747

CMD ["node", "/app/code-intel/core/dist/cli/main.js", "serve", "/data", "--port", "4747"]
