/* Agent Browser Runtime (ABR) — project site behaviour.
   Source: https://github.com/praveen-palanisamy/agent-browser-runtime (MIT)
   - install tabs
   - live version badges (GitHub Releases + npm registry) so the page never
     goes stale between deploys
   - simulated runner output that mirrors the real /v1/post contract */

const REPO = 'praveen-palanisamy/agent-browser-runtime';
const NPM = '@praveen-palanisamy/agent-browser-runtime';

/* ---------- tabs ---------- */
for (const tabs of document.querySelectorAll('[role="tablist"]')) {
  const buttons = tabs.querySelectorAll('[role="tab"]');
  const panels = tabs.querySelectorAll('[data-panel]');
  for (const b of buttons) {
    b.addEventListener('click', () => {
      for (const x of buttons) x.setAttribute('aria-selected', String(x === b));
      for (const p of panels) p.hidden = p.dataset.panel !== b.dataset.tab;
    });
  }
}

/* ---------- live versions ---------- */
async function json(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function refreshVersions() {
  const pill = document.getElementById('release-pill');
  const stars = document.getElementById('stars');
  try {
    const rel = await json(
      `https://api.github.com/repos/${REPO}/releases/latest`
    );
    if (rel?.tag_name && pill) {
      pill.innerHTML = `<span class="dot"></span> ${rel.tag_name} · ${new Date(rel.published_at).toLocaleDateString()}`;
      pill.href = rel.html_url;
      for (const el of document.querySelectorAll('[data-image-tag]')) {
        el.textContent = rel.tag_name.replace(/^v/, '');
      }
    }
  } catch {
    /* rate-limited or offline: keep build-time version */
  }
  try {
    const repo = await json(`https://api.github.com/repos/${REPO}`);
    if (stars && typeof repo.stargazers_count === 'number') {
      stars.textContent = `★ ${repo.stargazers_count}`;
      stars.hidden = false;
    }
  } catch {
    /* ignore */
  }
  try {
    const pkg = await json(
      `https://registry.npmjs.org/${encodeURIComponent(NPM)}/latest`
    );
    if (pkg?.version) {
      for (const el of document.querySelectorAll('[data-npm-version]')) {
        el.textContent = `v${pkg.version}`;
      }
    }
  } catch {
    /* ignore */
  }
}
refreshVersions();

/* ---------- simulated run ---------- */
const SCRIPTS = {
  ok: [
    [
      'dim',
      '→ POST /v1/post  platform=expense-portal  jobId=job_8f2a  workspace=acme  account=u_42',
    ],
    ['', 'validate      description ✓  receipts: 2 ✓'],
    [
      '',
      'provider      local chromium · fresh context · storageState injected (14 cookies, 2 origins)',
    ],
    ['', 'auth          isAuthenticated() → true  (New claim button visible)'],
    ['dim', 'pacing        waiting 3.2s (human-pace jitter)'],
    [
      '',
      'post          fill description · attach 2 receipts · pre-submit assert ✓ · submit',
    ],
    ['', 'verify        claim-number = EXP-2026-00931  ✓'],
    ['', 'session       3 cookies rotated → refreshedSession returned'],
    ['k', '← 200'],
    [
      'ok',
      JSON.stringify(
        {
          ok: true,
          platformPostId: 'EXP-2026-00931',
          platformPostUrl:
            'https://expenses.corp.example/claims/EXP-2026-00931',
          verification: 'toast',
          refreshedSession: '<AgentSessionState>',
        },
        null,
        2
      ),
    ],
  ],
  reauth: [
    [
      'dim',
      '→ POST /v1/post  platform=expense-portal  jobId=job_8f2b  workspace=acme  account=u_42',
    ],
    ['', 'validate      description ✓  receipts: 1 ✓'],
    [
      '',
      'provider      local chromium · fresh context · storageState injected (14 cookies, 2 origins)',
    ],
    ['warn', 'auth          isAuthenticated() → false  (redirected to /login)'],
    ['dim', 'post          skipped — nothing was submitted'],
    ['k', '← 200'],
    [
      'warn',
      JSON.stringify(
        {
          ok: false,
          needsReauth: true,
          failureStage: 'auth',
          error: 'Session expired — re-link the account session',
        },
        null,
        2
      ),
    ],
    [
      'dim',
      '↳ your app: notify user · open capture live view · optional official-API fallback',
    ],
  ],
  uncertain: [
    [
      'dim',
      '→ POST /v1/post  platform=expense-portal  jobId=job_8f2c  workspace=acme  account=u_42',
    ],
    ['', 'validate      description ✓  receipts: 3 ✓'],
    ['', 'provider      steel · session ses_91d · fresh context'],
    ['', 'auth          isAuthenticated() → true'],
    ['dim', 'pacing        waiting 4.7s'],
    [
      '',
      'post          fill description · attach 3 receipts · pre-submit assert ✓ · submit',
    ],
    [
      'bad',
      'verify        claim-number not shown within 15s  (network stall after submit)',
    ],
    ['', 'session       refreshedSession returned (session itself is healthy)'],
    ['k', '← 200'],
    [
      'warn',
      JSON.stringify(
        {
          ok: false,
          uncertain: true,
          failureStage: 'verify',
          error: 'No claim number shown',
          screenshotBase64: '<redacted png>',
          refreshedSession: '<AgentSessionState>',
        },
        null,
        2
      ),
    ],
    [
      'dim',
      '↳ your app: flag for manual review — do NOT retry blindly (it may have been filed)',
    ],
  ],
};

const term = document.querySelector('[data-demo]');
if (term) {
  const log = term.querySelector('.log');
  let running = 0;
  async function play(kind) {
    const id = ++running;
    log.textContent = '';
    for (const [cls, line] of SCRIPTS[kind]) {
      if (id !== running) return;
      const span = document.createElement('span');
      if (cls) span.className = cls;
      span.textContent = `${line}\n`;
      log.appendChild(span);
      await new Promise((r) =>
        setTimeout(r, line.startsWith('{') ? 120 : 260 + Math.random() * 240)
      );
    }
  }
  for (const b of term.querySelectorAll('[data-demo-run]')) {
    b.addEventListener('click', () => play(b.dataset.demoRun));
  }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && !log.textContent) {
      play('ok');
      io.disconnect();
    }
  });
  io.observe(term);
}
