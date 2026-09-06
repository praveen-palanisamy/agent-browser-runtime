/**
 * Agent runner: wires providers, the caller's strategies, poster and capture
 * manager according to config, and exposes typed handlers for the HTTP layer.
 *
 * Headless jobs run on the job provider (local Chromium by default: every
 * job gets a fresh isolated context with the user's cookies injected, so
 * jobs are parallel and stateless). Interactive captures run on the capture
 * provider (Steel by default, for its live view). The OSS Steel server hosts
 * one browser session at a time, so Steel access is serialized. Kernel can
 * back either role for burst scale.
 */

import { SessionCaptureManager } from '../core/capture';
import { AgentPoster } from '../core/poster';
import { InMemorySessionStore } from '../core/stores';
import type { SessionProvider, WebPostStrategy } from '../core/types';
import type {
  RunnerCaptureFinishRequest,
  RunnerCaptureFinishResponse,
  RunnerCaptureStartRequest,
  RunnerCaptureStartResponse,
  RunnerPostRequest,
  RunnerPostResponse,
  RunnerProbeRequest,
  RunnerProbeResponse,
} from '../protocol';
import { RUNNER_ROUTES } from '../protocol';
import { KernelSessionProvider } from '../providers/kernel';
import { LocalBrowserSessionProvider } from '../providers/playwright';
import { SteelSessionProvider } from '../providers/steel';
import type { ProviderKind, RunnerConfig } from './config';
import { Mutex, SerializedProvider } from './serialized-provider';

export type ProviderFactory = (kind: ProviderKind) => SessionProvider;

export function defaultProviderFactory(config: RunnerConfig): ProviderFactory {
  const steelMutex = new Mutex();
  return (kind) => {
    if (kind === 'steel') {
      if (!config.steel) {
        throw new Error('Steel provider selected without STEEL_API_URL');
      }
      return new SerializedProvider(
        new SteelSessionProvider({
          baseUrl: config.steel.baseUrl,
          apiKey: config.steel.apiKey,
          interactiveTimeoutMs: config.captureTtlMs,
        }),
        steelMutex
      );
    }
    if (kind === 'kernel') {
      if (!config.kernel) {
        throw new Error('Kernel provider selected without KERNEL_API_KEY');
      }
      return new KernelSessionProvider({
        apiKey: config.kernel.apiKey,
        baseUrl: config.kernel.baseUrl,
        interactiveTimeoutSeconds: Math.ceil(config.captureTtlMs / 1000),
      });
    }
    return new LocalBrowserSessionProvider({ headless: true });
  };
}

export class AgentRunner {
  readonly jobProvider: SessionProvider;
  readonly captureProvider: SessionProvider;
  readonly capture: SessionCaptureManager;
  private readonly strategies: WebPostStrategy[];

  constructor(
    readonly config: RunnerConfig,
    strategies: WebPostStrategy[],
    providerFactory: ProviderFactory = defaultProviderFactory(config)
  ) {
    if (strategies.length === 0) {
      throw new Error('AgentRunner requires at least one WebPostStrategy');
    }
    this.strategies = strategies;
    this.jobProvider = providerFactory(config.jobProvider);
    this.captureProvider =
      config.captureProvider === config.jobProvider
        ? this.jobProvider
        : providerFactory(config.captureProvider);
    this.capture = new SessionCaptureManager(this.captureProvider, {
      ttlMs: config.captureTtlMs,
    });
    for (const s of strategies) {
      this.capture.register(s);
    }
  }

  private poster(store: InMemorySessionStore): AgentPoster {
    const poster = new AgentPoster(this.jobProvider, store, {
      pacing: this.config.pacing,
    });
    for (const s of this.strategies) {
      poster.register(s);
    }
    return poster;
  }

  async post(req: RunnerPostRequest): Promise<RunnerPostResponse> {
    const started = Date.now();
    const key = { workspaceId: req.workspaceId, accountId: req.accountId };
    const store = new InMemorySessionStore([[key, req.session]]);
    const result = await this.poster(store).post({
      ...key,
      platform: req.platform,
      content: req.content,
      accountHandle: req.accountHandle,
    });
    const refreshed = store.peek(key);
    return {
      ...result,
      refreshedSession:
        refreshed && refreshed !== req.session ? refreshed : undefined,
      runner: {
        provider: this.jobProvider.id,
        durationMs: Date.now() - started,
      },
    };
  }

  async probe(req: RunnerProbeRequest): Promise<RunnerProbeResponse> {
    const key = { workspaceId: req.workspaceId, accountId: req.accountId };
    const store = new InMemorySessionStore([[key, req.session]]);
    const result = await this.poster(store).probe({
      ...key,
      platform: req.platform,
    });
    const refreshed = store.peek(key);
    return {
      ...result,
      refreshedSession:
        refreshed && refreshed !== req.session ? refreshed : undefined,
    };
  }

  async captureStart(
    req: RunnerCaptureStartRequest
  ): Promise<RunnerCaptureStartResponse> {
    const started = await this.capture.start({
      platform: req.platform,
      userAgent: req.userAgent,
    });
    return {
      captureId: started.captureId,
      liveViewUrl: `${this.config.publicUrl}${RUNNER_ROUTES.live}/${started.captureId}/`,
      expiresAt: started.expiresAt,
    };
  }

  captureFinish(
    req: RunnerCaptureFinishRequest
  ): Promise<RunnerCaptureFinishResponse> {
    return this.capture.finish(req.captureId);
  }

  async captureCancel(req: RunnerCaptureFinishRequest): Promise<{ ok: true }> {
    await this.capture.cancel(req.captureId);
    return { ok: true };
  }

  async shutdown(): Promise<void> {
    await this.capture.disposeAll();
  }
}
