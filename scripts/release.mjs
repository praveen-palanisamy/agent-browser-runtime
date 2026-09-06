#!/usr/bin/env node
// Prepare a release: bump package.json, move CHANGELOG "Unreleased" into a
// dated version section. Idempotent per version (re-running with the same
// --version is a no-op). Used by .github/workflows/release.yml and locally:
//
//   node scripts/release.mjs --bump=patch|minor|major
//   node scripts/release.mjs --version=1.2.3
import { readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => a.slice(2).split('='))
);

function bump(version, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`Invalid semver: ${version}`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump: ${kind}`);
}

const pkgPath = 'package.json';
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const next = args.version ?? (args.bump ? bump(pkg.version, args.bump) : null);
if (!next) {
  console.error(
    'Usage: node scripts/release.mjs --bump=patch|minor|major | --version=X.Y.Z'
  );
  process.exit(1);
}

if (pkg.version === next) {
  console.log(`Already at ${next}`);
  process.exit(0);
}

// package.json (+ lockfile root entry) without reformatting.
for (const file of ['package.json', 'package-lock.json']) {
  const text = readFileSync(file, 'utf8');
  const updated = text.replace(
    /("name":\s*"@praveen-palanisamy\/agent-browser-runtime",\s*"version":\s*")\d+\.\d+\.\d+(")/g,
    `$1${next}$2`
  );
  writeFileSync(file, updated);
}

const changelogPath = 'CHANGELOG.md';
const changelog = readFileSync(changelogPath, 'utf8');
if (!changelog.includes('## Unreleased')) {
  throw new Error('CHANGELOG.md must contain an "## Unreleased" section');
}
const date = new Date().toISOString().slice(0, 10);
writeFileSync(
  changelogPath,
  changelog.replace(
    '## Unreleased',
    `## Unreleased\n\n- (add changes here)\n\n## v${next} — ${date}`
  )
);

console.log(`Prepared v${next}: package.json, package-lock.json, CHANGELOG.md`);
