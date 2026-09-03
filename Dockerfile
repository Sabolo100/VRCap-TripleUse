# =====================================================================
# VR CAP - single image, Coolify friendly.
#
# One container serves both the built WebXR client and the API, which keeps
# TLS termination (and therefore the secure context WebXR requires) a
# reverse-proxy concern rather than an application one.
# =====================================================================

FROM node:22-alpine AS build
WORKDIR /app

# Install with the full workspace manifest set so the lockfile is honoured.
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN npm ci --no-audit --no-fund

# Vite inlines these at BUILD time, so they must be build arguments. Setting
# them as runtime environment variables in Coolify would silently do nothing -
# the bundle is already compiled by then. The defaults are correct for the
# normal single-container deployment, where the server serves the client and
# the API is same-origin.
ARG VITE_API_BASE=""
ARG VITE_WS_BASE=""
ARG VITE_SHEPARD_URL="https://mindview-vr.vercel.app/"
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_WS_BASE=$VITE_WS_BASE \
    VITE_SHEPARD_URL=$VITE_SHEPARD_URL

COPY . .
RUN npm run build -w @vrcap/shared \
 && npm run build -w @vrcap/client \
 && npm run build -w @vrcap/server

# ---------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache tini curl \
 && addgroup -S app && adduser -S app -G app

# All three workspace manifests are required even though the client is not
# installed here: npm ci validates the lockfile against the full workspace set
# declared in the root package.json.
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN npm ci --omit=dev --no-audit --no-fund --workspace @vrcap/server --include-workspace-root \
 && npm cache clean --force

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist

USER app
EXPOSE 8080
ENV PORT=8080 HOST=0.0.0.0 CLIENT_DIR=../client/dist

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/server/dist/index.js"]
