import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { UPLOAD_LIMITS, UPLOAD_MIME_TYPES } from '@kavach/shared';
import type { NextFunction, Request, Response } from 'express';
import type { KavachRequest } from './common/context/request-context';

/** The id that ties one request to its log line, its audit rows and its error report. */
export function requestIdOf(req: Request): string {
  const held = (req as Request & { requestId?: string }).requestId;
  if (held) return held;
  const id = randomUUID();
  (req as Request & { requestId?: string }).requestId = id;
  return id;
}

/** `TRUST_PROXY`: number of reverse proxies in front of the API, so `req.ip` is the client's. */
function trustProxy(): number | boolean {
  const raw = (process.env.TRUST_PROXY ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'false' || raw === '0') return false;
  if (raw === 'true') return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : false;
}

/**
 * Headers for an API that serves JSON and files to its own clients only (PRD §25.2).
 * Nothing it returns should be framed, sniffed, cached by a shared cache or run as a page.
 */
function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.COOKIE_SECURE === 'true') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('X-Request-Id', requestIdOf(req));
  next();
}

/**
 * One JSON line per request: enough to see error rates, slow routes and who did what, with
 * no bodies, tokens or query strings (they may carry names and document numbers).
 */
function requestLog(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    if (process.env.REQUEST_LOG === 'off') return;
    if (req.path === '/health' || req.path === '/health/ready') return;
    const r = req as KavachRequest;
    const line = {
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      time: new Date().toISOString(),
      msg: 'request',
      requestId: requestIdOf(req),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
      userId: r.ctx?.userId ?? r.auth?.userId ?? null,
      projectId: r.ctx?.projectId ?? null,
      ip: req.ip ?? null,
    };
    process.stdout.write(`${JSON.stringify(line)}\n`);
  });
  next();
}

/**
 * HTTP settings shared by the server and the integration tests, so tests exercise the same body
 * parsers, limits and headers as production.
 */
export function configureApp(app: NestExpressApplication): void {
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy());
  app.use(securityHeaders);
  app.use(requestLog);
  // Document uploads arrive as the raw file bytes (PRD §7.2: JPG, PNG, PDF). Everything else is
  // JSON. The declared type only selects the parser: the real type is read from the bytes.
  app.useBodyParser('raw', {
    type: [...UPLOAD_MIME_TYPES, 'application/octet-stream'],
    // A little above the per-file limit, so the service can answer with a clear message.
    limit: UPLOAD_LIMITS.maxFileBytes + 1024 * 1024,
  });
}
