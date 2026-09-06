#!/usr/bin/env node
/**
 * Build the GitHub Pages site into site/dist.
 *
 *  - copies site/src, injecting {{VERSION}} from package.json
 *  - renders README.md + docs/*.md to HTML pages with the same head metadata
 *  - emits robots.txt, sitemap.xml, llms.txt, llms-full.txt, humans.txt,
 *    .nojekyll
 *
 * Idempotent: site/dist is rebuilt from scratch on every run. The deployed
 * page additionally refreshes release/npm versions client-side (site/src/app.js).
 */

import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'site', 'src');
const distDir = path.join(root, 'site', 'dist');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const SITE = 'https://praveen-palanisamy.github.io/agent-browser-runtime/';
const REPO = 'https://github.com/praveen-palanisamy/agent-browser-runtime';
const AUTHOR = 'Praveen Palanisamy';
const VERSION = pkg.version;
const today = new Date().toISOString().slice(0, 10);

const inject = (s) =>
  s.replaceAll('{{VERSION}}', VERSION).replaceAll('{{BUILD_DATE}}', today);

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

// 1. static assets
for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
  const from = path.join(srcDir, entry.name);
  const to = path.join(distDir, entry.name);
  if (entry.isDirectory()) {
    cpSync(from, to, { recursive: true });
  } else if (/\.(html|js|css|txt|xml|svg)$/.test(entry.name)) {
    writeFileSync(to, inject(readFileSync(from, 'utf8')));
  } else {
    cpSync(from, to);
  }
}

// 2. markdown docs -> HTML
const docPages = [];
function docPage({ title, description, md, out, canonical }) {
  const body = marked.parse(
    md
      // repo-relative markdown links -> site pages / GitHub
      .replaceAll(/\]\((?:\.\.\/)?docs\/([A-Z_]+)\.md\)/g, '](./$1.html)')
      .replaceAll(/\]\(([A-Z_]+)\.md\)/g, '](./$1.html)')
      .replaceAll(
        /\]\((?:\.\.\/)?(README|CHANGELOG|CONTRIBUTING|SECURITY|LICENSE)(\.md)?\)/g,
        `](${REPO}/blob/main/$1$2)`
      )
      .replaceAll(
        /\]\((?:\.\.\/)?(examples|src|scripts|infra)\/([^)]+)\)/g,
        `](${REPO}/blob/main/$1/$2)`
      )
      .replaceAll(
        /\]\((?:\.\.\/)?(Dockerfile|docker-compose\.yml|\.env\.example|action\.yml)\)/g,
        `](${REPO}/blob/main/$1)`
      )
  );
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Agent Browser Runtime (ABR)</title>
<meta name="description" content="${description}" />
<meta name="author" content="${AUTHOR}" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="${canonical}" />
<link rel="icon" href="../favicon.svg" type="image/svg+xml" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Agent Browser Runtime (ABR)" />
<meta property="og:title" content="${title} — ABR" />
<meta property="og:description" content="${description}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${SITE}og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="stylesheet" href="../styles.css" />
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: title,
    description,
    url: canonical,
    dateModified: today,
    isPartOf: {
      '@type': 'WebSite',
      name: 'Agent Browser Runtime (ABR)',
      url: SITE,
    },
    about: {
      '@type': 'SoftwareSourceCode',
      name: 'Agent Browser Runtime',
      codeRepository: REPO,
      version: VERSION,
    },
    author: {
      '@type': 'Person',
      name: AUTHOR,
      url: 'https://github.com/praveen-palanisamy',
    },
    license: 'https://opensource.org/licenses/MIT',
  })}</script>
</head>
<body>
<header class="wrap header">
  <a class="brand" href="../"><span class="logo" aria-hidden="true">ABR</span><span><span class="title">Agent Browser Runtime</span><span class="subtitle">v${VERSION} · docs</span></span></a>
  <nav class="nav" aria-label="Docs">
    <a href="./README.html">README</a><a href="./ARCHITECTURE.html">Architecture</a><a href="./DEPLOY.html">Deploy</a><a href="./GITHUB_ACTION.html">GitHub Action</a><a href="./AGENTS.html">For agents</a><a class="gh" href="${REPO}" rel="noopener">GitHub</a>
  </nav>
</header>
<main class="wrap doc">
${body}
</main>
<footer class="wrap footer">
  <div><strong>Agent Browser Runtime (ABR)</strong> · v${VERSION} · MIT · © <a href="https://github.com/praveen-palanisamy" rel="noopener">${AUTHOR}</a> · <a href="${REPO}" rel="noopener">Source</a> · <a href="../llms.txt">llms.txt</a></div>
</footer>
</body>
</html>
`;
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, html);
  docPages.push(canonical);
}

const docsOut = path.join(distDir, 'docs');
const docsSrc = path.join(root, 'docs');
const DOC_META = {
  ARCHITECTURE:
    'Contracts, lifecycle and verification model of Agent Browser Runtime.',
  DEPLOY:
    'Environment, providers, Docker/Cloud Run patterns and distribution channels (npm, GHCR, GitHub Action) for ABR.',
  GITHUB_ACTION: 'Run ABR session probes and browser jobs from GitHub Actions.',
  AGENTS:
    'Integration notes for coding agents and LLM tool builders using ABR.',
};
for (const f of readdirSync(docsSrc).filter((f) => f.endsWith('.md'))) {
  const name = f.replace(/\.md$/, '');
  const md = readFileSync(path.join(docsSrc, f), 'utf8');
  const title = md.match(/^#\s+(.+)$/m)?.[1] ?? name;
  docPage({
    title,
    description:
      DOC_META[name] ?? `${title} — Agent Browser Runtime documentation.`,
    md,
    out: path.join(docsOut, `${name}.html`),
    canonical: `${SITE}docs/${name}.html`,
  });
}
const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
docPage({
  title: 'README',
  description: pkg.description,
  md: readme,
  out: path.join(docsOut, 'README.html'),
  canonical: `${SITE}docs/README.html`,
});

// 3. discovery files
writeFileSync(
  path.join(distDir, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n# Source: ${REPO}\n`
);
const urls = [SITE, ...docPages];
writeFileSync(
  path.join(distDir, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (u) =>
        `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>${u === SITE ? '1.0' : '0.7'}</priority></url>`
    )
    .join('\n')}\n</urlset>\n`
);
writeFileSync(
  path.join(distDir, 'llms.txt'),
  `# Agent Browser Runtime (ABR)

> Open-source (MIT), self-hostable runtime for stateful, secure browser-session execution: capture a user's authenticated browser session once, store it encrypted in your own database, and run unattended, verified Playwright jobs as that user. Version ${VERSION}.

Author: ${AUTHOR} (https://github.com/praveen-palanisamy)
Source: ${REPO}
npm: https://www.npmjs.com/package/${pkg.name}
Container: ghcr.io/praveen-palanisamy/agent-browser-runtime
GitHub Action: uses: praveen-palanisamy/agent-browser-runtime@v0

## Docs

- [README](${SITE}docs/README.html): value proposition, quick start, contracts, runner API
- [Architecture](${SITE}docs/ARCHITECTURE.html): contracts, lifecycle, verification model
- [Deploy](${SITE}docs/DEPLOY.html): environment, providers, Docker/Cloud Run, distribution channels
- [GitHub Action](${SITE}docs/GITHUB_ACTION.html): probes and jobs from CI
- [For agents](${SITE}docs/AGENTS.html): notes for coding agents and LLM tool builders
- [Full text](${SITE}llms-full.txt): all docs concatenated

## Key facts

- Contracts: SessionStore, SessionProvider, WebPostStrategy; AgentPostResult has ok, uncertain, needsReauth, failureStage, refreshedSession.
- Providers: local Chromium, any CDP endpoint, Steel (self-hosted/cloud, live view), Kernel microVMs.
- Runner HTTP API: POST /v1/post, /v1/probe, /v1/capture/start|finish|cancel, GET /healthz; bearer token auth.
- The runtime never persists sessions; the embedding application encrypts and stores them.
- Use only with the user's explicit authorization and within each site's terms of service.
`
);
const full = [
  'README.md',
  ...readdirSync(docsSrc)
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`),
]
  .map(
    (f) =>
      `\n\n---\n\n<!-- ${REPO}/blob/main/${f} -->\n\n${readFileSync(path.join(root, f), 'utf8')}`
  )
  .join('');
writeFileSync(
  path.join(distDir, 'llms-full.txt'),
  `# Agent Browser Runtime (ABR) v${VERSION} — full documentation\nSource: ${REPO}\n${full}`
);
writeFileSync(
  path.join(distDir, 'humans.txt'),
  `/* TEAM */\nAuthor: ${AUTHOR}\nSite: https://github.com/praveen-palanisamy\n\n/* SITE */\nProject: Agent Browser Runtime (ABR) v${VERSION}\nSource: ${REPO}\nLicense: MIT\nLast update: ${today}\n`
);
writeFileSync(path.join(distDir, '.nojekyll'), '');

console.log(
  `Built site v${VERSION} → ${path.relative(root, distDir)} (${urls.length} pages)`
);
