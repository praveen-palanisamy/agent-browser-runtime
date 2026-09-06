/**
 * Steel session provider (self-hosted `steel-browser`, Apache-2.0, or Steel
 * Cloud). Steel exposes a REST session API plus a CDP websocket and a
 * human-viewable live view, which is exactly what interactive session
 * capture needs: the user signs in inside the live view, we export the
 * resulting cookies and never see a password.
 *
 * The embedding application keeps the encrypted session as the source of
 * truth; Steel profiles are treated as a disposable warm cache.
 *
 * API surface used (stable across OSS + Cloud):
 *   POST {baseUrl}/v1/sessions                -> { id, websocketUrl, debugUrl, sessionViewerUrl }
 *   POST {baseUrl}/v1/sessions/{id}/release
 */

import type {
  AgentSessionHandle,
  AgentSessionState,
  SessionProvider,
} from '../core/types';
import type { PlatformId } from '../platform';
import { attachOverCdp } from './playwright';

export type SteelProviderOptions = {
  /** e.g. http://localhost:3000 (self-hosted) or https://api.steel.dev */
  baseUrl: string;
  /** Steel Cloud API key; unused for self-hosted. */
  apiKey?: string;
  /** Session timeout in ms (Steel default 5 minutes; capture needs longer). */
  sessionTimeoutMs?: number;
  interactiveTimeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type SteelSessionResponse = {
  id: string;
  websocketUrl?: string;
  debugUrl?: string;
  sessionViewerUrl?: string;
};

export class SteelSessionProvider implements SessionProvider {
  readonly id = 'steel';
  private readonly fetchImpl: typeof fetch;

  constructor(private opts: SteelProviderOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.opts.apiKey ? { 'steel-api-key': this.opts.apiKey } : {}),
    };
  }

  async createSession(input: {
    userAgent?: string;
    interactive?: boolean;
  }): Promise<{ id: string; wsUrl: string; liveViewUrl?: string }> {
    const timeout = input.interactive
      ? (this.opts.interactiveTimeoutMs ?? 20 * 60_000)
      : (this.opts.sessionTimeoutMs ?? 5 * 60_000);
    const res = await this.fetchImpl(`${this.opts.baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        timeout,
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Steel session create failed (${res.status}): ${await res.text()}`
      );
    }
    const data = (await res.json()) as SteelSessionResponse;
    const wsUrl =
      data.websocketUrl ||
      `${this.opts.baseUrl.replace(/^http/, 'ws')}/v1/sessions/${data.id}/cdp`;
    return {
      id: data.id,
      wsUrl,
      liveViewUrl: data.debugUrl || data.sessionViewerUrl,
    };
  }

  async releaseSession(id: string): Promise<void> {
    await this.fetchImpl(`${this.opts.baseUrl}/v1/sessions/${id}/release`, {
      method: 'POST',
      headers: this.headers(),
    }).catch(() => undefined);
  }

  async acquire(input: {
    platform: PlatformId;
    state?: AgentSessionState;
    interactive?: boolean;
  }): Promise<AgentSessionHandle> {
    const session = await this.createSession({
      userAgent: input.state?.userAgent,
      interactive: input.interactive,
    });
    return attachOverCdp({
      wsUrl: session.wsUrl,
      platform: input.platform,
      state: input.state,
      providerSessionId: session.id,
      liveViewUrl: session.liveViewUrl,
      onDispose: () => this.releaseSession(session.id),
    });
  }
}
