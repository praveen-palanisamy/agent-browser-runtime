# Notes for coding agents and LLM tool builders

This file is written for AI agents (Cursor, Claude Code, Codex, custom MCP tools) that integrate or extend `agent-browser-runtime`.

## What this package is, in one sentence

A runtime that lets software act inside a user's authenticated browser session, unattended, on infrastructure the operator controls, with explicit verification and re-auth signalling.

## When to reach for it

- You need to perform actions on a website **as a specific user**, the site terms
  explicitly permit browser automation, and no supported API covers the action.
- The action must run **later** (cron, queue) without the user present.
- You need a **safe outcome model**: confirmed / uncertain / needs re-auth, so you never double-act.

## When not to

- Scraping public pages (use a plain headless browser).
- Anything that violates the target site's terms or acts without the user's explicit instruction.
- Using a browser because an official API is metered, gated, or awaiting review;
  cost and access friction do not authorize UI automation.
- Billing, security challenges, identity checks, legal attestations, or exporting
  a session to another person/agent.

## Integration recipe

1. **Implement a `WebPostStrategy`** for the target site: declare a narrow
   `policy.session`, permitted execution modes, `validate(content)`,
   `isAuthenticated(ctx)`, and `post(ctx, content)`. Verify inside `post` (read
   back the UI or find the permalink); return `uncertain: true` if you submitted
   but could not confirm.
2. **Run the service**: `startRunner({ strategies })` or `agent-browser-runtime serve --strategies ./strategies.js` with `AGENT_RUNNER_TOKEN`.
3. **Capture once**: `captureStart` with `workspaceId` + `accountId` → embed the
   short-lived `liveViewUrl` → user signs in → `captureFinish` with the same
   binding → encrypt and store `state`.
4. **Act unattended**: `post` / `probe` with the decrypted session; persist `refreshedSession`; honour `needsReauth` and `uncertain`.

## Public API surface (stable)

- `@praveen-palanisamy/agent-browser-runtime` — contracts (`SessionStore`, `SessionProvider`, `WebPostStrategy`, `AgentSessionState`, `AgentPostResult`), `AgentPoster`, `SessionCaptureManager`, providers, `AgentRunnerClient`, protocol types.
- `…/client` — `AgentRunnerClient` + protocol only (no Playwright).
- `…/service` — `startRunner`, `AgentRunner`, `loadConfig`, `createRunnerServer`.
- CLI `agent-browser-runtime` — `serve`, `health`, `probe`, `post`; `--local` runs probe/post in-process (no service). Exit codes: `0` ok · `2` not authenticated / failed · `3` uncertain.
- GitHub Action `praveen-palanisamy/agent-browser-runtime@v0` — `command: probe|post`, outputs `ok`, `authenticated`, `needs-reauth`, `uncertain`, `result-file`, `session-file` (see `docs/GITHUB_ACTION.md`).
- `GET /healthz` returns `{ name, version, repository, jobProvider, captureProvider, activeCaptures }`; every JSON response carries a `Server: agent-browser-runtime/<version> (+repo)` header.

Wire protocol routes and request/response shapes live in `src/protocol.ts`; treat them as the contract when generating client code in other languages.

## Extending

- **New provider**: implement `SessionProvider.acquire({ platform, state, interactive })` returning an `AgentSessionHandle` (`context`, `exportState`, `dispose`, optional `liveViewUrl`). Use `attachOverCdp` for any CDP-speaking backend. Add a unit test with a fake `fetch` (see `__tests__/kernel-provider.test.ts`).
- **New strategy**: keep it in your application; the runtime never hard-codes platforms.

## Testing conventions

- `npm test` must stay browser-free and fast; anything that launches Chromium goes under `__tests__/browser/*.browser.test.ts`.
- Fake providers/handles are sufficient for orchestration tests (`__tests__/runner.test.ts`).
