# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Builder — installs all deps, compiles TS to dist/, then prunes dev deps so
# the runtime stage can copy node_modules directly without a second install.
# ---------------------------------------------------------------------------
FROM node:20.18-alpine AS builder

# python3/make/g++ are kept as fallback for any addon that falls through to
# node-gyp; sharp 0.33+ uses prebuilds in @img/sharp-libvips-linuxmusl-* and
# normally won't compile from source. ffmpeg is needed by ffmpeg-static linkage
# checks during install.
RUN apk add --no-cache python3 make g++ ffmpeg

WORKDIR /app

# package files first so the npm layer caches across source-only changes.
COPY package.json package-lock.json ./

# npm ci uses the lockfile verbatim → reproducible builds. BuildKit cache
# mount keeps the npm store warm between CI runs.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=optional

COPY . .

RUN npm run build

# Strip devDependencies in place so we don't run npm twice in the runtime stage.
RUN --mount=type=cache,target=/root/.npm \
    npm prune --omit=dev

# ---------------------------------------------------------------------------
# Runtime — minimal image with only what's needed to run the compiled app.
# ---------------------------------------------------------------------------
FROM node:20.18-alpine AS runner

# ffmpeg for video transcoding; tini gives us a real PID 1 so SIGTERM forwards
# to node and uploads can drain cleanly; wget powers the HEALTHCHECK below.
RUN apk add --no-cache ffmpeg tini wget

ENV NODE_ENV=production \
    PORT=4881 \
    NODE_OPTIONS=--max-old-space-size=1536

WORKDIR /app

# node:alpine ships a non-root 'node' user (uid 1000). Running as non-root
# limits blast radius if a libvips/ffmpeg parser bug were ever exploited.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./

USER node

EXPOSE 4881

# Container restarts only when /health fails. /readyz (used by the LB to drain
# saturated instances) intentionally returns 503 without killing the process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4881/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]
