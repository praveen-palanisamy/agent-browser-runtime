/**
 * Session-based agentic posting: core contracts.
 *
 * Instead of username/password automation, an *agent session* reuses a real
 * authenticated browser session (cookies + storage) that the user granted to
 * your application. Sessions are provider-agnostic: they can live in a local
 * browser (dev / self-hosted runner), or in a remote browser reachable over
 * CDP (self-hosted Steel, Kernel, Browserbase) so the user's machine never
 * needs to be online at publish time.
 */

import type { BrowserContext } from 'playwright-core';
import type { PlatformId } from '../platform';

/** Playwright `storageState`-compatible payload (cookies + origins). */
export type StorageState = {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
};

/**
 * Cookie/local-storage boundary enforced when a strategy imports or exports a
 * session. Domain values are hostnames (for example `app.example.com`); origins
 * are exact URL origins (for example `https://app.example.com`).
 */
export type SessionScope = {
  cookieDomains: string[];
  origins: string[];
  /** Defaults to true. */
  includeSubdomains?: boolean;
};

export type StrategyPolicy = {
  /** Omit only for compatibility with legacy, trusted strategies. */
  session?: SessionScope;
  /** Defaults to true. */
  allowInteractiveCapture?: boolean;
  /** Defaults to true. Set false for human-only workflows. */
  allowUnattended?: boolean;
};

export type AuditEventType =
  | 'capture.started'
  | 'capture.completed'
  | 'capture.denied'
  | 'capture.cancelled'
  | 'capture.expired'
  | 'probe.completed'
  | 'post.completed'
  | 'execution.denied';

/** Redacted lifecycle record. Session values and screenshots are never included. */
export type AgentAuditEvent = {
  type: AuditEventType;
  at: string;
  platform: PlatformId;
  workspaceId?: string;
  accountId?: string;
  jobId?: string;
  ok?: boolean;
  reason?: string;
  session?: { cookies: number; origins: number };
};

export type AuditSink = (
  event: Readonly<AgentAuditEvent>
) => void | Promise<void>;

/**
 * Serialized browser session state for one user + platform. The source of
 * truth is the embedding application's encrypted store (treat it with
 * password-equivalent sensitivity and never expose it to end-user clients).
 * Remote browser profiles are only a warm cache.
 */
export type AgentSessionState = {
  platform: PlatformId;
  storageState: StorageState;
  /** UA the session was captured with; reusing it reduces re-auth. */
  userAgent?: string;
  capturedAt: string; // ISO
  expiresHint?: string; // ISO, earliest relevant auth cookie expiry
  /** Provider-side warm profile id (e.g. Steel profileId), if any. */
  providerProfileId?: string;
};

/** A live browser context bound to a session, plus lifecycle hooks. */
export type AgentSessionHandle = {
  context: BrowserContext;
  /** Provider-specific session id (e.g. cloud session id) for debugging. */
  providerSessionId?: string;
  /** Human-viewable live view (capture flows); undefined for headless jobs. */
  liveViewUrl?: string;
  /** Export the (possibly refreshed) session state before release. */
  exportState(): Promise<StorageState>;
  /** Release the context/browser; must be called in a finally block. */
  dispose(): Promise<void>;
};

/**
 * Turns stored session state into a live browser context. Implementations:
 * - LocalBrowserSessionProvider: local Playwright Chromium (runner, dev)
 * - CdpSessionProvider: any remote browser exposing a CDP websocket
 * - SteelSessionProvider: self-hosted Steel (CDP + live view for capture)
 */
export interface SessionProvider {
  readonly id: string;
  acquire(input: {
    platform: PlatformId;
    state?: AgentSessionState;
    /** Request a live view (interactive capture). Not all providers can. */
    interactive?: boolean;
  }): Promise<AgentSessionHandle>;
}

/**
 * Persistence for session state. Production implementations should encrypt
 * at rest (e.g. AES-256-GCM); tests and the runner use an in-memory store.
 */
export interface SessionStore {
  load(key: {
    workspaceId: string;
    accountId: string;
  }): Promise<AgentSessionState | null>;
  save(
    key: { workspaceId: string; accountId: string },
    state: AgentSessionState
  ): Promise<void>;
}

/** Content handed to a platform strategy. */
export type AgentPostContent = {
  text: string;
  mediaUrls?: string[];
  link?: string;
};

export type AgentPostFailureStage =
  | 'precheck'
  | 'auth'
  | 'compose'
  | 'media'
  | 'submit'
  | 'verify';

/** How a successful post was confirmed. */
export type AgentPostVerification = 'toast' | 'timeline';

/** Result of an agentic post attempt. */
export type AgentPostResult = {
  ok: boolean;
  platformPostId?: string;
  platformPostUrl?: string;
  verification?: AgentPostVerification;
  /** Session became invalid (logged out) — user must re-link. */
  needsReauth?: boolean;
  /**
   * The submit action ran but the outcome could not be verified. Callers
   * MUST NOT retry or fall back to another delivery path, or the user may
   * end up with a duplicate post. Surface for manual review instead.
   */
  uncertain?: boolean;
  failureStage?: AgentPostFailureStage;
  error?: string;
  /** PNG screenshot captured at the failure point (never sent to clients). */
  screenshotBase64?: string;
};

/**
 * Platform posting strategy driving the real web UI through a Page.
 * One implementation per platform keeps selectors/quirks isolated.
 */
export interface WebPostStrategy {
  readonly platform: PlatformId;
  /** Sign-in page to open for interactive capture. */
  readonly loginUrl: string;
  /**
   * Execution and session boundary. New strategies should always declare a
   * session scope; omission preserves compatibility for trusted legacy callers.
   */
  readonly policy?: StrategyPolicy;
  /** Quick probe: is this context still authenticated? */
  isAuthenticated(context: BrowserContext): Promise<boolean>;
  /**
   * Validate content before any browser work (length limits, media count).
   * Returns an error string when the content can never be posted as-is.
   */
  validate(content: AgentPostContent): string | null;
  post(
    context: BrowserContext,
    content: AgentPostContent,
    opts?: {
      /** Account handle (without @) used for timeline verification. */
      accountHandle?: string;
    }
  ): Promise<AgentPostResult>;
}
