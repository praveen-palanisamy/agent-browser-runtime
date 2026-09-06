/**
 * Project identity. Surfaced in the CLI banner, the runner's `Server` header
 * and `/healthz` so deployments (and forks) always point back to the source.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const PROJECT = {
  name: 'agent-browser-runtime',
  shortName: 'ABR',
  npm: '@praveen-palanisamy/agent-browser-runtime',
  author: 'Praveen Palanisamy',
  repository: 'https://github.com/praveen-palanisamy/agent-browser-runtime',
  homepage: 'https://praveen-palanisamy.github.io/agent-browser-runtime/',
  image: 'ghcr.io/praveen-palanisamy/agent-browser-runtime',
  license: 'MIT',
} as const;

let cachedVersion: string | undefined;

/** Version from the installed package.json (works from src/ and dist/). */
export function packageVersion(): string {
  if (cachedVersion) return cachedVersion;
  for (const rel of ['../package.json', '../../package.json']) {
    try {
      const raw = readFileSync(path.join(__dirname, rel), 'utf8');
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name === PROJECT.npm && parsed.version) {
        cachedVersion = parsed.version;
        return cachedVersion;
      }
    } catch {
      // try next candidate
    }
  }
  cachedVersion = '0.0.0';
  return cachedVersion;
}

/** e.g. `agent-browser-runtime/0.1.0 (+https://github.com/...)` */
export function userAgentString(): string {
  return `${PROJECT.name}/${packageVersion()} (+${PROJECT.repository})`;
}
