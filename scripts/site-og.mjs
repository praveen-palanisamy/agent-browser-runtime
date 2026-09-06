#!/usr/bin/env node
/**
 * Render site/src/og.png (1200x630 social card) from an inline HTML template
 * with Playwright's Chromium. Run locally after visual changes and commit the
 * PNG; the Pages workflow does not need a browser.
 *
 *   node scripts/site-og.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:1200px;height:630px;background:radial-gradient(900px 500px at 15% -10%,rgba(124,92,255,.35),transparent 60%),radial-gradient(700px 400px at 100% 0%,rgba(34,211,238,.25),transparent 60%),#0b0d14;color:#e7eaf3;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Inter,sans-serif;display:flex;flex-direction:column;justify-content:space-between;padding:64px;box-sizing:border-box}
  .brand{display:flex;align-items:center;gap:18px;font-size:28px;font-weight:600}
  .logo{width:64px;height:64px;border-radius:16px;display:grid;place-items:center;font-weight:800;font-size:20px;background:linear-gradient(135deg,#7c5cff,#22d3ee);color:#0b0d14}
  h1{font-size:64px;line-height:1.08;letter-spacing:-.02em;margin:0;max-width:20ch}
  h1 em{font-style:normal;background:linear-gradient(90deg,#7c5cff,#22d3ee);-webkit-background-clip:text;color:transparent}
  p{font-size:28px;color:#9aa3b8;margin:20px 0 0;max-width:38ch}
  .foot{display:flex;justify-content:space-between;font-size:24px;color:#9aa3b8}
</style></head><body>
  <div class="brand"><div class="logo">ABR</div>Agent Browser Runtime</div>
  <div><h1>Let your agent <em>act as the user</em> — in their own logged-in browser.</h1>
  <p>Self-hosted · verified · session-safe · MIT</p></div>
  <div class="foot"><span>github.com/praveen-palanisamy/agent-browser-runtime</span><span>npm · GHCR · GitHub Action</span></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
const png = await page.screenshot({ type: 'png' });
await browser.close();
const out = path.join(root, 'site', 'src', 'og.png');
writeFileSync(out, png);
console.log(`wrote ${path.relative(root, out)} (${png.length} bytes)`);
