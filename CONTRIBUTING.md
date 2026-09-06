# Contributing

Bug reports, providers, docs, and strategy examples are all welcome.

## Setup

```bash
git clone https://github.com/praveen-palanisamy/agent-browser-runtime.git
cd agent-browser-runtime
npm install
npm run browsers:install   # once, for the browser suite
npm run ci:check           # lint + typecheck + unit tests + pin check
```

Requirements: Node ≥ 20 (CI uses 22). Docker is only needed for the image smoke test.

## Commands

| Command | What |
|---------|------|
| `npm test` | Unit tests — no browser, sub-second |
| `npm run test:browser` | Real Chromium smoke tests (auto-skip if Chromium missing) |
| `npm run lint` / `npm run format` | Biome check / fix |
| `npm run typecheck` / `npm run build` | tsc |
| `node scripts/check-playwright-pin.mjs` | Dockerfile base image == locked `playwright-core` |
| `node scripts/release.mjs --bump=patch` | Bump version + CHANGELOG (used by the release workflow) |

## Pull requests

1. Branch from `main`; keep PRs focused.
2. Add or update tests. Provider changes should include a unit test with a fake `fetch`/handle and, where practical, a browser-suite case.
3. `npm run ci:check` must pass.
4. Update `README.md`, `docs/`, and the `Unreleased` section of `CHANGELOG.md`.
5. Never commit session state, cookies, or tokens — including in fixtures.

## Releases

`release.yml` (manual, choose bump) commits the version + changelog and pushes a `vX.Y.Z` tag. The tag triggers `publish-npm.yml` (npmjs via Trusted Publishing with provenance, plus GitHub Packages) and `publish-image.yml` (multi-arch image on GHCR). `release-on-green.yml` drafts the GitHub Release. See `docs/DEPLOY.md` for the one-time npm Trusted Publisher setup.

## Layout

```
src/platform.ts       PlatformId
src/core/             contracts, AgentPoster, SessionCaptureManager, InMemorySessionStore
src/providers/        playwright (local + CDP), steel, kernel
src/service/          config, runner, HTTP server, live-view proxy, serialization
src/client/           AgentRunnerClient (no Playwright)
src/protocol.ts       wire types + routes
src/cli.ts            serve / health / probe
examples/             demo strategy module
__tests__/            unit (default) and browser/ (Chromium) suites
```
