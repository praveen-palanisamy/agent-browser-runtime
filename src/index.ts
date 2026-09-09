/**
 * agent-browser-runtime — stateful, secure browser-session execution for
 * agents: session contracts, orchestration (post / probe / capture),
 * pluggable browser providers (local Chromium, any CDP endpoint, Steel,
 * Kernel), and an HTTP runner service with a Playwright-free client.
 *
 * Platform behaviour is supplied by the embedding app as `WebPostStrategy`
 * implementations; this package never hard-codes a platform.
 */

export {
  AgentRunnerClient,
  type AgentRunnerClientOptions,
  AgentRunnerError,
} from './client/runner-client';
export { SessionCaptureManager } from './core/capture';
export { AgentPoster, humanPacingDelay } from './core/poster';
export {
  assertStrategyMode,
  sanitizeSessionState,
  sanitizeStorageState,
  validateSessionScope,
} from './core/session-policy';
export { InMemorySessionStore } from './core/stores';
export * from './core/types';
export type { PlatformId } from './platform';
export * from './protocol';
export {
  type KernelProviderOptions,
  KernelSessionProvider,
} from './providers/kernel';
export {
  attachOverCdp,
  buildHandle,
  CdpSessionProvider,
  LocalBrowserSessionProvider,
} from './providers/playwright';
export {
  type SteelProviderOptions,
  SteelSessionProvider,
} from './providers/steel';
