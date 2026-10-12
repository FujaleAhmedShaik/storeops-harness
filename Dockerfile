# syntax=docker/dockerfile:1
# Works unchanged with Podman (`podman build`) and Docker. Base images are updated by Dependabot.
# Node 24 LTS on Debian 13: Node 20 is end-of-life, and the Debian 12 distroless tag still shipped vulnerable libssl3.

# ---- build: compile TypeScript, then drop dev dependencies ----
FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# ---- runtime: distroless (no shell, no package manager), non-root ----
FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /app/dist ./dist
COPY --from=build --chown=65532:65532 /app/package.json ./package.json
# 65532 is the distroless "nonroot" user; a numeric id lets orchestrators verify it is not root.
USER 65532:65532
EXPOSE 3000
# The distroless entrypoint is `node`; liveness is probed by the orchestrator (compose / Container Apps).
CMD ["dist/index.js"]
