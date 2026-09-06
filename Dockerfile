# syntax=docker/dockerfile:1
# Base image for an agent-browser-runtime service.
#
# This image contains the runtime + Chromium only. Embedding applications
# add their strategies module and start the runner, e.g.:
#
#   FROM ghcr.io/praveen-palanisamy/agent-browser-runtime:latest
#   COPY dist/strategies.js /app/strategies.js
#   CMD ["agent-browser-runtime", "serve", "--strategies", "/app/strategies.js"]
#
# Listens on $PORT (8080); requires AGENT_RUNNER_TOKEN. See .env.example.

# The Playwright base image ships browsers for exactly one Playwright version;
# playwright-core is pinned to the same version at build time so the local
# provider needs no downloads. scripts/check-playwright-pin.mjs keeps this ARG
# aligned with package-lock.json in CI.
ARG PLAYWRIGHT_VERSION=1.63.0

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS build
ARG PLAYWRIGHT_VERSION
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm pkg set dependencies.playwright-core=${PLAYWRIGHT_VERSION} \
  && npm install --no-audit --no-fund --omit=optional --ignore-scripts
COPY src ./src
RUN npx tsc -p tsconfig.json && npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN ln -s /app/dist/cli.js /usr/local/bin/agent-browser-runtime && chmod +x /app/dist/cli.js
USER pwuser
EXPOSE 8080
ENTRYPOINT ["agent-browser-runtime"]
CMD ["help"]
