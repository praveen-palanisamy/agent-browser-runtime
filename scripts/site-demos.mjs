#!/usr/bin/env node
/**
 * Regenerate the product-tour demo assets with AutoDemo
 * (https://github.com/praveen-palanisamy/autodemo).
 *
 *   npm run site:demos            # uses `npx @praveen-palanisamy/autodemo`
 *   AUTODEMO_BIN="bun run ../autodemo/bin/autodemo.ts" npm run site:demos
 *
 * Builds site/dist, serves it on a local port, runs configs/site-demo.autodemo.yaml
 * and writes site/src/demos/<scenario>/latest (video.mp4, steps, walkthrough).
 * Heavy intermediates are pruned so only publishable assets are committed.
 * Requires Chromium (npx playwright-core install chromium) and ffmpeg.
 */
import { spawn } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 4174);
const baseUrl = `http://127.0.0.1:${port}`;
const autodemo = (
  process.env.AUTODEMO_BIN ?? 'npx -y @praveen-palanisamy/autodemo'
).split(' ');

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
    p.on('error', reject);
    p.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} ${args.join(' ')} → ${code}`))
    );
  });

const waitFor = async (url, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout waiting for ${url}`);
};

await run('node', ['scripts/site-build.mjs']);
const server = spawn('npx', ['-y', 'serve', '-l', String(port), 'site/dist'], {
  cwd: root,
  stdio: 'ignore',
});
try {
  await waitFor(`${baseUrl}/`, 30_000);
  await run(autodemo[0], [
    ...autodemo.slice(1),
    'run',
    '--all',
    '--config',
    'configs/site-demo.autodemo.yaml',
    '--url',
    baseUrl,
    '--headless',
    '--no-tui',
  ]);
} finally {
  server.kill();
}

// Step screenshots are full-page PNGs (~1 MB each). Re-encode them as WebP
// (1280px wide) with ffmpeg and point run.json / index.html at the new files
// so the walkthrough stays intact while the repo stays small.
const toWebp = async (dir) => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.png'));
  for (const f of files) {
    const out = path.join(dir, f.replace(/\.png$/, '.webp'));
    await run('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      path.join(dir, f),
      '-vf',
      'scale=1280:-1',
      '-q:v',
      '75',
      out,
    ]);
    rmSync(path.join(dir, f));
  }
  return files.length;
};

// prune debug/heavy intermediates from the committed assets
const demos = path.join(root, 'site', 'src', 'demos');
const PRUNE = new Set([
  'trace.zip',
  'frames.ffconcat',
  'frames',
  'video-raw',
  'video.webm',
]);
if (existsSync(demos)) {
  for (const scenario of readdirSync(demos)) {
    const latest = path.join(demos, scenario, 'latest');
    if (!existsSync(latest)) continue;
    for (const f of readdirSync(latest)) {
      if (PRUNE.has(f) || f.endsWith('.webm'))
        rmSync(path.join(latest, f), { recursive: true, force: true });
    }
    const steps = path.join(latest, 'steps');
    if (existsSync(steps) && (await toWebp(steps)) > 0) {
      for (const f of ['run.json', 'index.html']) {
        const fp = path.join(latest, f);
        if (existsSync(fp))
          writeFileSync(
            fp,
            readFileSync(fp, 'utf8').replaceAll(
              /steps\/(\d+)\.png/g,
              'steps/$1.webp'
            )
          );
      }
    }
  }
}
console.log('demo assets updated under site/src/demos');
