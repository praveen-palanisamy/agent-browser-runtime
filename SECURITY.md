# Security

## Reporting

Please report vulnerabilities privately via GitHub's *Report a vulnerability* button on this repository (Security → Advisories). Do not open public issues for security reports. You will get an acknowledgement within a few days.

## Threat model in one paragraph

`AgentSessionState` (cookies + storage) grants full account access on the target platform. The runtime is designed so that it **never persists** that state: it arrives in each request, is injected into a fresh browser context, the context is disposed, and the refreshed state is returned to the caller. Persistence, encryption, and access control are the embedding application's responsibility.

## Operator checklist

- Put the runner on a private network or behind an authenticating proxy; the bearer token (`AGENT_RUNNER_TOKEN`, ≥ 16 chars, keep it in a secret manager) is the only API auth.
- Terminate TLS in front of the runner; the live view is loaded by end users' browsers.
- Encrypt `AgentSessionState` at rest with keys you control (e.g. AES-256-GCM) and never expose it to end-user clients.
- Keep Steel/Kernel endpoints private; only the runner should reach them.
- Store failure screenshots (`screenshotBase64`) in private storage and redact before showing them to anyone.
- Rotate the bearer token when staff with access leave; it is shared between orchestrator and runner.
- Respect the target platforms' terms: act only on explicit user instruction, at human pace.
