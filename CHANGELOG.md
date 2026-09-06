# Changelog

## Unreleased

- **CLI**: new `post` command; `--local` runs `probe`/`post` in-process with local Chromium (no service needed); `--session-out`, `--out`, `--content`, `version`.
- **GitHub Action**: `praveen-palanisamy/agent-browser-runtime@v0` composite action (`command: probe|post`) with `ok` / `authenticated` / `needs-reauth` / `uncertain` outputs; floating major tag maintained by `release-on-green`.
- **Attribution**: `/healthz` reports `name`, `version`, `repository`; `Server` header on all JSON responses.
- **Docs & site**: project website on GitHub Pages (auto-deployed on releases), `docs/GITHUB_ACTION.md`, distribution-channel table in `docs/DEPLOY.md`; README use cases and examples reworked around an expense-portal assistant.

## v0.1.0 — 2026-09-06

First public release.

- **Contracts**: `SessionStore`, `SessionProvider`, `WebPostStrategy`; rich `AgentPostResult` (`verification`, `uncertain`, `needsReauth`, `failureStage`, redacted screenshot).
- **Orchestration**: `AgentPoster` (load → acquire → auth probe → pacing → post → persist rotated cookies), `SessionCaptureManager` (interactive sign-in with TTL and unguessable ids).
- **Providers**: local Chromium, any CDP endpoint, self-hosted/cloud Steel, Kernel microVMs; `SerializedProvider` for single-session backends.
- **Runner service**: bearer-protected HTTP API (`/v1/post`, `/v1/probe`, `/v1/capture/*`), Steel live-view proxy (HTTP + WebSocket, iframe-safe), `/healthz`.
- **Client**: Playwright-free `AgentRunnerClient` with transient/permanent error classification.
- **CLI**: `serve --strategies <module>`, `health`, `probe`.
- **Packaging**: `.`, `./client`, `./service` entry points; container image on GHCR; npm Trusted Publishing with provenance; GitHub Packages mirror.
