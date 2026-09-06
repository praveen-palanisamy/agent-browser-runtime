/**
 * Playwright-free entry point for orchestrators (serverless functions,
 * queue workers) that call a running agent runner over HTTP.
 */

export type {
  AgentPostContent,
  AgentPostFailureStage,
  AgentPostResult,
  AgentPostVerification,
  AgentSessionState,
  StorageState,
} from '../core/types';
export type { PlatformId } from '../platform';
export * from '../protocol';
export {
  AgentRunnerClient,
  type AgentRunnerClientOptions,
  AgentRunnerError,
} from './runner-client';
