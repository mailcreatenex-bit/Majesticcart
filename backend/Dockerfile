# Multi-stage build: compile with full devDependencies, ship only the
# runtime bits. Puppeteer's own Chromium download is skipped in favour of
# Debian's `chromium` package — it comes with the shared libraries Puppeteer
# needs already wired up, which its own downloaded binary does not on a slim
# base image.

FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
# argon2 and a couple of other deps ship native addons that node-gyp has to
# compile on install — the slim image has no compiler at all otherwise.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 3001
# `db push` rather than `migrate deploy`: this schema's own migration history
# is incomplete (see prisma/migrations — most of it was applied locally with
# `db push` because the dev DB role lacks CREATEDB for migrate's shadow DB).
# `db push` reconciles the target directly against schema.prisma regardless
# of history, which is what local dev already relies on. Fine for standing
# up a fresh database; swap for `migrate deploy` once a real migration
# history exists and this stops being a first deploy.
CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && node dist/main"]
