import { describe, expect, it } from 'vitest';
import { AgentPoster } from '../src/core/poster';
import { InMemorySessionStore } from '../src/core/stores';
import type {
  AgentPostResult,
  AgentSessionHandle,
  AgentSessionState,
  SessionProvider,
  WebPostStrategy,
} from '../src/core/types';

const key = { workspaceId: 'ws', accountId: 'twitter-1' };

function state(cookieValue = 'v1'): AgentSessionState {
  return {
    platform: 'twitter',
    storageState: {
      cookies: [
        {
          name: 'auth_token',
          value: cookieValue,
          domain: '.x.com',
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

function fakeProvider(exported = state('rotated').storageState) {
  const disposed: boolean[] = [];
  const provider: SessionProvider = {
    id: 'fake',
    async acquire() {
      const handle: AgentSessionHandle = {
        context: {} as never,
        async exportState() {
          return exported;
        },
        async dispose() {
          disposed.push(true);
        },
      };
      return handle;
    },
  };
  return { provider, disposed };
}

function fakeStrategy(input: {
  authenticated: boolean;
  result?: AgentPostResult;
  validate?: string | null;
}): WebPostStrategy {
  return {
    platform: 'twitter',
    loginUrl: 'https://x.com/i/flow/login',
    validate: () => input.validate ?? null,
    isAuthenticated: async () => input.authenticated,
    post: async () => input.result ?? { ok: true, platformPostId: '1' },
  };
}

describe('AgentPoster', () => {
  it('fails precheck without touching the browser', async () => {
    const { provider, disposed } = fakeProvider();
    const store = new InMemorySessionStore([[key, state()]]);
    const poster = new AgentPoster(provider, store, { pacing: false }).register(
      fakeStrategy({ authenticated: true, validate: 'too long' })
    );
    const res = await poster.post({
      ...key,
      platform: 'twitter',
      content: { text: 'x' },
    });
    expect(res).toMatchObject({
      ok: false,
      failureStage: 'precheck',
      error: 'too long',
    });
    expect(disposed).toHaveLength(0);
  });

  it('reports needsReauth when no session is stored', async () => {
    const { provider } = fakeProvider();
    const poster = new AgentPoster(provider, new InMemorySessionStore(), {
      pacing: false,
    }).register(fakeStrategy({ authenticated: true }));
    const res = await poster.post({
      ...key,
      platform: 'twitter',
      content: { text: 'x' },
    });
    expect(res.needsReauth).toBe(true);
    expect(res.failureStage).toBe('auth');
  });

  it('reports needsReauth and disposes when the auth probe fails', async () => {
    const { provider, disposed } = fakeProvider();
    const store = new InMemorySessionStore([[key, state()]]);
    const poster = new AgentPoster(provider, store, { pacing: false }).register(
      fakeStrategy({ authenticated: false })
    );
    const res = await poster.post({
      ...key,
      platform: 'twitter',
      content: { text: 'x' },
    });
    expect(res.needsReauth).toBe(true);
    expect(disposed).toEqual([true]);
    // Session is not rewritten on failure.
    expect(store.peek(key)?.storageState.cookies[0].value).toBe('v1');
  });

  it('persists rotated cookies after a verified post', async () => {
    const { provider } = fakeProvider();
    const store = new InMemorySessionStore([[key, state()]]);
    const poster = new AgentPoster(provider, store, { pacing: false }).register(
      fakeStrategy({
        authenticated: true,
        result: { ok: true, platformPostId: '99', verification: 'toast' },
      })
    );
    const res = await poster.post({
      ...key,
      platform: 'twitter',
      content: { text: 'x' },
    });
    expect(res.ok).toBe(true);
    expect(store.peek(key)?.storageState.cookies[0].value).toBe('rotated');
  });

  it('persists cookies but keeps uncertain results uncertain', async () => {
    const { provider } = fakeProvider();
    const store = new InMemorySessionStore([[key, state()]]);
    const poster = new AgentPoster(provider, store, { pacing: false }).register(
      fakeStrategy({
        authenticated: true,
        result: { ok: false, uncertain: true, failureStage: 'verify' },
      })
    );
    const res = await poster.post({
      ...key,
      platform: 'twitter',
      content: { text: 'x' },
    });
    expect(res).toMatchObject({ ok: false, uncertain: true });
    expect(store.peek(key)?.storageState.cookies[0].value).toBe('rotated');
  });

  it('probe refreshes the session when authenticated', async () => {
    const { provider } = fakeProvider();
    const store = new InMemorySessionStore([[key, state()]]);
    const poster = new AgentPoster(provider, store).register(
      fakeStrategy({ authenticated: true })
    );
    expect(await poster.probe({ ...key, platform: 'twitter' })).toEqual({
      authenticated: true,
    });
    expect(store.peek(key)?.storageState.cookies[0].value).toBe('rotated');
  });
});
