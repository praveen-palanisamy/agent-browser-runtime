/**
 * HTTP client for the agent runner service, for orchestrators such as
 * serverless functions or queue workers.
 *
 * Deliberately free of Playwright imports so it can be bundled anywhere.
 * Auth is a shared bearer token (`AGENT_RUNNER_TOKEN`) kept in a secret
 * manager on both sides.
 */

import {
  RUNNER_ROUTES,
  type RunnerCaptureFinishRequest,
  type RunnerCaptureFinishResponse,
  type RunnerCaptureStartRequest,
  type RunnerCaptureStartResponse,
  type RunnerPostRequest,
  type RunnerPostResponse,
  type RunnerProbeRequest,
  type RunnerProbeResponse,
} from '../protocol';

export type AgentRunnerClientOptions = {
  baseUrl: string;
  token: string;
  /** Per-request timeout; posting with media can take a while. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class AgentRunnerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly transient: boolean
  ) {
    super(message);
    this.name = 'AgentRunnerError';
  }
}

export class AgentRunnerClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private opts: AgentRunnerClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
  }

  static isConfigured(env: {
    AGENT_RUNNER_URL?: string;
    AGENT_RUNNER_TOKEN?: string;
  }): boolean {
    return Boolean(env.AGENT_RUNNER_URL && env.AGENT_RUNNER_TOKEN);
  }

  post(req: RunnerPostRequest): Promise<RunnerPostResponse> {
    return this.call<RunnerPostResponse>(RUNNER_ROUTES.post, req);
  }

  probe(req: RunnerProbeRequest): Promise<RunnerProbeResponse> {
    return this.call<RunnerProbeResponse>(RUNNER_ROUTES.probe, req);
  }

  captureStart(
    req: RunnerCaptureStartRequest
  ): Promise<RunnerCaptureStartResponse> {
    return this.call<RunnerCaptureStartResponse>(
      RUNNER_ROUTES.captureStart,
      req
    );
  }

  captureFinish(
    req: RunnerCaptureFinishRequest
  ): Promise<RunnerCaptureFinishResponse> {
    return this.call<RunnerCaptureFinishResponse>(
      RUNNER_ROUTES.captureFinish,
      req
    );
  }

  captureCancel(req: RunnerCaptureFinishRequest): Promise<{ ok: true }> {
    return this.call<{ ok: true }>(RUNNER_ROUTES.captureCancel, req);
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(
        `${this.baseUrl}${RUNNER_ROUTES.health}`
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.opts.timeoutMs ?? 180_000
    );
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.opts.token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw new AgentRunnerError(
        e instanceof Error
          ? `Agent runner unreachable: ${e.message}`
          : 'Agent runner unreachable',
        0,
        true
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) {
      let message = text || `Agent runner error ${res.status}`;
      try {
        message = (JSON.parse(text) as { error?: string }).error || message;
      } catch {
        // plain text body
      }
      throw new AgentRunnerError(message, res.status, res.status >= 500);
    }
    return JSON.parse(text) as T;
  }
}
