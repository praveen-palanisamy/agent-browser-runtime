# Changelog

## Unreleased

- **Session scope**: strategies can declare allowed cookie domains and exact
  local-storage origins; ABR sanitizes state on import, capture, and refresh.
- **Execution policy**: strategies independently allow interactive capture and
  unattended actions; denied attempts produce redacted audit events.
- **Capture isolation**: capture management is bound to `workspaceId` +
  `accountId`; live views use a distinct expiring credential that cannot export
  or cancel a session.
- **Audit lifecycle**: optional best-effort `AuditSink` for redacted capture,
  probe, post, expiry, cancellation, and policy-denial events.
- **Protocol change**: capture start/finish/cancel now require `workspaceId` and
  `accountId`. Embedding applications must pass the same binding throughout the
  capture lifecycle.
- **Policy guidance**: document that an authenticated user session does not
  authorize automation and that billing, security challenges, identity checks,
  and legal attestations remain out of scope.

## v0.1.1 — 2026-09-07

- **Release pipeline**: `release.yml` only bumps and commits; `release-on-green` owns the semver tag + draft GitHub Release after CI is green (so publishing the draft is the single fan-out to npm / GHCR / Pages / Marketplace). Drafts a release even when the tag already exists.
- **CLI**: new `post` command; `--local` runs `probe`/`post` in-process with local Chromium (no service needed); `--session-out`, `--out`, `--content`, `version`.
- **GitHub Action**: `praveen-palanisamy/agent-browser-runtime@v0` composite action (`command: probe|post`) with `ok` / `authenticated` / `needs-reauth` / `uncertain` outputs; floating major tag maintained by `release-on-green`.
- **Attribution**: `/healthz` reports `name`, `version`, `repository`; `Server` header on all JSON responses.
- **Toolchain**: Node 24 everywhere (`.node-version`, CI, Pages, Action default); `engines.node >= 22`. Biome 2, TypeScript 7 (`module`/`moduleResolution: node16`, still CommonJS output), Vitest 5, `@types/node` 26. GitHub Actions bumped to Node 24-compatible majors (checkout v7, setup-node v7, docker/* v4/v7, pages v5/v6); grouped Dependabot updates for actions.
- **Fix**: container build keeps optional dependencies (TypeScript 7 ships its compiler as platform-specific optional packages).
- **Fix**: `action.yml` input description contained a `${{ … }}` expression, which made the runner reject the manifest.
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
