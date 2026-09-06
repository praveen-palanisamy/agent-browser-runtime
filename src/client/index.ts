/**
 * Playwright-free entry point for orchestrators (serverless functions,
 * queue workers) that call a running agent runner over HTTP.
 */

export {
  AgentRunnerClient,
  AgentRunnerError,
  type AgentRunnerClientOptions,
} from './runner-client';
export * from '../protocol';
export type { PlatformId } from '../platform';
export type {
  AgentPostContent,
  AgentPostFailureStage,
  AgentPostResult,
  AgentPostVerification,
  AgentSessionState,
  StorageState,
} from '../core/types';
