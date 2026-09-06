#!/usr/bin/env node
/**
 * agent-browser-runtime (ABR) CLI
 *
 *   agent-browser-runtime serve  --strategies ./dist/strategies.js
 *   agent-browser-runtime health [--url http://localhost:8080]
 *   agent-browser-runtime probe  --platform <id> --session ./session.json [--url … --token … | --local --strategies …]
 *   agent-browser-runtime post   --platform <id> --session ./session.json --text "…" [--media url,…] [--link url]
 *                                [--url … --token … | --local --strategies …] [--session-out file] [--out file]
 *
 * `serve` loads a CommonJS/ESM module whose default export (or `strategies`
 * export) is an array of WebPostStrategy instances, then starts the runner
 * using environment configuration (see service/config.ts).
 *
 * `probe` / `post` talk to a running runner by default. With `--local` they
 * run in-process against local Chromium instead (used by the GitHub Action
 * and for one-off jobs), which requires `--strategies`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT, packageVersion } from './attribution';
import { AgentRunnerClient } from './client/runner-client';
import { AgentPoster } from './core/poster';
import { InMemorySessionStore } from './core/stores';
import type {
  AgentPostContent,
  AgentPostResult,
  AgentSessionState,
  WebPostStrategy,
} from './core/types';
import { LocalBrowserSessionProvider } from './providers/playwright';
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

export async function loadStrategies(spec: string): Promise<WebPostStrategy[]> {
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
  console.log(`${PROJECT.name} v${packageVersion()} — ${PROJECT.repository}

Commands
  serve   --strategies <module>            start the runner HTTP service (env-configured)
  health  [--url <runner>] [--token <t>]   check a running runner
  probe   --platform <id> --session <file> is the stored session still authenticated?
  post    --platform <id> --session <file> --text <t> [--media a,b] [--link url]
                                           run one job with the stored session

Target (probe/post)
  --url <runner> --token <t>               call a running runner (default; env AGENT_RUNNER_URL/_TOKEN)
  --local --strategies <module>            run in-process with local Chromium instead
  --session-out <file>                     write the refreshed session state here
  --out <file>                             write the JSON result here (also printed)
  --workspace <id> --account <id>          job identity (default: cli)

Environment (serve): AGENT_RUNNER_TOKEN, AGENT_RUNNER_PUBLIC_URL, PORT,
  AGENT_RUNNER_JOB_PROVIDER, AGENT_RUNNER_CAPTURE_PROVIDER (local|steel|kernel),
  STEEL_API_URL, STEEL_API_KEY, KERNEL_API_KEY, AGENT_RUNNER_CAPTURE_TTL_MS, AGENT_RUNNER_PACING`);
}

type JobFlags = {
  platform: string;
  session: AgentSessionState;
  workspaceId: string;
  accountId: string;
  sessionOut?: string;
  out?: string;
};

function readJob(str: (k: string, f?: string) => string | undefined): JobFlags {
  const file = str('session');
  const platform = str('platform');
  if (!file || !platform) {
    throw new Error('--platform and --session are required');
  }
  return {
    platform,
    session: JSON.parse(readFileSync(file, 'utf8')) as AgentSessionState,
    workspaceId: str('workspace', 'cli') as string,
    accountId: str('account', 'cli') as string,
    sessionOut: str('session-out'),
    out: str('out'),
  };
}

function readContent(
  str: (k: string, f?: string) => string | undefined
): AgentPostContent {
  const file = str('content');
  if (file) {
    return JSON.parse(readFileSync(file, 'utf8')) as AgentPostContent;
  }
  const text = str('text');
  if (!text) throw new Error('--text (or --content <file.json>) is required');
  const media = str('media');
  return {
    text,
    mediaUrls: media ? media.split(',').filter(Boolean) : undefined,
    link: str('link'),
  };
}

function emit(
  job: JobFlags,
  result: Record<string, unknown> & { refreshedSession?: AgentSessionState }
): void {
  const { refreshedSession, ...rest } = result;
  if (refreshedSession && job.sessionOut) {
    writeFileSync(job.sessionOut, JSON.stringify(refreshedSession), 'utf8');
  }
  const printable = {
    ...rest,
    refreshedSession: refreshedSession
      ? job.sessionOut
        ? `<written to ${job.sessionOut}>`
        : '<omitted>'
      : undefined,
  };
  const text = JSON.stringify(printable, null, 2);
  if (job.out) writeFileSync(job.out, text, 'utf8');
  console.log(text);
}

async function localPoster(
  job: JobFlags,
  strategiesSpec: string | undefined,
  pacing: boolean
): Promise<{ poster: AgentPoster; store: InMemorySessionStore }> {
  if (!strategiesSpec) {
    throw new Error('--local requires --strategies <module>');
  }
  const key = { workspaceId: job.workspaceId, accountId: job.accountId };
  const store = new InMemorySessionStore([[key, job.session]]);
  const poster = new AgentPoster(new LocalBrowserSessionProvider(), store, {
    pacing,
  });
  for (const s of await loadStrategies(strategiesSpec)) poster.register(s);
  return { poster, store };
}

function refreshedFrom(
  store: InMemorySessionStore,
  job: JobFlags
): AgentSessionState | undefined {
  const key = { workspaceId: job.workspaceId, accountId: job.accountId };
  const state = store.peek(key);
  return state && state !== job.session ? state : undefined;
}

async function main(): Promise<void> {
  const { cmd, flags } = parse(process.argv.slice(2));
  const str = (k: string, fallback?: string) =>
    typeof flags[k] === 'string' ? (flags[k] as string) : fallback;

  if (cmd === 'version' || flags.version === true) {
    console.log(packageVersion());
    return;
  }

  if (cmd === 'serve') {
    const spec = str('strategies');
    if (!spec) throw new Error('--strategies <module> is required');
    startRunner({ strategies: await loadStrategies(spec) });
    return;
  }

  if (cmd !== 'health' && cmd !== 'probe' && cmd !== 'post') {
    usage();
    if (cmd !== 'help') process.exitCode = 1;
    return;
  }

  const local = flags.local === true;
  const pacing = process.env.AGENT_RUNNER_PACING !== 'false';

  if (cmd === 'health') {
    const client = new AgentRunnerClient({
      baseUrl: str(
        'url',
        process.env.AGENT_RUNNER_URL || 'http://localhost:8080'
      ) as string,
      token: str('token', process.env.AGENT_RUNNER_TOKEN || '') as string,
    });
    console.log(JSON.stringify(await client.health(), null, 2));
    return;
  }

  const job = readJob(str);
  const ident = {
    workspaceId: job.workspaceId,
    accountId: job.accountId,
    platform: job.platform,
  };

  if (local) {
    const { poster, store } = await localPoster(job, str('strategies'), pacing);
    if (cmd === 'probe') {
      const res = await poster.probe(ident);
      emit(job, { ...res, refreshedSession: refreshedFrom(store, job) });
      if (!res.authenticated) process.exitCode = 2;
      return;
    }
    const res: AgentPostResult = await poster.post({
      ...ident,
      content: readContent(str),
    });
    emit(job, { ...res, refreshedSession: refreshedFrom(store, job) });
    if (!res.ok) process.exitCode = res.uncertain ? 3 : 2;
    return;
  }

  const client = new AgentRunnerClient({
    baseUrl: str(
      'url',
      process.env.AGENT_RUNNER_URL || 'http://localhost:8080'
    ) as string,
    token: str('token', process.env.AGENT_RUNNER_TOKEN || '') as string,
  });
  if (cmd === 'probe') {
    const res = await client.probe({ ...ident, session: job.session });
    emit(job, res);
    if (!res.authenticated) process.exitCode = 2;
    return;
  }
  const res = await client.post({
    ...ident,
    jobId: str('job-id', `cli-${Date.now()}`) as string,
    session: job.session,
    content: readContent(str),
  });
  emit(job, res);
  if (!res.ok) process.exitCode = res.uncertain ? 3 : 2;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
