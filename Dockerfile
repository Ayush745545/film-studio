# ══════════════════════════════════════════════════════════════
#  AI Film Studio — production image
#
#  Multi-stage: deps → build → runtime. The runtime stage carries only the
#  traced standalone server plus ffmpeg, so heavy media work can run in the
#  same image or be split out with `AFS_WORKER_MODE=external`.
# ══════════════════════════════════════════════════════════════

# ── 1. dependencies ───────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
# `npm ci` is reproducible; prisma generate needs the schema present.
RUN npm ci --no-audit --no-fund

# ── 2. build ──────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time memory ceiling. Raise this if you build on a larger host.
ENV NODE_OPTIONS=--max-old-space-size=2048
ENV AFS_STANDALONE=1
# DATABASE_URL must exist for `prisma generate` even when building an image that
# will run on the embedded file driver.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npx prisma generate
RUN npx next build

# ── 3. runtime ────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app
# ffmpeg enables server-side H.264/H.265/ProRes renders. Without it the app
# still exports via the in-browser renderer, stems and project bundles.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    AFS_DATA_DIR=/data \
    AFS_STORAGE_DIR=/data/storage

# Non-root runtime user
RUN groupadd --system --gid 1001 afs && useradd --system --uid 1001 --gid afs afs

COPY --from=build --chown=afs:afs /app/.next/standalone ./
COPY --from=build --chown=afs:afs /app/.next/static ./.next/static
COPY --from=build --chown=afs:afs /app/public ./public
COPY --from=build --chown=afs:afs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=afs:afs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build --chown=afs:afs /app/prisma ./prisma
COPY --chown=afs:afs scripts ./scripts
COPY --chown=afs:afs src/workers ./src/workers
COPY --chown=afs:afs src/lib ./src/lib
COPY --chown=afs:afs src/types ./src/types
COPY --chown=afs:afs package.json tsconfig.json ./
COPY --from=deps --chown=afs:afs /app/node_modules ./node_modules

RUN mkdir -p /data/storage && chown -R afs:afs /data
VOLUME ["/data"]
USER afs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/system >/dev/null || exit 1

CMD ["node", "server.js"]
