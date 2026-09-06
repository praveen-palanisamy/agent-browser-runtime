/**
 * Interactive session capture.
 *
 * The user signs in to the platform inside a live-view browser we control
 * (Steel live view in production, a headed local Chromium in development).
 * When they are done, we probe authentication and export `storageState`.
 * Passwords never pass through the runtime; only the resulting cookies do.
 *
 * Captures are stateful (a browser stays open while the user types), so the
 * manager keeps them in memory keyed by an unguessable capture id and
 * expires them after `ttlMs`.
 */

import { randomBytes } from 'node:crypto';
import type { PlatformId } from '../platform';
import type {
  AgentSessionHandle,
  AgentSessionState,
  SessionProvider,
  WebPostStrategy,
} from './types';

export type CaptureStart = {
  captureId: string;
  /** Provider live view URL (absolute). Undefined for headless providers. */
  liveViewUrl?: string;
  expiresAt: string; // ISO
};

export type CaptureFinish =
  | { ok: true; state: AgentSessionState }
  | { ok: false; error: string; notAuthenticated?: boolean };

type ActiveCapture = {
  platform: PlatformId;
  handle: AgentSessionHandle;
  expiresAt: number;
  timer: NodeJS.Timeout;
};

export class SessionCaptureManager {
  private active = new Map<string, ActiveCapture>();
  private strategies = new Map<PlatformId, WebPostStrategy>();

  constructor(
    private provider: SessionProvider,
    private opts: { ttlMs?: number } = {}
  ) {}

  register(strategy: WebPostStrategy): this {
    this.strategies.set(strategy.platform, strategy);
    return this;
  }

  get size(): number {
    return this.active.size;
  }

  async start(input: {
    platform: PlatformId;
    userAgent?: string;
  }): Promise<CaptureStart> {
    const strategy = this.strategies.get(input.platform);
    if (!strategy) {
      throw new Error(`No agentic strategy registered for ${input.platform}`);
    }
    const handle = await this.provider.acquire({
      platform: input.platform,
      interactive: true,
      state: input.userAgent
        ? {
            platform: input.platform,
            storageState: { cookies: [], origins: [] },
            userAgent: input.userAgent,
            capturedAt: new Date().toISOString(),
          }
        : undefined,
    });
    const page = await handle.context.newPage();
    await page
      .goto(strategy.loginUrl, { waitUntil: 'domcontentloaded' })
      .catch(() => undefined);

    const captureId = randomBytes(24).toString('base64url');
    const ttl = this.opts.ttlMs ?? 20 * 60_000;
    const expiresAt = Date.now() + ttl;
    const timer = setTimeout(() => {
      this.cancel(captureId).catch(() => undefined);
    }, ttl);
    this.active.set(captureId, {
      platform: input.platform,
      handle,
      expiresAt,
      timer,
    });
    return {
      captureId,
      liveViewUrl: handle.liveViewUrl,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  /** Probe auth and export cookies; always releases the browser. */
  async finish(captureId: string): Promise<CaptureFinish> {
    const entry = this.active.get(captureId);
    if (!entry) {
      return { ok: false, error: 'Capture not found or expired' };
    }
    this.active.delete(captureId);
    clearTimeout(entry.timer);
    const strategy = this.strategies.get(entry.platform);
    try {
      if (
        !strategy ||
        !(await strategy.isAuthenticated(entry.handle.context))
      ) {
        return {
          ok: false,
          notAuthenticated: true,
          error: 'Sign-in not detected yet — finish signing in and try again',
        };
      }
      const storageState = await entry.handle.exportState();
      const authCookieExpiry = storageState.cookies
        .map((c) => c.expires)
        .filter((e) => e > 0)
        .sort((a, b) => a - b)[0];
      return {
        ok: true,
        state: {
          platform: entry.platform,
          storageState,
          capturedAt: new Date().toISOString(),
          expiresHint: authCookieExpiry
            ? new Date(authCookieExpiry * 1000).toISOString()
            : undefined,
        },
      };
    } finally {
      await entry.handle.dispose();
    }
  }

  async cancel(captureId: string): Promise<void> {
    const entry = this.active.get(captureId);
    if (!entry) {
      return;
    }
    this.active.delete(captureId);
    clearTimeout(entry.timer);
    await entry.handle.dispose();
  }

  /** Live view URL for an active capture (used by the runner's proxy). */
  liveViewUrlFor(captureId: string): string | undefined {
    return this.active.get(captureId)?.handle.liveViewUrl;
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.cancel(id)));
  }
}
