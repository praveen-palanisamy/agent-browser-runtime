/**
 * Minimal HTTP layer for the agent runner (no framework: `node:http` only).
 *
 * - Bearer-token auth on every /v1 route
 * - JSON bodies, size-capped
 * - /live/{captureId}/... proxies the provider live view (no token: the
 *   capture id is the credential, scoped to an active capture)
 */

import { timingSafeEqual } from 'node:crypto';
import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from 'node:http';
import { PROJECT, packageVersion, userAgentString } from '../attribution';
import { RUNNER_ROUTES } from '../protocol';
import { handleLiveHttp, handleLiveUpgrade } from './live-proxy';
import type { AgentRunner } from './runner';

const MAX_BODY_BYTES = 8 * 1024 * 1024; // sessions with localStorage can be large

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    Server: userAgentString(),
  });
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body too large');
    }
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) {
    return {} as T;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

export function isAuthorized(
  header: string | undefined,
  token: string
): boolean {
  const presented = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireFields(body: Record<string, unknown>, fields: string[]): void {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      throw new HttpError(400, `Missing required field: ${f}`);
    }
  }
}

export function createRunnerServer(runner: AgentRunner): Server {
  const { config } = runner;
  const liveDeps = {
    resolve: (captureId: string) => runner.capture.liveViewUrlFor(captureId),
    publicUrl: config.publicUrl,
    livePrefix: RUNNER_ROUTES.live,
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://runner');
    try {
      if (req.method === 'GET' && url.pathname === RUNNER_ROUTES.health) {
        json(res, 200, {
          ok: true,
          name: PROJECT.name,
          version: packageVersion(),
          repository: PROJECT.repository,
          jobProvider: config.jobProvider,
          captureProvider: config.captureProvider,
          activeCaptures: runner.capture.size,
        });
        return;
      }
      if (handleLiveHttp(req, res, liveDeps)) {
        return;
      }
      if (!url.pathname.startsWith('/v1/')) {
        throw new HttpError(404, 'Not found');
      }
      if (!isAuthorized(req.headers.authorization, config.token)) {
        throw new HttpError(401, 'Unauthorized');
      }
      if (req.method !== 'POST') {
        throw new HttpError(405, 'Method not allowed');
      }
      const body = await readJson<Record<string, unknown>>(req);
      switch (url.pathname) {
        case RUNNER_ROUTES.post:
          requireFields(body, [
            'jobId',
            'workspaceId',
            'accountId',
            'platform',
            'content',
            'session',
          ]);
          json(res, 200, await runner.post(body as never));
          return;
        case RUNNER_ROUTES.probe:
          requireFields(body, [
            'workspaceId',
            'accountId',
            'platform',
            'session',
          ]);
          json(res, 200, await runner.probe(body as never));
          return;
        case RUNNER_ROUTES.captureStart:
          requireFields(body, ['platform']);
          json(res, 200, await runner.captureStart(body as never));
          return;
        case RUNNER_ROUTES.captureFinish:
          requireFields(body, ['captureId']);
          json(res, 200, await runner.captureFinish(body as never));
          return;
        case RUNNER_ROUTES.captureCancel:
          requireFields(body, ['captureId']);
          json(res, 200, await runner.captureCancel(body as never));
          return;
        default:
          throw new HttpError(404, 'Not found');
      }
    } catch (e) {
      if (e instanceof HttpError) {
        json(res, e.status, { error: e.message });
        return;
      }
      console.error('[agent-runner] request failed', url.pathname, e);
      json(res, 500, {
        error: e instanceof Error ? e.message : 'Internal error',
      });
    }
  });

  server.on('upgrade', (req, socket, head) => {
    if (!handleLiveUpgrade(req, socket, head, liveDeps)) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
    }
  });

  return server;
}
