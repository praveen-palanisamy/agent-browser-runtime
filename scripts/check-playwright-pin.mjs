#!/usr/bin/env node
// Fails when the Dockerfile's Playwright base image version drifts from the
// playwright-core version resolved in package-lock.json. The base image only
// bundles browsers for its own version, so a mismatch breaks the local
// provider inside the container.
import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const locked = lock.packages['node_modules/playwright-core']?.version;
const dockerfile = readFileSync('Dockerfile', 'utf8');
const pinned = /ARG PLAYWRIGHT_VERSION=([\d.]+)/.exec(dockerfile)?.[1];

if (!locked || !pinned) {
  console.error('Could not determine playwright-core versions');
  process.exit(1);
}
if (locked !== pinned) {
  console.error(
    `Dockerfile PLAYWRIGHT_VERSION=${pinned} but package-lock resolves playwright-core@${locked}.\n` +
      `Update the ARG (and confirm mcr.microsoft.com/playwright:v${locked}-noble exists).`
  );
  process.exit(1);
}
console.log(`playwright pin ok (${locked})`);
