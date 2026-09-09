import { describe, expect, it } from 'vitest';
import { AgentRunnerClient } from '../src/client/runner-client';
import type {
  AgentSessionHandle,
  AgentSessionState,
  SessionProvider,
  WebPostStrategy,
} from '../src/core/types';
import type { RunnerConfig } from '../src/service/config';
import { AgentRunner } from '../src/service/runner';
import { createRunnerServer } from '../src/service/server';

const TOKEN = 'runner-test-token-0123456789';

function session(cookie = 'v1'): AgentSessionState {
  return {
    platform: 'demo',
    storageState: {
      cookies: [
        {
          name: 'sid',
          value: cookie,
          domain: 'demo.test',
          path: '/',
          expires: 1e12,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    },
    capturedAt: '2026-01-01T00:00:00.000Z',
  };
}

function config(patch: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    port: 0,
    token: TOKEN,
    publicUrl: 'https://runner.test',
    jobProvider: 'local',
    captureProvider: 'local',
    captureTtlMs: 60_000,
    pacing: false,
    ...patch,
  };
}

/** Provider that never launches a browser; records acquire/dispose calls. */
function fakeProvider(
  opts: { exportedCookie?: string; liveViewUrl?: string } = {}
) {
  const calls: Array<{ interactive?: boolean; hadState: boolean }> = [];
  let disposed = 0;
  const provider: SessionProvider = {
    id: 'fake',
    async acquire(input) {
      calls.push({ interactive: input.interactive, hadState: !!input.state });
      const handle: AgentSessionHandle = {
        // Minimal stand-in for a Playwright BrowserContext.
        context: {
          newPage: async () => ({
            goto: async () => null,
            close: async () => undefined,
          }),
        } as never,
        liveViewUrl: opts.liveViewUrl,
        async exportState() {
          return session(opts.exportedCookie ?? 'v1').storageState;
        },
        async dispose() {
          disposed++;
        },
      };
      return handle;
    },
  };
  return { provider, calls, disposed: () => disposed };
}

function demoStrategy(authenticated = true): WebPostStrategy {
  return {
    platform: 'demo',
    loginUrl: 'https://demo.test/login',
    policy: {
      session: {
        cookieDomains: ['demo.test'],
        origins: ['https://demo.test'],
      },
    },
    validate: (c) => (c.text ? null : 'empty'),
    isAuthenticated: async () => authenticated,
    post: async (_ctx, content) => ({
      ok: true,
      platformPostId: `post:${content.text}`,
      verification: 'toast',
    }),
  };
}

async function listen(runner: AgentRunner) {
  const server = createRunnerServer(runner);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe('AgentRunner end-to-end (fake provider, no browser)', () => {
  it('rejects construction without strategies', () => {
    expect(
      () => new AgentRunner(config(), [], () => fakeProvider().provider)
    ).toThrow(/at least one/);
  });

  it('posts, returns the refreshed session, disposes the browser', async () => {
    const rotated = fakeProvider({ exportedCookie: 'v2' });
    const runner = new AgentRunner(
      config(),
      [demoStrategy()],
      () => rotated.provider
    );
    const res = await runner.post({
      workspaceId: 'ws',
      accountId: 'a1',
      platform: 'demo',
      jobId: 'job-1',
      session: session(),
      content: { text: 'hello' },
    });
    expect(res.ok).toBe(true);
    expect(res.platformPostId).toBe('post:hello');
    expect(res.refreshedSession?.storageState.cookies[0].value).toBe('v2');
    expect(res.runner?.provider).toBe('fake');
    expect(rotated.calls[0]).toEqual({
      interactive: undefined,
      hadState: true,
    });
    expect(rotated.disposed()).toBe(1);

    const same = fakeProvider({ exportedCookie: 'v1' });
    const runner2 = new AgentRunner(
      config(),
      [demoStrategy()],
      () => same.provider
    );
    const res2 = await runner2.post({
      workspaceId: 'ws',
      accountId: 'a1',
      platform: 'demo',
      jobId: 'job-2',
      session: session('v1'),
      content: { text: 'again' },
    });
    expect(res2.ok).toBe(true);
    // Even without cookie rotation the session is refreshed (lastUsedAt) so
    // orchestrators can persist activity metadata.
    expect(res2.refreshedSession?.storageState.cookies[0].value).toBe('v1');
  });

  it('probe reports expired sessions as needsReauth', async () => {
    const { provider } = fakeProvider();
    const runner = new AgentRunner(
      config(),
      [demoStrategy(false)],
      () => provider
    );
    const res = await runner.probe({
      workspaceId: 'ws',
      accountId: 'a1',
      platform: 'demo',
      session: session(),
    });
    expect(res.authenticated).toBe(false);
  });

  it('runs a capture through start → finish and returns the exported session', async () => {
    const cap = fakeProvider({
      liveViewUrl: 'http://steel:3000/v1/sessions/debug',
    });
    const runner = new AgentRunner(
      config(),
      [demoStrategy(true)],
      () => cap.provider
    );
    const binding = { workspaceId: 'ws', accountId: 'a1' };
    const started = await runner.captureStart({
      platform: 'demo',
      ...binding,
    });
    expect(started.liveViewUrl).toMatch(
      /^https:\/\/runner\.test\/live\/[^/]+\/$/
    );
    expect(started.liveViewUrl).not.toContain(started.captureId);
    const liveViewToken = new URL(started.liveViewUrl).pathname.split('/')[2];
    expect(runner.capture.liveViewUrlFor(liveViewToken)).toBe(
      'http://steel:3000/v1/sessions/debug'
    );
    expect(runner.capture.liveViewUrlFor(started.captureId)).toBeUndefined();
    expect(cap.calls[0].interactive).toBe(true);

    const wrongOwner = await runner.captureFinish({
      captureId: started.captureId,
      workspaceId: 'other',
      accountId: 'a1',
    });
    expect(wrongOwner.ok).toBe(false);

    const finished = await runner.captureFinish({
      captureId: started.captureId,
      ...binding,
    });
    expect(finished.ok).toBe(true);
    if (finished.ok) {
      expect(finished.state.platform).toBe('demo');
      expect(finished.state.storageState.cookies).toHaveLength(1);
    }
    expect(cap.disposed()).toBe(1);
    await runner.shutdown();
  });

  it('keeps an unauthenticated capture open for the user to finish login', async () => {
    const cap = fakeProvider({
      liveViewUrl: 'http://steel:3000/v1/sessions/debug',
    });
    const runner = new AgentRunner(
      config(),
      [demoStrategy(false)],
      () => cap.provider
    );
    const binding = { workspaceId: 'ws', accountId: 'a1' };
    const started = await runner.captureStart({
      platform: 'demo',
      ...binding,
    });
    const result = await runner.captureFinish({
      captureId: started.captureId,
      ...binding,
    });
    expect(result).toMatchObject({ ok: false, notAuthenticated: true });
    expect(runner.capture.size).toBe(1);
    expect(cap.disposed()).toBe(0);
    await runner.shutdown();
    expect(cap.disposed()).toBe(1);
  });

  it('emits redacted lifecycle audit events', async () => {
    const events: Array<Record<string, unknown>> = [];
    const { provider } = fakeProvider({ exportedCookie: 'v2' });
    const runner = new AgentRunner(
      config(),
      [demoStrategy()],
      () => provider,
      (event) => events.push(event)
    );
    await runner.post({
      workspaceId: 'ws',
      accountId: 'a1',
      platform: 'demo',
      jobId: 'job-audit',
      session: session(),
      content: { text: 'audited' },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'post.completed',
        workspaceId: 'ws',
        accountId: 'a1',
        jobId: 'job-audit',
        ok: true,
      })
    );
    expect(JSON.stringify(events)).not.toContain('"value"');
    expect(JSON.stringify(events)).not.toContain('v2');
  });

  it('serves the full protocol over HTTP for the client', async () => {
    const { provider } = fakeProvider({ exportedCookie: 'v3' });
    const runner = new AgentRunner(config(), [demoStrategy()], () => provider);
    const { server, baseUrl } = await listen(runner);
    try {
      const client = new AgentRunnerClient({ baseUrl, token: TOKEN });
      expect(await client.health()).toBe(true);

      const post = await client.post({
        workspaceId: 'ws',
        accountId: 'a1',
        platform: 'demo',
        jobId: 'job-3',
        session: session(),
        content: { text: 'over http' },
      });
      expect(post.ok).toBe(true);
      expect(post.refreshedSession?.storageState.cookies[0].value).toBe('v3');

      const bad = new AgentRunnerClient({
        baseUrl,
        token: 'wrong-token-wrong-token',
      });
      await expect(
        bad.probe({
          workspaceId: 'ws',
          accountId: 'a1',
          platform: 'demo',
          session: session(),
        })
      ).rejects.toMatchObject({ name: 'AgentRunnerError', status: 401 });

      const unsupported = await client.post({
        workspaceId: 'ws',
        accountId: 'a1',
        platform: 'unknown',
        jobId: 'job-4',
        session: session(),
        content: { text: 'x' },
      });
      expect(unsupported.ok).toBe(false);
      expect(unsupported.failureStage).toBe('precheck');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      await runner.shutdown();
    }
  });
});
