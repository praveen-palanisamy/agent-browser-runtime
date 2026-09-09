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
import {
  assertStrategyMode,
  sanitizeStorageState,
  validateSessionScope,
} from './session-policy';
import type {
  AgentAuditEvent,
  AgentSessionHandle,
  AgentSessionState,
  AuditSink,
  SessionProvider,
  WebPostStrategy,
} from './types';

export type CaptureStart = {
  captureId: string;
  /** Distinct credential used only by the live-view proxy. */
  liveViewToken: string;
  /** Provider live view URL (absolute). Undefined for headless providers. */
  liveViewUrl?: string;
  expiresAt: string; // ISO
};

export type CaptureFinish =
  | { ok: true; state: AgentSessionState }
  | { ok: false; error: string; notAuthenticated?: boolean };

type ActiveCapture = {
  platform: PlatformId;
  workspaceId: string;
  accountId: string;
  liveViewToken: string;
  handle: AgentSessionHandle;
  expiresAt: number;
  timer: NodeJS.Timeout;
};

export class SessionCaptureManager {
  private active = new Map<string, ActiveCapture>();
  private liveViewTokens = new Map<string, string>();
  private strategies = new Map<PlatformId, WebPostStrategy>();

  constructor(
    private provider: SessionProvider,
    private opts: { ttlMs?: number; audit?: AuditSink } = {}
  ) {}

  register(strategy: WebPostStrategy): this {
    if (strategy.policy?.session) {
      validateSessionScope(strategy.policy.session);
    }
    this.strategies.set(strategy.platform, strategy);
    return this;
  }

  get size(): number {
    return this.active.size;
  }

  async start(input: {
    platform: PlatformId;
    workspaceId: string;
    accountId: string;
    userAgent?: string;
  }): Promise<CaptureStart> {
    const strategy = this.strategies.get(input.platform);
    if (!strategy) {
      throw new Error(`No agentic strategy registered for ${input.platform}`);
    }
    try {
      assertStrategyMode(strategy, 'interactive');
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Interactive capture denied';
      await this.emitAudit({
        type: 'capture.denied',
        at: new Date().toISOString(),
        platform: input.platform,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        reason,
      });
      throw error;
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
    const liveViewToken = randomBytes(24).toString('base64url');
    const ttl = this.opts.ttlMs ?? 20 * 60_000;
    const expiresAt = Date.now() + ttl;
    const timer = setTimeout(() => {
      this.expire(captureId).catch(() => undefined);
    }, ttl);
    this.active.set(captureId, {
      platform: input.platform,
      workspaceId: input.workspaceId,
      accountId: input.accountId,
      liveViewToken,
      handle,
      expiresAt,
      timer,
    });
    this.liveViewTokens.set(liveViewToken, captureId);
    await this.emitAudit({
      type: 'capture.started',
      at: new Date().toISOString(),
      platform: input.platform,
      workspaceId: input.workspaceId,
      accountId: input.accountId,
    });
    return {
      captureId,
      liveViewToken,
      liveViewUrl: handle.liveViewUrl,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  /** Probe auth and export cookies; always releases the browser. */
  async finish(input: {
    captureId: string;
    workspaceId: string;
    accountId: string;
  }): Promise<CaptureFinish> {
    const entry = this.boundEntry(input);
    if (!entry) {
      return { ok: false, error: 'Capture not found or expired' };
    }
    const strategy = this.strategies.get(entry.platform);
    if (!strategy || !(await strategy.isAuthenticated(entry.handle.context))) {
      await this.emitAudit({
        type: 'capture.completed',
        at: new Date().toISOString(),
        platform: entry.platform,
        workspaceId: entry.workspaceId,
        accountId: entry.accountId,
        ok: false,
        reason: 'not_authenticated',
      });
      return {
        ok: false,
        notAuthenticated: true,
        error: 'Sign-in not detected yet — finish signing in and try again',
      };
    }
    this.remove(input.captureId, entry);
    clearTimeout(entry.timer);
    try {
      const exported = await entry.handle.exportState();
      const storageState = strategy.policy?.session
        ? sanitizeStorageState(exported, strategy.policy.session)
        : exported;
      const authCookieExpiry = storageState.cookies
        .map((c) => c.expires)
        .filter((e) => e > 0)
        .sort((a, b) => a - b)[0];
      const result: CaptureFinish = {
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
      await this.emitAudit({
        type: 'capture.completed',
        at: new Date().toISOString(),
        platform: entry.platform,
        workspaceId: entry.workspaceId,
        accountId: entry.accountId,
        ok: true,
        session: {
          cookies: storageState.cookies.length,
          origins: storageState.origins.length,
        },
      });
      return result;
    } finally {
      await entry.handle.dispose();
    }
  }

  async cancel(input: {
    captureId: string;
    workspaceId: string;
    accountId: string;
  }): Promise<void> {
    const entry = this.boundEntry(input);
    if (!entry) {
      return;
    }
    this.remove(input.captureId, entry);
    clearTimeout(entry.timer);
    await entry.handle.dispose();
    await this.emitAudit({
      type: 'capture.cancelled',
      at: new Date().toISOString(),
      platform: entry.platform,
      workspaceId: entry.workspaceId,
      accountId: entry.accountId,
    });
  }

  /** Live view URL for an active capture (used by the runner's proxy). */
  liveViewUrlFor(liveViewToken: string): string | undefined {
    const captureId = this.liveViewTokens.get(liveViewToken);
    return captureId
      ? this.active.get(captureId)?.handle.liveViewUrl
      : undefined;
  }

  async disposeAll(): Promise<void> {
    await Promise.all(
      [...this.active.entries()].map(([captureId, entry]) =>
        this.cancel({
          captureId,
          workspaceId: entry.workspaceId,
          accountId: entry.accountId,
        })
      )
    );
  }

  private boundEntry(input: {
    captureId: string;
    workspaceId: string;
    accountId: string;
  }): ActiveCapture | undefined {
    const entry = this.active.get(input.captureId);
    return entry?.workspaceId === input.workspaceId &&
      entry.accountId === input.accountId
      ? entry
      : undefined;
  }

  private remove(captureId: string, entry: ActiveCapture): void {
    this.active.delete(captureId);
    this.liveViewTokens.delete(entry.liveViewToken);
  }

  private async expire(captureId: string): Promise<void> {
    const entry = this.active.get(captureId);
    if (!entry) {
      return;
    }
    this.remove(captureId, entry);
    clearTimeout(entry.timer);
    await entry.handle.dispose();
    await this.emitAudit({
      type: 'capture.expired',
      at: new Date().toISOString(),
      platform: entry.platform,
      workspaceId: entry.workspaceId,
      accountId: entry.accountId,
    });
  }

  private async emitAudit(event: AgentAuditEvent): Promise<void> {
    await Promise.resolve(this.opts.audit?.(event)).catch(() => undefined);
  }
}
