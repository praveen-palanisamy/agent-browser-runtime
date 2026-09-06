/**
 * Session providers: turn stored session state into live browser contexts.
 *
 * All providers speak Playwright's BrowserContext, so strategies and the
 * AgentPoster are identical whether the browser runs on this machine or in
 * a remote sandbox. Swapping providers is a config change, not a code
 * change. See `steel-provider.ts` for the self-hosted Steel implementation.
 */

import { type Browser, type BrowserContext, chromium } from 'playwright-core';
import type {
  AgentSessionHandle,
  AgentSessionState,
  SessionProvider,
  StorageState,
} from '../core/types';
import type { PlatformId } from '../platform';

export const DEFAULT_VIEWPORT = { width: 1280, height: 900 };

export async function buildHandle(
  browser: Browser,
  context: BrowserContext,
  extra: {
    providerSessionId?: string;
    liveViewUrl?: string;
    onDispose?: () => Promise<void>;
  } = {}
): Promise<AgentSessionHandle> {
  return {
    context,
    providerSessionId: extra.providerSessionId,
    liveViewUrl: extra.liveViewUrl,
    async exportState() {
      const state = await context.storageState();
      return state as StorageState;
    },
    async dispose() {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      await extra.onDispose?.().catch(() => undefined);
    },
  };
}

export function contextOptions(input: {
  platform: PlatformId;
  state?: AgentSessionState;
}) {
  return {
    storageState: input.state?.storageState,
    userAgent: input.state?.userAgent,
    viewport: DEFAULT_VIEWPORT,
  };
}

/**
 * Runs a Chromium instance on the current machine. Used by the runner
 * service for headless jobs (each job gets a fresh, isolated context with
 * the stored cookies injected) and for headed local capture in development.
 */
export class LocalBrowserSessionProvider implements SessionProvider {
  readonly id = 'local';

  constructor(private opts: { headless?: boolean } = {}) {}

  async acquire(input: {
    platform: PlatformId;
    state?: AgentSessionState;
    interactive?: boolean;
  }): Promise<AgentSessionHandle> {
    const browser = await chromium.launch({
      headless: input.interactive ? false : (this.opts.headless ?? true),
    });
    const context = await browser.newContext(contextOptions(input));
    return buildHandle(browser, context);
  }
}

/**
 * Attach a stored session to a remote browser reached over CDP. Remote
 * browsers ship with a default context; we inject state into a fresh
 * context when the provider allows it, otherwise reuse the default one.
 */
export async function attachOverCdp(input: {
  wsUrl: string;
  platform: PlatformId;
  state?: AgentSessionState;
  providerSessionId?: string;
  liveViewUrl?: string;
  onDispose?: () => Promise<void>;
}): Promise<AgentSessionHandle> {
  const browser = await chromium.connectOverCDP(input.wsUrl);
  let context: BrowserContext;
  try {
    context = await browser.newContext(contextOptions(input));
  } catch {
    context = browser.contexts()[0];
    if (!context) {
      throw new Error('Remote browser exposed no context');
    }
    if (input.state?.storageState?.cookies?.length) {
      await context.addCookies(input.state.storageState.cookies);
    }
  }
  return buildHandle(browser, context, {
    providerSessionId: input.providerSessionId,
    liveViewUrl: input.liveViewUrl,
    onDispose: input.onDispose,
  });
}

/**
 * Connects to any remote browser that exposes a CDP websocket endpoint.
 * The `createEndpoint` callback encapsulates the provider's session API
 * (Steel, Kernel, Browserbase, a self-hosted Chrome fleet, ...).
 */
export class CdpSessionProvider implements SessionProvider {
  readonly id: string;

  constructor(
    private opts: {
      id?: string;
      createEndpoint: (input: {
        platform: PlatformId;
        interactive?: boolean;
      }) => Promise<{
        wsUrl: string;
        sessionId?: string;
        liveViewUrl?: string;
        release?: () => Promise<void>;
      }>;
    }
  ) {
    this.id = opts.id || 'cdp';
  }

  async acquire(input: {
    platform: PlatformId;
    state?: AgentSessionState;
    interactive?: boolean;
  }): Promise<AgentSessionHandle> {
    const ep = await this.opts.createEndpoint({
      platform: input.platform,
      interactive: input.interactive,
    });
    return attachOverCdp({
      wsUrl: ep.wsUrl,
      platform: input.platform,
      state: input.state,
      providerSessionId: ep.sessionId,
      liveViewUrl: ep.liveViewUrl,
      onDispose: ep.release,
    });
  }
}
