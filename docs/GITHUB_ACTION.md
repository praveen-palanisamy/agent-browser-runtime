# GitHub Action

ABR ships as a composite action so you can run authenticated browser jobs from any workflow — no runner service to deploy. It installs the runtime and Chromium on the job runner and executes the CLI in-process (`--local`).

```yaml
- uses: praveen-palanisamy/agent-browser-runtime@v0
  with:
    command: probe                      # or: post
    platform: expense-portal
    strategies: ./automation/strategies.js
    session: ${{ secrets.EXPENSE_PORTAL_SESSION }}
```

## Typical workflows

### Nightly session health check

Tell users *before* a scheduled job fails that they need to sign in again.

```yaml
name: session-health
on:
  schedule: [{ cron: "0 6 * * *" }]
jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - id: abr
        uses: praveen-palanisamy/agent-browser-runtime@v0
        with:
          command: probe
          platform: expense-portal
          strategies: ./automation/strategies.js
          session: ${{ secrets.EXPENSE_PORTAL_SESSION }}
          fail-on-reauth: "false"
      - if: steps.abr.outputs.needs-reauth == 'true'
        run: ./notify.sh "Expense portal session expired — please sign in again"
```

### Run a job with the stored session

```yaml
      - id: abr
        uses: praveen-palanisamy/agent-browser-runtime@v0
        with:
          command: post
          platform: expense-portal
          strategies: ./automation/strategies.js
          session: ${{ secrets.EXPENSE_PORTAL_SESSION }}
          text: "March travel — client onsite"
          media: https://files.example/receipt-1.jpg,https://files.example/receipt-2.jpg
      - name: Persist rotated cookies
        if: always()
        run: ./vault put expense-portal-session "${{ steps.abr.outputs.session-file }}"
      - name: Never retry blindly
        if: steps.abr.outputs.uncertain == 'true'
        run: ./open-review-ticket.sh "${{ steps.abr.outputs.result-file }}"
```

## Inputs

| Input | Default | Notes |
|-------|---------|-------|
| `command` | `probe` | `probe` or `post` |
| `platform` | — | must match a strategy's `platform` |
| `session` / `session-file` | — | `AgentSessionState` JSON; pass a secret or a file path |
| `strategies` | bundled demo | module exporting `WebPostStrategy[]` |
| `text`, `media`, `link`, `content-file` | — | job content (`post`) |
| `workspace`, `account` | `github-actions` / `default` | job identity |
| `session-out` | `.abr/session.refreshed.json` | refreshed session written here |
| `result-out` | `.abr/result.json` | JSON result written here |
| `fail-on-reauth` | `true` | fail the step when re-auth is needed |
| `pacing` | `true` | human-pace jitter before acting |
| `node-version` | `24` | |

## Outputs

`ok`, `authenticated`, `needs-reauth`, `uncertain`, `result-file`, `session-file`.

Exit codes of the underlying CLI: `0` success · `2` not authenticated / failed · `3` uncertain (ran, unverified).

## Security notes

- Store sessions as **encrypted secrets**; the action writes the secret to a temp file and deletes it after the run.
- Refreshed sessions are written to `session-out` in the workspace — persist them back to your vault and do not upload them as public artifacts.
- The action runs on GitHub's runner IPs. Sites that fingerprint location may still ask for re-auth; for stable egress, run the [HTTP runner service](DEPLOY.md) instead.
- Use ABR only with the user's explicit authorization and within each site's terms of service.

## Versioning

`@v0` tracks the latest green commit on `main` (moved automatically); pin `@v0.1.0` for immutable builds.
