/**
 * Serializes access to a single-session provider (the OSS Steel server hosts
 * one browser session at a time). The lock is held from `acquire` until the
 * returned handle is disposed.
 */

import type { AgentSessionHandle, SessionProvider } from '../core/types';

export class Mutex {
  private locked = false;
  private waiters: Array<() => void> = [];

  async lock(): Promise<() => void> {
    if (this.locked) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.locked = true;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = this.waiters.shift();
      if (next) {
        next();
      } else {
        this.locked = false;
      }
    };
  }

  get isLocked(): boolean {
    return this.locked;
  }
}

export class SerializedProvider implements SessionProvider {
  readonly id: string;

  constructor(
    private inner: SessionProvider,
    private mutex: Mutex
  ) {
    this.id = inner.id;
  }

  async acquire(
    input: Parameters<SessionProvider['acquire']>[0]
  ): Promise<AgentSessionHandle> {
    const release = await this.mutex.lock();
    try {
      const handle = await this.inner.acquire(input);
      const dispose = handle.dispose.bind(handle);
      handle.dispose = async () => {
        try {
          await dispose();
        } finally {
          release();
        }
      };
      return handle;
    } catch (e) {
      release();
      throw e;
    }
  }
}
