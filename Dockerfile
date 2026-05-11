# ─────────────────────────────────────────────────────────
# CAFT Financial Server — Production Dockerfile
# ─────────────────────────────────────────────────────────

# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci --ignore-scripts
RUN npx prisma generate

COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy package files and install production-only deps (lean, no dev bloat)
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/prisma ./prisma

RUN npm ci --omit=dev --ignore-scripts \
 && npx prisma generate

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Remove Prisma WASM engine files that bloat Docker layers and cause
# overlayfs extraction failures on containerd (EC2/ECS).
# The native query engine binary is all that's needed at runtime.
RUN find node_modules/.prisma -name "*.wasm*" -delete 2>/dev/null || true \
 && find node_modules/@prisma/client -name "*wasm*" -delete 2>/dev/null || true

EXPOSE 5000

# Start server
CMD ["node", "dist/src/index.js"]
