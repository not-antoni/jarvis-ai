# Jarvis AI Discord Bot - Production Dockerfile
# 
# Build: docker build -t jarvis-ai -f docker/Dockerfile .
# Run:   docker run -d --env-file .env -p 3000:3000 jarvis-ai

FROM node:24-slim

# Install dependencies for canvas, puppeteer, and ffmpeg
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    ffmpeg \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Create required directories
RUN mkdir -p data logs

# Set environment
ENV NODE_ENV=production
ENV DEPLOY_TARGET=selfhost
ENV SELFHOST_MODE=true

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Run as non-root user
RUN useradd -m -s /bin/bash jarvis && chown -R jarvis:jarvis /app
USER jarvis

CMD ["node", "index.js"]
