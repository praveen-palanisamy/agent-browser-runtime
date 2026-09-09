/**
 * Real-Chromium smoke test for the local provider and session round-trip.
 * Skipped automatically when Playwright's Chromium is not installed
 * (`npm run browsers:install`). CI runs it in a dedicated job.
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { AgentPoster } from '../../src/core/poster';
import { InMemorySessionStore } from '../../src/core/stores';
import type { WebPostStrategy } from '../../src/core/types';
import { LocalBrowserSessionProvider } from '../../src/providers/playwright';

function chromiumAvailable(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const PAGE = `<!doctype html><html><body>
<h1 id="who">anonymous</h1>
<script>
  if (document.cookie.includes('sid=')) document.getElementById('who').textContent = 'signed-in';
  if (localStorage.getItem('draft')) document.getElementById('who').dataset.draft = localStorage.getItem('draft');
</script>
</body></html>`;

/** Strategy that reads cookie-derived state from a routed fixture page. */
const fixtureStrategy: WebPostStrategy = {
  platform: 'fixture',
  loginUrl: 'https://fixture.test/login',
  policy: {
    session: {
      cookieDomains: ['fixture.test'],
      origins: ['https://fixture.test'],
    },
  },
  validate: (c) => (c.text ? null : 'empty'),
  async isAuthenticated(context) {
    await context.route('https://fixture.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: PAGE })
    );
    const page = await context.newPage();
    try {
      await page.goto('https://fixture.test/home');
      return (await page.textContent('#who')) === 'signed-in';
    } finally {
      await page.close();
    }
  },
  async post(context, content) {
    const page = await context.newPage();
    try {
      await page.goto('https://fixture.test/compose');
      await page.evaluate(
        (t) => localStorage.setItem('draft', t),
        content.text
      );
      return { ok: true, platformPostId: 'fixture-1', verification: 'toast' };
    } finally {
      await page.close();
    }
  },
};

describe.skipIf(!chromiumAvailable())(
  'LocalBrowserSessionProvider (Chromium)',
  () => {
    it('injects cookies, runs a strategy and exports rotated storage state', async () => {
      const key = { workspaceId: 'ws', accountId: 'fx' };
      const store = new InMemorySessionStore([
        [
          key,
          {
            platform: 'fixture',
            capturedAt: new Date().toISOString(),
            storageState: {
              cookies: [
                {
                  name: 'sid',
                  value: 'abc',
                  domain: 'fixture.test',
                  path: '/',
                  expires: -1,
                  httpOnly: false,
                  secure: true,
                  sameSite: 'Lax',
                },
                {
                  name: 'unrelated',
                  value: 'must-not-enter-browser',
                  domain: 'unrelated.test',
                  path: '/',
                  expires: -1,
                  httpOnly: false,
                  secure: true,
                  sameSite: 'Lax',
                },
              ],
              origins: [],
            },
          },
        ],
      ]);
      const poster = new AgentPoster(
        new LocalBrowserSessionProvider({ headless: true }),
        store,
        {
          pacing: false,
        }
      ).register(fixtureStrategy);

      const result = await poster.post({
        ...key,
        platform: 'fixture',
        content: { text: 'hello from chromium' },
      });
      expect(result).toMatchObject({ ok: true, platformPostId: 'fixture-1' });

      const refreshed = store.peek(key);
      expect(
        refreshed?.storageState.cookies.find((c) => c.name === 'sid')?.value
      ).toBe('abc');
      expect(
        refreshed?.storageState.cookies.some((c) => c.name === 'unrelated')
      ).toBe(false);
      const origin = refreshed?.storageState.origins.find(
        (o) => o.origin === 'https://fixture.test'
      );
      expect(origin?.localStorage).toContainEqual({
        name: 'draft',
        value: 'hello from chromium',
      });
    }, 60_000);

    it('reports needsReauth when the session carries no valid cookies', async () => {
      const key = { workspaceId: 'ws', accountId: 'anon' };
      const store = new InMemorySessionStore([
        [
          key,
          {
            platform: 'fixture',
            capturedAt: new Date().toISOString(),
            storageState: { cookies: [], origins: [] },
          },
        ],
      ]);
      const poster = new AgentPoster(
        new LocalBrowserSessionProvider({ headless: true }),
        store,
        {
          pacing: false,
        }
      ).register(fixtureStrategy);
      const result = await poster.post({
        ...key,
        platform: 'fixture',
        content: { text: 'x' },
      });
      expect(result.ok).toBe(false);
      expect(result.needsReauth).toBe(true);
    }, 60_000);
  }
);
