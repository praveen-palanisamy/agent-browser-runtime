/**
 * Live-view proxy.
 *
 * Steel's live view (`/v1/sessions/debug` + `/v1/sessions/cast` websocket)
 * is served by the Steel API, which we keep private. The runner exposes it
 * under `/live/{captureId}/...` so the embedding app can iframe it while the user
 * signs in. The capture id is unguessable and only valid while the capture
 * is active; the HTML is rewritten so its absolute Steel URLs point back
 * through this proxy.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect } from 'node:net';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';

export type LiveProxyDeps = {
  /** Resolve a capture id to the upstream live view URL (absolute). */
  resolve: (captureId: string) => string | undefined;
  publicUrl: string;
  livePrefix: string;
};

export function parseLivePath(
  pathname: string,
  livePrefix: string
): { captureId: string; rest: string } | null {
  if (!pathname.startsWith(`${livePrefix}/`)) {
    return null;
  }
  const remainder = pathname.slice(livePrefix.length + 1);
  const slash = remainder.indexOf('/');
  const captureId = slash === -1 ? remainder : remainder.slice(0, slash);
  const rest = slash === -1 ? '/' : remainder.slice(slash);
  return captureId ? { captureId, rest } : null;
}

/** Rewrite Steel's absolute self-references to go through the proxy. */
export function rewriteLiveHtml(
  html: string,
  upstreamOrigin: string,
  proxyBase: string
): string {
  const httpOrigin = upstreamOrigin.replace(/\/+$/, '');
  const wsOrigin = httpOrigin.replace(/^http/, 'ws');
  const wsProxy = proxyBase.replace(/^http/, 'ws');
  return html.split(wsOrigin).join(wsProxy).split(httpOrigin).join(proxyBase);
}

export function handleLiveHttp(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LiveProxyDeps
): boolean {
  const url = new URL(req.url || '/', 'http://runner');
  const parsed = parseLivePath(url.pathname, deps.livePrefix);
  if (!parsed) {
    return false;
  }
  const upstream = deps.resolve(parsed.captureId);
  if (!upstream) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Capture not found or expired');
    return true;
  }
  const upstreamUrl = new URL(upstream);
  // Root of the capture -> the provider's live view page (interactive).
  const targetPath =
    parsed.rest === '/'
      ? `${upstreamUrl.pathname}?interactive=true&showControls=false`
      : `${parsed.rest}${url.search}`;
  const proxyBase = `${deps.publicUrl}${deps.livePrefix}/${parsed.captureId}`;
  const requester =
    upstreamUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  // Drop accept-encoding so the upstream body is plain text we can rewrite.
  const { 'accept-encoding': _enc, ...forwarded } = req.headers;
  const headers = { ...forwarded, host: upstreamUrl.host };
  const proxyReq = requester(
    {
      protocol: upstreamUrl.protocol,
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || (upstreamUrl.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: targetPath,
      headers,
    },
    (proxyRes) => {
      const contentType = String(proxyRes.headers['content-type'] || '');
      // We may change the body (let node compute length) and the page must be
      // embeddable in the caller's iframe.
      const {
        'content-length': _len,
        'x-frame-options': _xfo,
        'content-security-policy': _csp,
        ...responseHeaders
      } = proxyRes.headers;
      if (
        contentType.includes('text/html') ||
        contentType.includes('javascript')
      ) {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (c: Buffer) => chunks.push(c));
        proxyRes.on('end', () => {
          const body = rewriteLiveHtml(
            Buffer.concat(chunks).toString('utf8'),
            upstreamUrl.origin,
            proxyBase
          );
          res.writeHead(proxyRes.statusCode || 200, responseHeaders);
          res.end(body);
        });
      } else {
        res.writeHead(proxyRes.statusCode || 200, responseHeaders);
        proxyRes.pipe(res);
      }
    }
  );
  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    res.end('Live view upstream unavailable');
  });
  req.pipe(proxyReq);
  return true;
}

export function handleLiveUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  deps: LiveProxyDeps
): boolean {
  const url = new URL(req.url || '/', 'http://runner');
  const parsed = parseLivePath(url.pathname, deps.livePrefix);
  if (!parsed) {
    return false;
  }
  const upstream = deps.resolve(parsed.captureId);
  if (!upstream) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return true;
  }
  const upstreamUrl = new URL(upstream);
  const secure = upstreamUrl.protocol === 'https:';
  const port = Number(upstreamUrl.port || (secure ? 443 : 80));
  const target = secure
    ? tlsConnect({
        host: upstreamUrl.hostname,
        port,
        servername: upstreamUrl.hostname,
      })
    : netConnect({ host: upstreamUrl.hostname, port });

  target.on('connect', () => {
    const lines = [`${req.method} ${parsed.rest}${url.search} HTTP/1.1`];
    for (const [key, value] of Object.entries(req.headers)) {
      if (key === 'host') {
        lines.push(`host: ${upstreamUrl.host}`);
      } else if (Array.isArray(value)) {
        for (const v of value) lines.push(`${key}: ${v}`);
      } else if (value !== undefined) {
        lines.push(`${key}: ${value}`);
      }
    }
    target.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length) {
      target.write(head);
    }
    socket.pipe(target).pipe(socket);
  });
  const teardown = () => {
    socket.destroy();
    target.destroy();
  };
  target.on('error', teardown);
  socket.on('error', teardown);
  return true;
}
