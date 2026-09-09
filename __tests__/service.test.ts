import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AgentRunnerClient,
  AgentRunnerError,
} from '../src/client/runner-client';
import { RUNNER_ROUTES } from '../src/protocol';
import { loadConfig } from '../src/service/config';
import { parseLivePath, rewriteLiveHtml } from '../src/service/live-proxy';
import type { AgentRunner } from '../src/service/runner';
import { Mutex, SerializedProvider } from '../src/service/serialized-provider';
import { createRunnerServer, isAuthorized } from '../src/service/server';

const TOKEN = 'test-token-0123456789abcdef';

function fakeRunner(): AgentRunner {
  const calls: string[] = [];
  const runner = {
    config: loadConfig({
      AGENT_RUNNER_TOKEN: TOKEN,
      AGENT_RUNNER_PUBLIC_URL: 'https://runner.example',
      PORT: '0',
    }),
    capture: { size: 0, liveViewUrlFor: () => undefined },
    async post(req: { jobId: string }) {
      calls.push(`post:${req.jobId}`);
      return { ok: true, platformPostId: '1', verification: 'toast' };
    },
    async probe() {
      return { authenticated: true };
    },
    async captureStart(req: {
      workspaceId: string;
      accountId: string;
      platform: string;
    }) {
      calls.push(`capture:${req.workspaceId}:${req.accountId}:${req.platform}`);
      return {
        captureId: 'c1',
        liveViewUrl: 'https://runner.example/live/view-token/',
        expiresAt: 'x',
      };
    },
    async captureFinish() {
      return { ok: false, error: 'nope' };
    },
    async captureCancel() {
      return { ok: true };
    },
  } as unknown as AgentRunner;
  return Object.assign(runner, { calls });
}

describe('config', () => {
  it('requires a strong token and steel url when steel is selected', () => {
    expect(() => loadConfig({})).toThrow(/AGENT_RUNNER_TOKEN/);
    expect(() =>
      loadConfig({
        AGENT_RUNNER_TOKEN: TOKEN,
        AGENT_RUNNER_JOB_PROVIDER: 'steel',
      })
    ).toThrow(/STEEL_API_URL/);
    const cfg = loadConfig({
      AGENT_RUNNER_TOKEN: TOKEN,
      STEEL_API_URL: 'http://127.0.0.1:3000/',
    });
    expect(cfg.jobProvider).toBe('local');
    expect(cfg.captureProvider).toBe('steel');
    expect(cfg.steel?.baseUrl).toBe('http://127.0.0.1:3000');
  });
});

describe('auth + live proxy helpers', () => {
  it('compares bearer tokens in constant time semantics', () => {
    expect(isAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(isAuthorized(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(isAuthorized(undefined, TOKEN)).toBe(false);
  });

  it('parses /live/{captureId}/rest', () => {
    expect(parseLivePath('/live/abc/v1/sessions/cast', '/live')).toEqual({
      captureId: 'abc',
      rest: '/v1/sessions/cast',
    });
    expect(parseLivePath('/live/abc', '/live')).toEqual({
      captureId: 'abc',
      rest: '/',
    });
    expect(parseLivePath('/v1/post', '/live')).toBeNull();
  });

  it('rewrites upstream http and ws origins to the proxy base', () => {
    const html =
      '<script>new WebSocket("ws://steel:3000/v1/sessions/cast");fetch("http://steel:3000/v1/x")</script>';
    expect(
      rewriteLiveHtml(
        html,
        'http://steel:3000',
        'https://runner.example/live/c1'
      )
    ).toBe(
      '<script>new WebSocket("wss://runner.example/live/c1/v1/sessions/cast");fetch("https://runner.example/live/c1/v1/x")</script>'
    );
  });
});

describe('SerializedProvider', () => {
  it('holds the lock until the handle is disposed', async () => {
    const order: string[] = [];
    const inner = {
      id: 'inner',
      async acquire() {
        return {
          context: {} as never,
          exportState: async () => ({ cookies: [], origins: [] }),
          dispose: async () => {
            order.push('dispose');
          },
        };
      },
    };
    const provider = new SerializedProvider(inner, new Mutex());
    const first = await provider.acquire({ platform: 'twitter' });
    let secondAcquired = false;
    const secondP = provider.acquire({ platform: 'twitter' }).then((h) => {
      secondAcquired = true;
      return h;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(secondAcquired).toBe(false);
    await first.dispose();
    const second = await secondP;
    expect(secondAcquired).toBe(true);
    await second.dispose();
    expect(order).toEqual(['dispose', 'dispose']);
  });
});

describe('runner HTTP server + client', () => {
  const runner = fakeRunner();
  const server = createRunnerServer(runner);
  let baseUrl = '';

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it('serves health without auth', async () => {
    const res = await fetch(`${baseUrl}${RUNNER_ROUTES.health}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, jobProvider: 'local' });
  });

  it('rejects unauthenticated and malformed requests', async () => {
    const client = new AgentRunnerClient({
      baseUrl,
      token: 'wrong-token-000000000',
    });
    await expect(client.probe({} as never)).rejects.toMatchObject({
      status: 401,
    });
    const ok = new AgentRunnerClient({ baseUrl, token: TOKEN });
    await expect(ok.post({ jobId: 'j' } as never)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof AgentRunnerError &&
        e.status === 400 &&
        /workspaceId/.test(e.message)
    );
    await expect(
      ok.captureStart({ platform: 'demo' } as never)
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof AgentRunnerError &&
        e.status === 400 &&
        /workspaceId/.test(e.message)
    );
  });

  it('requires and forwards the capture tenant binding', async () => {
    const client = new AgentRunnerClient({ baseUrl, token: TOKEN });
    const result = await client.captureStart({
      workspaceId: 'ws',
      accountId: 'a',
      platform: 'demo',
    });
    expect(result.liveViewUrl).toBe('https://runner.example/live/view-token/');
    expect((runner as unknown as { calls: string[] }).calls).toContain(
      'capture:ws:a:demo'
    );
  });

  it('routes an authenticated post to the runner', async () => {
    const client = new AgentRunnerClient({ baseUrl, token: TOKEN });
    const res = await client.post({
      jobId: 'ws/p#0',
      workspaceId: 'ws',
      accountId: 'a',
      platform: 'twitter',
      content: { text: 'hi' },
      session: {
        platform: 'twitter',
        storageState: { cookies: [], origins: [] },
        capturedAt: 'now',
      },
    });
    expect(res).toMatchObject({ ok: true, platformPostId: '1' });
    expect((runner as unknown as { calls: string[] }).calls).toContain(
      'post:ws/p#0'
    );
  });

  it('returns 404 for unknown live captures', async () => {
    const res = await fetch(`${baseUrl}/live/missing/`);
    expect(res.status).toBe(404);
  });
});
