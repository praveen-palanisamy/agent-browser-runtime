/**
 * AgentPoster: orchestrates one agentic publish or session probe.
 *
 * load session -> acquire browser (local or remote) -> verify auth ->
 * post via the platform's web strategy -> persist refreshed session state.
 *
 * Platform- and infrastructure-agnostic: add a platform by registering a
 * WebPostStrategy; move to a different browser sandbox by passing a
 * different SessionProvider.
 */

import type { PlatformId } from '../platform';
import {
  assertStrategyMode,
  sanitizeSessionState,
  sanitizeStorageState,
  validateSessionScope,
} from './session-policy';
import type {
  AgentAuditEvent,
  AgentPostContent,
  AgentPostResult,
  AgentSessionState,
  AuditSink,
  SessionProvider,
  SessionStore,
  WebPostStrategy,
} from './types';

export type AgentProbeResult = {
  authenticated: boolean;
  error?: string;
};

/** Small random pause so unattended posts do not fire at machine cadence. */
export async function humanPacingDelay(
  minMs = 1500,
  maxMs = 6000,
  random: () => number = Math.random
): Promise<void> {
  const ms = Math.floor(minMs + random() * (maxMs - minMs));
  await new Promise((r) => setTimeout(r, ms));
}

export class AgentPoster {
  private strategies = new Map<PlatformId, WebPostStrategy>();

  constructor(
    private provider: SessionProvider,
    private store: SessionStore,
    private opts: { pacing?: boolean; audit?: AuditSink } = {}
  ) {}

  register(strategy: WebPostStrategy): this {
    if (strategy.policy?.session) {
      validateSessionScope(strategy.policy.session);
    }
    this.strategies.set(strategy.platform, strategy);
    return this;
  }

  supports(platform: PlatformId): boolean {
    return this.strategies.has(platform);
  }

  strategyFor(platform: PlatformId): WebPostStrategy | undefined {
    return this.strategies.get(platform);
  }

  /** Cheap authentication probe; refreshes rotated cookies when healthy. */
  async probe(input: {
    workspaceId: string;
    accountId: string;
    platform: PlatformId;
  }): Promise<AgentProbeResult> {
    const strategy = this.strategies.get(input.platform);
    if (!strategy) {
      return {
        authenticated: false,
        error: `No agentic strategy registered for ${input.platform}`,
      };
    }
    try {
      assertStrategyMode(strategy, 'unattended');
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Unattended execution denied';
      await this.emitAudit({
        type: 'execution.denied',
        at: new Date().toISOString(),
        platform: input.platform,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        reason,
      });
      return { authenticated: false, error: reason };
    }
    const key = { workspaceId: input.workspaceId, accountId: input.accountId };
    const loaded = await this.store.load(key);
    if (!loaded) {
      return { authenticated: false, error: 'No agent session captured' };
    }
    if (loaded.platform !== input.platform) {
      return {
        authenticated: false,
        error: 'Agent session belongs to a different platform',
      };
    }
    const state = sanitizeSessionState(loaded, strategy);
    const handle = await this.provider.acquire({
      platform: input.platform,
      state,
    });
    try {
      const authenticated = await strategy.isAuthenticated(handle.context);
      if (authenticated) {
        await this.persistRefreshed(
          key,
          state,
          await handle.exportState(),
          strategy
        );
      }
      await this.emitAudit({
        type: 'probe.completed',
        at: new Date().toISOString(),
        platform: input.platform,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        ok: authenticated,
      });
      return { authenticated };
    } finally {
      await handle.dispose();
    }
  }

  async post(input: {
    workspaceId: string;
    accountId: string;
    platform: PlatformId;
    content: AgentPostContent;
    accountHandle?: string;
    jobId?: string;
  }): Promise<AgentPostResult> {
    const strategy = this.strategies.get(input.platform);
    if (!strategy) {
      return {
        ok: false,
        failureStage: 'precheck',
        error: `No agentic strategy registered for ${input.platform}`,
      };
    }
    try {
      assertStrategyMode(strategy, 'unattended');
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Unattended execution denied';
      await this.emitAudit({
        type: 'execution.denied',
        at: new Date().toISOString(),
        platform: input.platform,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        jobId: input.jobId,
        reason,
      });
      return { ok: false, failureStage: 'precheck', error: reason };
    }
    const invalid = strategy.validate(input.content);
    if (invalid) {
      return { ok: false, failureStage: 'precheck', error: invalid };
    }

    const key = { workspaceId: input.workspaceId, accountId: input.accountId };
    const loaded = await this.store.load(key);
    if (!loaded) {
      return {
        ok: false,
        needsReauth: true,
        failureStage: 'auth',
        error: 'No agent session captured — link the account session first',
      };
    }
    if (loaded.platform !== input.platform) {
      return {
        ok: false,
        needsReauth: true,
        failureStage: 'auth',
        error: 'Agent session belongs to a different platform',
      };
    }
    const state = sanitizeSessionState(loaded, strategy);

    const handle = await this.provider.acquire({
      platform: input.platform,
      state,
    });
    try {
      if (!(await strategy.isAuthenticated(handle.context))) {
        return {
          ok: false,
          needsReauth: true,
          failureStage: 'auth',
          error: 'Session expired — re-link the account session',
        };
      }

      if (this.opts.pacing !== false) {
        await humanPacingDelay();
      }

      const result = await strategy.post(handle.context, input.content, {
        accountHandle: input.accountHandle,
      });

      // Persist rotated cookies so long-lived sessions keep working. Also
      // done for uncertain results: the session itself is still valid.
      if (result.ok || result.uncertain) {
        await this.persistRefreshed(
          key,
          state,
          await handle.exportState(),
          strategy
        );
      }
      await this.emitAudit({
        type: 'post.completed',
        at: new Date().toISOString(),
        platform: input.platform,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        jobId: input.jobId,
        ok: result.ok,
      });
      return result;
    } finally {
      await handle.dispose();
    }
  }

  private async persistRefreshed(
    key: { workspaceId: string; accountId: string },
    previous: AgentSessionState,
    storageState: AgentSessionState['storageState'],
    strategy: WebPostStrategy
  ): Promise<void> {
    const scopedStorage = strategy.policy?.session
      ? sanitizeStorageState(storageState, strategy.policy.session)
      : storageState;
    const refreshed: AgentSessionState = {
      ...previous,
      storageState: scopedStorage,
      capturedAt: new Date().toISOString(),
    };
    await this.store.save(key, refreshed).catch(() => undefined);
  }

  private async emitAudit(event: AgentAuditEvent): Promise<void> {
    await Promise.resolve(this.opts.audit?.(event)).catch(() => undefined);
  }
}
