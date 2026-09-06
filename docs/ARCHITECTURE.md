# Architecture

## Layers

```mermaid
flowchart TB
  Client[client/ AgentRunnerClient<br/>no Playwright] -->|HTTP + bearer| Server[service/server.ts]
  Server --> Runner[service/runner.ts AgentRunner]
  Runner --> Poster[core/poster.ts AgentPoster]
  Runner --> Capture[core/capture.ts SessionCaptureManager]
  Poster --> Store[core/stores.ts InMemorySessionStore]
  Poster --> Prov[SessionProvider]
  Capture --> Prov
  Prov --> Local[providers/playwright.ts<br/>LocalBrowserSessionProvider]
  Prov --> Cdp[providers/playwright.ts<br/>CdpSessionProvider]
  Prov --> Steel[providers/steel.ts]
  Prov --> Kernel[providers/kernel.ts]
  Server --> Live[service/live-proxy.ts]
```

- **core** — pure orchestration over the three contracts. No HTTP, no env.
- **providers** — turn a stored session into a live `BrowserContext`. Remote providers create a browser via REST, connect over CDP, inject `storageState`, and dispose/release on close.
- **service** — env-driven runner: chooses providers per job type, registers the caller's strategies, exposes typed handlers and the HTTP server; proxies Steel's live view.
- **client / protocol** — the wire contract. Everything an orchestrator needs without pulling Playwright into its bundle.

## Session lifecycle

```mermaid
sequenceDiagram
  participant U as User
  participant A as Your app
  participant R as Runner
  participant B as Browser (Steel/Kernel/local)
  A->>R: POST /v1/capture/start {platform}
  R->>B: acquire(interactive)
  R-->>A: captureId, liveViewUrl
  A->>U: iframe liveViewUrl
  U->>B: signs in
  A->>R: POST /v1/capture/finish {captureId}
  R->>B: isAuthenticated? exportState
  R-->>A: AgentSessionState
  A->>A: encrypt + persist
  Note over A,R: later, unattended
  A->>R: POST /v1/post {session, content}
  R->>B: acquire(state) → strategy.isAuthenticated → strategy.post
  R-->>A: AgentPostResult + refreshedSession
  A->>A: persist refreshed session
```

## Verification model

A strategy is responsible for proving the action happened. `AgentPostResult` encodes three distinct outcomes so orchestrators can act safely:

| Result | Meaning | Recommended orchestrator behaviour |
|--------|---------|-------------------------------------|
| `ok: true` + `verification` | Action confirmed (toast/permalink or read-back) | Mark done, persist `refreshedSession` |
| `ok: false`, `uncertain: true` | Submit happened but nothing confirmed it | Flag for manual review; **do not** retry or fall back automatically |
| `ok: false`, `needsReauth: true` | Session invalid | Mark account needs re-auth, notify user, optional fallback |
| `ok: false`, `failureStage` ∈ precheck/compose/media | Aborted **before** submitting | Safe to retry or fall back |
| `ok: false`, `failureStage: submit/verify` (not uncertain) | Failed with evidence nothing was posted | Safe to retry/fallback; inspect screenshot |

## Pacing

`AgentPoster` applies a small randomized delay before acting (`pacing: true`) to look human-scale. Per-account rate limits (minimum spacing, hourly caps) belong in the orchestrator where account state lives; the runner is stateless.

## Provider selection

`RunnerConfig.jobProvider` and `captureProvider` are independent. Typical production layout:

- jobs → `local` (parallel, fresh Chromium per job inside the runner container)
- capture → `steel` (live view) or `kernel` (headful browser with live view URL)

`SerializedProvider` wraps single-session backends (Steel OSS) with a mutex so concurrent requests queue instead of failing.
