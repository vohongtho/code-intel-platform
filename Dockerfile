# node:22-alpine (musl libc) cannot run this product at all: @ladybugdb/core
# ships prebuilt native binaries ONLY for glibc-based Linux (optionalDependencies
# @ladybugdb/core-linux-x64 / -linux-arm64, no musl variant), and its lbugjs.node
# segfaults under Alpine — `ldd` shows every napi_*/__*_chk symbol unresolved,
# confirmed by actually running the built image (task 6.5). `libc6-compat` only
# shims basic glibc symbol names for dynamic linking; it does not provide a real
# glibc, and does not fix Node N-API ABI compatibility for a module actually
# built against glibc. node:22-bookworm-slim (Debian, real glibc) is required.
FROM node:22-bookworm-slim AS base
WORKDIR /app

# Upgrade bundled npm to pull fixed tar transitive versions before image scanning
RUN npm install -g npm@12.0.1

# Install build dependencies for bcrypt and other native addons. libssl3 is
# a real runtime shared-library dependency of @ladybugdb/core's native addon
# (confirmed via `ldd` — it dynamically links libssl.so.3/libcrypto.so.3
# itself, separate from and in addition to Node's own statically-linked
# OpenSSL) — node:22-bookworm-slim does not include it by default.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ libssl3 && rm -rf /var/lib/apt/lists/*

# ── Dependencies stage ────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY code-intel/shared/package.json ./code-intel/shared/
COPY code-intel/core/package.json ./code-intel/core/
COPY code-intel/web/package.json ./code-intel/web/
RUN npm ci

# ── Build stage ───────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
# Authoritative product build (shared -> web -> core) — see package.json
# build:product. Core packaging fails loudly if Web was not built first.
RUN npm run build:product

# ── Production stage ──────────────────────────────────────────────────────────
# Must match `base`'s glibc-based image — see the note above `base`.
FROM node:22-bookworm-slim AS production

# NOTE: removes npm/npx entirely from this stage rather than upgrading them.
# This stage's CMD only ever runs `node ...` directly — npm is never invoked
# at runtime. Confirmed via Trivy (task 18.4) that EITHER keeping the base
# image's bundled npm OR upgrading it (the previous `npm install -g
# npm@12.0.1`, originally added to fix a `tar` CVE) still leaves the image
# vulnerable: every npm version vendors its own internal copies of tar/
# brace-expansion/ip-address/pacote/etc for its own CLI operations, entirely
# separate from — and not fixed by — this project's own dependencies (which
# are already correctly pinned via package.json's `overrides` and installed
# from package-lock.json in the `deps` stage). Deleting npm outright removes
# that whole class of findings instead of trading one npm version's vendored
# CVEs for another's, with no functional loss since this stage never calls it.
#
# libssl3 is a real runtime dependency of @ladybugdb/core's native addon —
# see the note on the `base` stage above. Also create the non-root runtime
# user (uid=1001, avoids clash with node:slim's built-in node user at 1000)
# here in the same layer.
RUN apt-get update && apt-get install -y --no-install-recommends libssl3 && rm -rf /var/lib/apt/lists/* \
  && groupadd -g 1001 codeuser && useradd -u 1001 -g codeuser -s /bin/sh -m codeuser \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
            /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

WORKDIR /app

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

# Health check (plain Node http request — node:22-bookworm-slim has no wget/curl
# by default, unlike the previous Alpine base)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4747/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENV NODE_ENV=production
ENV PORT=4747

CMD ["node", "/app/code-intel/core/dist/cli/main.js", "serve", "/data", "--port", "4747"]
