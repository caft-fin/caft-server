# ─────────────────────────────────────────────────────────
# CAFT Financial Server — Production Dockerfile
# ─────────────────────────────────────────────────────────
# Multi-stage build designed to avoid overlayfs/containerd
# extraction failures on EC2 (symlink + large layer issues).

# ══════════════════════════════════════════════════════════
# Stage 1: Builder — full install, generate, compile
# ══════════════════════════════════════════════════════════
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci --ignore-scripts
RUN npx prisma generate

COPY . .
RUN npm run build

# ══════════════════════════════════════════════════════════
# Stage 2: Production — lean runtime image
# ══════════════════════════════════════════════════════════
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy package manifests and prisma schema
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/prisma ./prisma

# Install production-only deps WITHOUT bin-links.
#  --no-bin-links  → prevents symlinks in node_modules/.bin/ that
#                    cause containerd overlayfs extraction failures
#  --ignore-scripts → skip postinstall hooks (prisma generate etc.)
RUN npm ci --omit=dev --ignore-scripts --no-bin-links

# Copy the pre-generated Prisma client from the builder stage.
# This avoids needing to run `npx prisma generate` here (which
# would require bin-links or the prisma CLI binary).
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Copy the Prisma CLI engine from the builder so `prisma migrate deploy`
# works inside the production container (used by CI/CD pipeline).
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma/engines ./node_modules/@prisma/engines

# Safety net: remove .bin dir (symlinks cause overlayfs failures).
# Remove only the WASM *runtime* files from the Prisma client that
# bloat Docker layers (~45MB base64 engine). Do NOT touch the Prisma
# CLI's own .wasm files (e.g. prisma_schema_build_bg.wasm) — those
# are small and needed for `prisma migrate deploy`.
RUN rm -rf node_modules/.bin 2>/dev/null || true \
 && find node_modules/.prisma/client -name "*.wasm*" -type f -delete 2>/dev/null || true \
 && find node_modules/@prisma/client -name "*wasm*" -type f -delete 2>/dev/null || true

# Copy compiled TypeScript output
COPY --from=builder /app/dist ./dist

EXPOSE 5000

CMD ["node", "dist/src/index.js"]
