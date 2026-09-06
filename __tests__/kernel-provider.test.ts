import { describe, expect, it, vi } from 'vitest';
import { KernelSessionProvider } from '../src/providers/kernel';

function fakeFetch(response: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(status === 204 ? null : JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('KernelSessionProvider', () => {
  it('creates a headless stealth browser for jobs and a headful one for captures', async () => {
    const { fn, calls } = fakeFetch({
      session_id: 'k1',
      cdp_ws_url: 'wss://proxy/browser/cdp?jwt=x',
      browser_live_view_url: 'https://proxy/browser/live?jwt=x',
    });
    const provider = new KernelSessionProvider({
      apiKey: 'key',
      fetchImpl: fn,
    });

    const job = await provider.createBrowser({ interactive: false });
    expect(job.session_id).toBe('k1');
    expect(calls[0].url).toBe('https://api.onkernel.com/browsers');
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization
    ).toBe('Bearer key');
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      headless: true,
      stealth: true,
      timeout_seconds: 300,
    });

    await provider.createBrowser({ interactive: true });
    expect(JSON.parse(calls[1].init.body as string)).toMatchObject({
      headless: false,
      timeout_seconds: 1200,
    });
  });

  it('surfaces API errors and deletes browsers by id', async () => {
    const bad = fakeFetch({ message: 'quota' }, 429);
    const provider = new KernelSessionProvider({
      apiKey: 'key',
      fetchImpl: bad.fn,
    });
    await expect(provider.createBrowser({})).rejects.toThrow(/429/);

    const ok = fakeFetch(null, 204);
    const p2 = new KernelSessionProvider({
      apiKey: 'key',
      baseUrl: 'https://kernel.internal/',
      fetchImpl: ok.fn,
    });
    await p2.deleteBrowser('abc/def');
    expect(ok.calls[0].url).toBe('https://kernel.internal/browsers/abc%2Fdef');
    expect(ok.calls[0].init.method).toBe('DELETE');
  });
});
