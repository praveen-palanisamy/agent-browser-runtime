# Changelog

## Unreleased

- (add changes here)

## v0.1.0 — 2026-09-06

First public release.

- **Contracts**: `SessionStore`, `SessionProvider`, `WebPostStrategy`; rich `AgentPostResult` (`verification`, `uncertain`, `needsReauth`, `failureStage`, redacted screenshot).
- **Orchestration**: `AgentPoster` (load → acquire → auth probe → pacing → post → persist rotated cookies), `SessionCaptureManager` (interactive sign-in with TTL and unguessable ids).
- **Providers**: local Chromium, any CDP endpoint, self-hosted/cloud Steel, Kernel microVMs; `SerializedProvider` for single-session backends.
- **Runner service**: bearer-protected HTTP API (`/v1/post`, `/v1/probe`, `/v1/capture/*`), Steel live-view proxy (HTTP + WebSocket, iframe-safe), `/healthz`.
- **Client**: Playwright-free `AgentRunnerClient` with transient/permanent error classification.
- **CLI**: `serve --strategies <module>`, `health`, `probe`.
- **Packaging**: `.`, `./client`, `./service` entry points; container image on GHCR; npm Trusted Publishing with provenance; GitHub Packages mirror.
