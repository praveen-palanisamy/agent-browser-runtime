/**
 * Kernel session provider (https://www.kernel.sh — Apache-2.0 browser
 * images, managed microVM orchestration). Useful as a burst / secondary
 * provider behind the same `SessionProvider` contract: sub-second cold
 * starts, standby billing, optional stealth and persistent profiles.
 *
 * API surface used:
 *   POST   https://api.onkernel.com/browsers            -> { session_id, cdp_ws_url, browser_live_view_url }
 *   DELETE https://api.onkernel.com/browsers/{session_id}
 *
 * Session cookies are injected per job from the caller's encrypted store;
 * Kernel profiles are optional warm caches, never the source of truth.
 */

import type {
  AgentSessionHandle,
  AgentSessionState,
  SessionProvider,
} from '../core/types';
import type { PlatformId } from '../platform';
import { attachOverCdp } from './playwright';

export type KernelProviderOptions = {
  apiKey: string;
  /** Defaults to https://api.onkernel.com */
  baseUrl?: string;
  /** Reduce bot detection (Kernel stealth image). Default true. */
  stealth?: boolean;
  /** Inactivity timeout for headless jobs (seconds). Default 300. */
  jobTimeoutSeconds?: number;
  /** Inactivity timeout for interactive captures (seconds). Default 1200. */
  interactiveTimeoutSeconds?: number;
  /** Optional persistent profile name to warm-start from. */
  profileName?: string;
  fetchImpl?: typeof fetch;
};

type KernelBrowser = {
  session_id: string;
  cdp_ws_url: string;
  browser_live_view_url?: string;
};

export class KernelSessionProvider implements SessionProvider {
  readonly id = 'kernel';
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private opts: KernelProviderOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = (opts.baseUrl ?? 'https://api.onkernel.com').replace(
      /\/+$/,
      ''
    );
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.opts.apiKey}`,
    };
  }

  async createBrowser(input: {
    interactive?: boolean;
  }): Promise<KernelBrowser> {
    const res = await this.fetchImpl(`${this.baseUrl}/browsers`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        // Live view is only available for non-headless browsers.
        headless: !input.interactive,
        stealth: this.opts.stealth ?? true,
        timeout_seconds: input.interactive
          ? (this.opts.interactiveTimeoutSeconds ?? 1200)
          : (this.opts.jobTimeoutSeconds ?? 300),
        ...(this.opts.profileName
          ? { profile: { name: this.opts.profileName, save_changes: false } }
          : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Kernel browser create failed (${res.status}): ${await res.text()}`
      );
    }
    return (await res.json()) as KernelBrowser;
  }

  async deleteBrowser(sessionId: string): Promise<void> {
    await this.fetchImpl(
      `${this.baseUrl}/browsers/${encodeURIComponent(sessionId)}`,
      {
        method: 'DELETE',
        headers: this.headers(),
      }
    ).catch(() => undefined);
  }

  async acquire(input: {
    platform: PlatformId;
    state?: AgentSessionState;
    interactive?: boolean;
  }): Promise<AgentSessionHandle> {
    const browser = await this.createBrowser({
      interactive: input.interactive,
    });
    try {
      return await attachOverCdp({
        wsUrl: browser.cdp_ws_url,
        platform: input.platform,
        state: input.state,
        providerSessionId: browser.session_id,
        liveViewUrl: browser.browser_live_view_url,
        onDispose: () => this.deleteBrowser(browser.session_id),
      });
    } catch (err) {
      await this.deleteBrowser(browser.session_id);
      throw err;
    }
  }
}
