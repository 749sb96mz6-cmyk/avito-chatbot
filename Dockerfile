# ============================================================
# Avito Chatbot — Multi-stage Docker build
# ============================================================
# Stage 1: Install dependencies
# Stage 2: Build frontend (Vite) + backend (esbuild)
# Stage 3: Minimal production image
# ============================================================

# --- Stage 1: Dependencies ---
FROM node:22-alpine AS deps
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/

# Install ALL dependencies (need devDeps for build)
RUN pnpm install --frozen-lockfile

# --- Stage 2: Build ---
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

# Copy deps from stage 1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json

# Copy source code
COPY . .

# Build frontend (Vite) + backend (esbuild)
# The build command: vite build && esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
RUN pnpm build

# --- Stage 3: Production ---
FROM node:22-alpine AS production
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

# Copy package files and install production deps only
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Copy drizzle schema and migrations for db:push
COPY drizzle/ ./drizzle/
COPY drizzle.config.ts ./

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Expose port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Start the server
CMD ["node", "dist/index.js"]
