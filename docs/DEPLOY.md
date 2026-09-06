# Deploying and integrating ABR

## Environment

| Variable | Required | Notes |
|----------|----------|-------|
| `AGENT_RUNNER_TOKEN` | yes | ≥ 16 chars; shared with orchestrators |
| `AGENT_RUNNER_PUBLIC_URL` | for capture | Absolute URL users reach the runner at (live view links) |
| `PORT` | no | default 8080 |
| `AGENT_RUNNER_JOB_PROVIDER` | no | `local` (default) · `steel` · `kernel` |
| `AGENT_RUNNER_CAPTURE_PROVIDER` | no | `steel` when `STEEL_API_URL` is set, else `local` |
| `STEEL_API_URL` / `STEEL_API_KEY` | for steel | e.g. `http://steel:3000`; key only for Steel Cloud |
| `KERNEL_API_KEY` / `KERNEL_API_URL` | for kernel | default `https://api.onkernel.com` |
| `AGENT_RUNNER_CAPTURE_TTL_MS` | no | default 20 min |
| `AGENT_RUNNER_PACING` | no | `false` disables human-pace jitter (tests) |

## Local (Docker Compose)

```bash
AGENT_RUNNER_TOKEN=$(openssl rand -base64 32) STRATEGIES_DIR=$PWD/examples/demo-strategy docker compose up --build
curl -H "authorization: Bearer $AGENT_RUNNER_TOKEN" localhost:8080/healthz
```

Steel is exposed on `:3000` (API + live view) and `:9223` (CDP). Only the runtime should reach them in production.

## Container image

`ghcr.io/praveen-palanisamy/agent-browser-runtime:<version>` bundles Node, Playwright's Chromium and the runtime CLI. Extend it with your strategies:

```dockerfile
FROM ghcr.io/praveen-palanisamy/agent-browser-runtime:latest
COPY dist/strategies.js /app/strategies.js
CMD ["serve", "--strategies", "/app/strategies.js"]
```

The image pins `playwright-core` to the base image's Playwright version (`ARG PLAYWRIGHT_VERSION`), verified in CI by `scripts/check-playwright-pin.mjs`, so no browser download happens at runtime.

## Cloud Run (runtime + Steel sidecar)

- One service, two containers: the runtime (ingress) and `ghcr.io/steel-dev/steel-browser-api` on `localhost:3000`.
- Set `STEEL_API_URL=http://127.0.0.1:3000`, `AGENT_RUNNER_CAPTURE_PROVIDER=steel`, `AGENT_RUNNER_JOB_PROVIDER=local`.
- Interactive captures are stateful (a browser stays open while the user signs in), so pin `minScale = maxScale = 1` or add sticky routing. Headless jobs are parallel inside the instance.
- Ingress must be public for the live view; every API route is still token-protected. Store `AGENT_RUNNER_TOKEN` in Secret Manager.
- Give the Steel container ≥ 2 GiB memory and mount an in-memory volume at `/app/.cache`; nothing durable lives there.

The same shape works on ECS/Fargate task definitions or a Nomad group.

## Scaling beyond one instance

- Move captures to **Kernel** (`AGENT_RUNNER_CAPTURE_PROVIDER=kernel`): each capture gets its own microVM with a live view URL, so instances become interchangeable.
- Or run several runner instances and route `/v1/capture/finish|cancel` and `/live/{captureId}` by capture id (hash or header) at the load balancer.

## Ways to consume ABR

| Channel | Best for | Pin |
|---------|----------|-----|
| [npm `@praveen-palanisamy/agent-browser-runtime`](https://www.npmjs.com/package/@praveen-palanisamy/agent-browser-runtime) | embedding the library or client in your app | `^0.1` |
| [GHCR `ghcr.io/praveen-palanisamy/agent-browser-runtime`](https://github.com/praveen-palanisamy/agent-browser-runtime/pkgs/container/agent-browser-runtime) | running the runner service (Chromium included) | `:0.1`, `:latest` |
| [GitHub Action](GITHUB_ACTION.md) | probes and jobs from CI without a service | `@v0` |

Releases are cut automatically from `main`; every semver tag publishes all three channels with provenance. Follow the [Releases page](https://github.com/praveen-palanisamy/agent-browser-runtime/releases) or watch the [changelog](../CHANGELOG.md).
