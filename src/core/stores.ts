/**
 * Session stores with no external dependencies. The runner service uses
 * `InMemorySessionStore` per request: the orchestrator hands it the decrypted
 * state, the poster reads/writes it, and the refreshed state is returned to
 * the orchestrator, which re-encrypts and persists it (the orchestrator's
 * store stays the source of truth).
 */

import type { AgentSessionState, SessionStore } from './types';

export class InMemorySessionStore implements SessionStore {
  private map = new Map<string, AgentSessionState>();

  static keyOf(key: { workspaceId: string; accountId: string }): string {
    return `${key.workspaceId}/${key.accountId}`;
  }

  constructor(
    seed?: Array<
      [{ workspaceId: string; accountId: string }, AgentSessionState]
    >
  ) {
    for (const [key, state] of seed ?? []) {
      this.map.set(InMemorySessionStore.keyOf(key), state);
    }
  }

  async load(key: { workspaceId: string; accountId: string }) {
    return this.map.get(InMemorySessionStore.keyOf(key)) ?? null;
  }

  async save(
    key: { workspaceId: string; accountId: string },
    state: AgentSessionState
  ) {
    this.map.set(InMemorySessionStore.keyOf(key), state);
  }

  peek(key: {
    workspaceId: string;
    accountId: string;
  }): AgentSessionState | null {
    return this.map.get(InMemorySessionStore.keyOf(key)) ?? null;
  }
}
