#!/usr/bin/env node
/**
 * agent-browser-runtime CLI
 *
 *   agent-browser-runtime serve --strategies ./dist/strategies.js
 *   agent-browser-runtime health [--url http://localhost:8080]
 *   agent-browser-runtime probe --url ... --token ... --platform twitter --session ./session.json
 *
 * `serve` loads a CommonJS/ESM module whose default export (or `strategies`
 * export) is an array of WebPostStrategy instances, then starts the runner
 * using environment configuration (see service/config.ts).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentRunnerClient } from './client/runner-client';
import type { AgentSessionState, WebPostStrategy } from './core/types';
import { startRunner } from './service';

type Flags = Record<string, string | boolean>;

function parse(argv: string[]): { cmd: string; flags: Flags } {
  const [cmd = 'help', ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { cmd, flags };
}

// tsc (CommonJS output) would rewrite a literal `import()` into `require()`,
// which cannot load ESM modules. Keep a real dynamic import for those.
const dynamicImport = new Function('u', 'return import(u)') as (
  u: string
) => Promise<Record<string, unknown>>;

async function loadStrategies(spec: string): Promise<WebPostStrategy[]> {
  const abs = path.resolve(process.cwd(), spec);
  let mod: Record<string, unknown>;
  try {
    mod = require(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ERR_REQUIRE_ESM') throw err;
    mod = await dynamicImport(pathToFileURL(abs).href);
  }
  const value = Array.isArray(mod) ? mod : (mod.default ?? mod.strategies);
  const list = typeof value === 'function' ? await value() : value;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(
      `${spec} must export a non-empty WebPostStrategy[] (default or "strategies")`
    );
  }
  return list as WebPostStrategy[];
}

function usage(): void {
  console.log(`agent-browser-runtime

Commands
  serve   --strategies <module>          start the runner HTTP service (env-configured)
  health  [--url <runner>] [--token <t>] check a running runner
  probe   --url <runner> --token <t> --platform <id> --session <file.json> [--workspace ws] [--account acct]

Environment (serve): AGENT_RUNNER_TOKEN, AGENT_RUNNER_PUBLIC_URL, PORT,
  AGENT_RUNNER_JOB_PROVIDER, AGENT_RUNNER_CAPTURE_PROVIDER (local|steel|kernel),
  STEEL_API_URL, STEEL_API_KEY, KERNEL_API_KEY, AGENT_RUNNER_CAPTURE_TTL_MS, AGENT_RUNNER_PACING`);
}

async function main(): Promise<void> {
  const { cmd, flags } = parse(process.argv.slice(2));
  const str = (k: string, fallback?: string) =>
    typeof flags[k] === 'string' ? (flags[k] as string) : fallback;

  if (cmd === 'serve') {
    const spec = str('strategies');
    if (!spec) throw new Error('--strategies <module> is required');
    startRunner({ strategies: await loadStrategies(spec) });
    return;
  }

  const baseUrl = str(
    'url',
    process.env.AGENT_RUNNER_URL || 'http://localhost:8080'
  )!;
  const token = str('token', process.env.AGENT_RUNNER_TOKEN || '')!;
  const client = new AgentRunnerClient({ baseUrl, token });

  if (cmd === 'health') {
    console.log(JSON.stringify(await client.health(), null, 2));
    return;
  }
  if (cmd === 'probe') {
    const file = str('session');
    const platform = str('platform');
    if (!file || !platform)
      throw new Error('--platform and --session are required');
    const session = JSON.parse(readFileSync(file, 'utf8')) as AgentSessionState;
    const res = await client.probe({
      workspaceId: str('workspace', 'cli')!,
      accountId: str('account', 'cli')!,
      platform,
      session,
    });
    console.log(
      JSON.stringify(
        {
          ...res,
          refreshedSession: res.refreshedSession ? '<omitted>' : undefined,
        },
        null,
        2
      )
    );
    return;
  }
  usage();
  if (cmd !== 'help') process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
