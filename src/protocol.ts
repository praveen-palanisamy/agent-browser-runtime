/**
 * Wire protocol between an orchestrator (serverless function, queue worker,
 * cron job) and the agent runner service. Pure types — safe to import from
 * code that must not pull in Playwright.
 *
 * The orchestrator owns session persistence: every request carries the
 * decrypted session state and every response may carry a refreshed one,
 * which the orchestrator re-encrypts into its own store. The runner keeps
 * nothing between requests except in-flight interactive captures.
 */

import type {
  AgentPostContent,
  AgentPostFailureStage,
  AgentPostVerification,
  AgentSessionState,
} from './core/types';
import type { PlatformId } from './platform';

export const RUNNER_ROUTES = {
  health: '/healthz',
  post: '/v1/post',
  probe: '/v1/probe',
  captureStart: '/v1/capture/start',
  captureFinish: '/v1/capture/finish',
  captureCancel: '/v1/capture/cancel',
  /** `${live}/{captureId}/...` proxies the provider live view. */
  live: '/live',
} as const;

export type RunnerPostRequest = {
  /** Idempotency / trace id, e.g. `${workspaceId}/${postId}#${targetIndex}`. */
  jobId: string;
  workspaceId: string;
  accountId: string;
  platform: PlatformId;
  accountHandle?: string;
  content: AgentPostContent;
  session: AgentSessionState;
};

export type RunnerPostResponse = {
  ok: boolean;
  platformPostId?: string;
  platformPostUrl?: string;
  verification?: AgentPostVerification;
  needsReauth?: boolean;
  uncertain?: boolean;
  failureStage?: AgentPostFailureStage;
  error?: string;
  screenshotBase64?: string;
  refreshedSession?: AgentSessionState;
  runner?: { provider: string; durationMs: number };
};

export type RunnerProbeRequest = {
  workspaceId: string;
  accountId: string;
  platform: PlatformId;
  session: AgentSessionState;
};

export type RunnerProbeResponse = {
  authenticated: boolean;
  error?: string;
  refreshedSession?: AgentSessionState;
};

export type RunnerCaptureStartRequest = {
  workspaceId: string;
  accountId: string;
  platform: PlatformId;
  userAgent?: string;
};

export type RunnerCaptureStartResponse = {
  captureId: string;
  /** Absolute URL the embedding app can load in an iframe. */
  liveViewUrl: string;
  expiresAt: string;
};

export type RunnerCaptureFinishRequest = {
  captureId: string;
  workspaceId: string;
  accountId: string;
};

export type RunnerCaptureFinishResponse =
  | { ok: true; state: AgentSessionState }
  | { ok: false; error: string; notAuthenticated?: boolean };

export type RunnerErrorResponse = { error: string };
