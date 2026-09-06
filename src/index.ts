/**
 * agent-browser-runtime — stateful, secure browser-session execution for
 * agents: session contracts, orchestration (post / probe / capture),
 * pluggable browser providers (local Chromium, any CDP endpoint, Steel,
 * Kernel), and an HTTP runner service with a Playwright-free client.
 *
 * Platform behaviour is supplied by the embedding app as `WebPostStrategy`
 * implementations; this package never hard-codes a platform.
 */

export type { PlatformId } from './platform';
export * from './core/types';
export { AgentPoster, humanPacingDelay } from './core/poster';
export { SessionCaptureManager } from './core/capture';
export { InMemorySessionStore } from './core/stores';

export {
  LocalBrowserSessionProvider,
  CdpSessionProvider,
  attachOverCdp,
  buildHandle,
} from './providers/playwright';
export {
  SteelSessionProvider,
  type SteelProviderOptions,
} from './providers/steel';
export {
  KernelSessionProvider,
  type KernelProviderOptions,
} from './providers/kernel';

export * from './protocol';
export {
  AgentRunnerClient,
  AgentRunnerError,
  type AgentRunnerClientOptions,
} from './client/runner-client';
