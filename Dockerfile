# syntax=docker/dockerfile:1.7
#
# Jarvis Discord Bot — multi-stage build
#
# Stage 1: install native build deps and compile node-gyp modules (canvas,
# opus, sharp, etc.), then produce a lean runtime image.
#
# Build:    docker build -t jarvis-ai .
# Run:      docker run --env-file .env -p 3000:3000 jarvis-ai
# Compose:  docker compose up -d

# ────────────────────────────────────────────────────────────────────────────
# Build stage
# ────────────────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

WORKDIR /app

# Native deps required to compile canvas, sharp, @discordjs/opus, grpc
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        python3 \
        pkg-config \
        libcairo2-dev \
        libpango1.0-dev \
        libjpeg-dev \
        libgif-dev \
        librsvg2-dev \
        libvips-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

# ────────────────────────────────────────────────────────────────────────────
# Runtime stage
# ────────────────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    NPM_CONFIG_FUND=false \
    UV_THREADPOOL_SIZE=16

WORKDIR /app

# Runtime shared libraries (strictly what the compiled binaries link against)
# Plus ffmpeg + python for yt-dlp, and curl for the HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
        python3 \
        libcairo2 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libjpeg62-turbo \
        libgif7 \
        librsvg2-2 \
        libvips42 \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 jarvis \
    && useradd --system --uid 1001 --gid jarvis --home /app --shell /usr/sbin/nologin jarvis

COPY --from=builder --chown=jarvis:jarvis /app /app

# Ensure mutable dirs exist and are writable by the non-root user
RUN mkdir -p /app/data /app/logs /app/tmp \
    && chown -R jarvis:jarvis /app/data /app/logs /app/tmp

USER jarvis

EXPOSE 3000

# tini reaps yt-dlp/ffmpeg child processes cleanly
ENTRYPOINT ["/usr/bin/tini", "--"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-3000}/health" || exit 1

CMD ["node", "index.js"]
