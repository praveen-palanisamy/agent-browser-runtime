# ABR: Agent Browser Runtime

**Let your agent act as the user - in their own logged-in browser session - on infrastructure you control.**

[![ci](https://github.com/praveen-palanisamy/agent-browser-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/praveen-palanisamy/agent-browser-runtime/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@praveen-palanisamy/agent-browser-runtime)](https://www.npmjs.com/package/@praveen-palanisamy/agent-browser-runtime)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`agent-browser-runtime` is a small, self-hostable runtime for **stateful, secure browser-session execution**. You capture a user's authenticated session once (they sign in inside a live view; you never see a password), store it encrypted in *your* database, and from then on any scheduled or event-driven job can open a fresh isolated browser, inject that session, drive the site's real UI with verification, and hand back the rotated cookies — without the user's laptop being online and without a developer API.

It is the missing layer between "I have Playwright" and "I can run unattended, per-user, authenticated browser jobs in production":

| Problem | What ABR gives you |
|---------|----------------------------|
| Platforms without a (usable/affordable) API | Ability to drive the real web UI with the user's own session |
| Sessions live on the user's machine | Portable `storageState` you persist encrypted; runs on your servers |
| Cookies rotate, sessions expire | Every job returns the refreshed session; `needsReauth` is a first-class outcome |
| "Did the action actually happen?" | Strategies must verify; `uncertain` results are separated from failures so you never double-act |
| Browser infra is painful | One `SessionProvider` contract over local Chromium, any CDP endpoint, self-hosted [Steel](https://github.com/steel-dev/steel-browser), or [Kernel](https://www.kernel.sh) microVMs |
| Serverless can't run Chromium | An HTTP runner service + a Playwright-free client for functions, queues, and cron |
| Users need to sign in somewhere safe | Interactive capture with an embeddable, proxied live view and unguessable, expiring capture ids |

No browser engine is reinvented here: the runtime orchestrates proven engines (Playwright, Steel, Kernel) and owns the parts they leave to you — session lifecycle, verification contracts, pacing, isolation per job, and a stable wire protocol.

## Use cases

- **Autonomous assistants** that file expense reports, submit timesheets, update CRMs, or fetch statements from portals that have no API.
- **Back-office automation for SaaS** — act inside each customer's vendor, bank, marketplace, or government portal with that customer's own session, isolated and encrypted under your keys.
- **Agent frameworks / MCP tools** that need a durable "act on behalf of this user" primitive with re-auth signalling instead of silent failures.
- **Scheduled, user-authorized publishing** to systems that expose no automation surface — where the user has explicitly authorized each action and the platform's terms permit it; fall back to an official API when one exists and the session is gone.
- **Health probes** that tell users *before* a scheduled job fails that they need to sign in again.

ABR gives you the execution primitive; you remain responsible for using it only with the user's explicit authorization and within each target site's terms of service.

## How it fits together

```mermaid
flowchart LR
  subgraph app [Your application]
    Orch[Orchestrator<br/>cron · queue · serverless]
    Vault[(Encrypted session store<br/>your database)]
    Strat[WebPostStrategy implementations]
  end
  subgraph rt [agent-browser-runtime]
    HTTP[HTTP runner<br/>/v1/post · /v1/probe · /v1/capture/*]
    Core[AgentPoster · SessionCaptureManager]
    Prov[SessionProvider<br/>local · cdp · steel · kernel]
  end
  Orch -->|client, bearer token,<br/>decrypted session in / refreshed out| HTTP
  Vault <--> Orch
  Strat --> Core
  HTTP --> Core --> Prov
  Prov --> Steel[Steel — self-hosted]
  Prov --> Kernel[Kernel — microVMs]
  Prov --> Local[Local Chromium]
```

The runtime is **stateless between requests**: sessions are never persisted by it, every job runs in a fresh browser context that is closed afterwards, and the only in-memory state is an in-flight interactive capture.

## Quick start

```bash
npm i @praveen-palanisamy/agent-browser-runtime
npx playwright-core install chromium        # local provider
```

### 1. Describe a platform (`WebPostStrategy`)

Example: an AI finance assistant files expense reports in a corporate portal that has no API. The user signed in once; every month the assistant submits the report with receipts attached and only reports success when the portal shows a claim number.

```ts
import type { WebPostStrategy } from '@praveen-palanisamy/agent-browser-runtime';

export const expensePortal: WebPostStrategy = {
  platform: 'expense-portal',
  loginUrl: 'https://expenses.corp.example/login',

  validate: (c) =>
    !c.text ? 'Description required'
    : (c.mediaUrls?.length ?? 0) === 0 ? 'At least one receipt required'
    : null,

  async isAuthenticated(ctx) {
    const page = await ctx.newPage();
    await page.goto('https://expenses.corp.example/');
    return page.getByRole('button', { name: 'New claim' }).isVisible();
  },

  async post(ctx, content) {
    const page = await ctx.newPage();
    await page.goto('https://expenses.corp.example/claims/new');
    await page.getByLabel('Description').fill(content.text);
    for (const receipt of content.mediaUrls ?? []) {
      await page.getByLabel('Receipt').setInputFiles(await download(receipt));
    }
    // Pre-submit assert: the form shows exactly what we intend to file.
    if ((await page.getByLabel('Description').inputValue()) !== content.text) {
      return { ok: false, failureStage: 'compose', error: 'Description mismatch' };
    }
    await page.getByRole('button', { name: 'Submit claim' }).click();
    const claim = await page.getByTestId('claim-number').textContent({ timeout: 15_000 }).catch(() => null);
    return claim
      ? { ok: true, platformPostId: claim, platformPostUrl: page.url(), verification: 'toast' }
      : { ok: false, uncertain: true, failureStage: 'verify', error: 'No claim number shown' };
  },
};
```

### 2. Run it as a service

```ts
import { startRunner } from '@praveen-palanisamy/agent-browser-runtime/service';
startRunner({ strategies: [expensePortal] });
```

or with the CLI and a module exporting `WebPostStrategy[]` (see [`examples/demo-strategy`](examples/demo-strategy/index.js)):

```bash
AGENT_RUNNER_TOKEN=$(openssl rand -base64 32) \
  npx agent-browser-runtime serve --strategies ./strategies.js
```

### 3. Call it from anywhere (no Playwright needed)

The orchestrator can be a cron job, a queue worker, or a serverless function — it never loads Playwright.

```ts
import { AgentRunnerClient } from '@praveen-palanisamy/agent-browser-runtime/client';

const runner = new AgentRunnerClient({ baseUrl, token });

// One-time: the employee signs in inside the live view you embed in your app.
const { captureId, liveViewUrl } = await runner.captureStart({ platform: 'expense-portal' });
// ... show liveViewUrl in an iframe; the user completes login (and MFA) ...
const done = await runner.captureFinish({ captureId });
if (done.ok) await vault.save(userId, encrypt(done.state));   // your encrypted store

// Monthly, unattended: file the report the assistant prepared.
const res = await runner.post({
  workspaceId: orgId, accountId: userId, platform: 'expense-portal', jobId,
  session: decrypt(await vault.load(userId)),
  content: {
    text: 'March travel — client onsite, 3 nights',
    mediaUrls: receipts.map((r) => r.signedUrl),
  },
});

if (res.refreshedSession) await vault.save(userId, encrypt(res.refreshedSession)); // rotated cookies
if (res.ok) ledger.record({ claim: res.platformPostId, url: res.platformPostUrl });
if (res.needsReauth) notify(userId, 'Please sign in to the expense portal again');
if (res.uncertain) queueManualReview(jobId);   // submitted but unconfirmed — never retry blindly
```

### Library-only (no HTTP)

```ts
import { AgentPoster, SteelSessionProvider } from '@praveen-palanisamy/agent-browser-runtime';

const poster = new AgentPoster(
  new SteelSessionProvider({ baseUrl: 'http://steel:3000' }),
  myEncryptedStore
).register(expensePortal);
await poster.post({ workspaceId, accountId, platform: 'expense-portal', content: { text, mediaUrls } });
```

## Contracts

| Contract | Responsibility | Provided implementations |
|----------|----------------|--------------------------|
| `SessionStore` | Persist/load `AgentSessionState` (Playwright `storageState` + UA + timestamps) | `InMemorySessionStore`; you implement the encrypted one |
| `SessionProvider` | Turn a stored state into a live `BrowserContext` | `LocalBrowserSessionProvider`, `CdpSessionProvider`, `SteelSessionProvider`, `KernelSessionProvider` |
| `WebPostStrategy` | Drive one platform: `validate`, `isAuthenticated`, `post` | yours (`examples/demo-strategy`) |

`AgentPostResult` is deliberately rich: `ok`, `platformPostId/Url`, `verification: 'toast' | 'timeline'`, `needsReauth`, `uncertain`, `failureStage: 'precheck' | 'auth' | 'compose' | 'media' | 'submit' | 'verify'`, and an optional redacted `screenshotBase64` for your private artifact storage.

## Runner service

| Route | Purpose |
|-------|---------|
| `POST /v1/post` | Publish with an injected session → result + `refreshedSession` |
| `POST /v1/probe` | Cheap auth check; refreshes cookies |
| `POST /v1/capture/start` | Open an interactive browser → `captureId`, `liveViewUrl`, `expiresAt` |
| `POST /v1/capture/finish` · `/cancel` | Export the session / discard |
| `GET /live/{captureId}/…` | Proxied Steel live view (HTTP + WebSocket, iframe-safe) |
| `GET /healthz` | Liveness |

All `/v1/*` routes require `Authorization: Bearer $AGENT_RUNNER_TOKEN`. Live-view paths are guarded by the unguessable capture id and TTL.

Configuration is environment-driven ([`.env.example`](.env.example)). Job and capture providers are independent: run headless jobs in parallel on local Chromium while captures use Steel's live view, or route everything to Kernel for burst capacity. Steel OSS serves one session at a time; `SerializedProvider` queues instead of failing.

## Deploy

- **Local**: `docker compose up` (Steel + runtime; mount strategies via `STRATEGIES_DIR`).
- **Container**: `ghcr.io/praveen-palanisamy/agent-browser-runtime` — extend it with your strategies module (see [`Dockerfile`](Dockerfile)). The Playwright base image and `playwright-core` are pinned to the same version so no browser downloads happen at runtime.
- **Cloud Run / ECS / Nomad**: run the runtime with Steel as a sidecar; pin to one instance per active interactive capture (captures are stateful), scale headless jobs freely. See [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Security posture

- The runtime never persists sessions; your encrypted store is the source of truth. Steel/Kernel profiles are disposable caches.
- Fresh browser context per job, disposed after use; no cross-tenant state.
- Bearer-token auth on every API route; live view requires an active capture id and expires.
- Failure screenshots are returned to the caller for private storage — never served to end users by the runtime.
- Treat `AgentSessionState` with password-equivalent sensitivity. See [`SECURITY.md`](SECURITY.md).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — contracts, lifecycle, verification model
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — providers, environment, Cloud Run / compose patterns
- [`docs/AGENTS.md`](docs/AGENTS.md) — notes for coding agents and LLM tool builders
- [`CHANGELOG.md`](CHANGELOG.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md)

## Development

```bash
npm install
npm run ci:check       # lint + typecheck + unit tests + pin check (what CI runs)
npm run test:browser   # real Chromium smoke (npm run browsers:install first)
```

## License

MIT
