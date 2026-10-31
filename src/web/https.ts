import type { NextFunction, Request, Response } from 'express';

const HOST = /^[A-Za-z0-9.-]+(?::\d+)?$/;

function firstHeader(req: Request, name: string): string {
  const value = req.headers[name];
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? '').split(',')[0].trim();
}

/**
 * Where an http request should land. Uses the configured public origin when
 * it is https, otherwise the request host. Returns null when the request is
 * already https, or when there is no proxy header (a direct healthcheck or
 * a local run) so those are left alone.
 */
export function httpsRedirectTarget(req: Request, publicBase: string | null): string | null {
  const forwarded = firstHeader(req, 'x-forwarded-proto').toLowerCase();
  if (forwarded !== 'http') return null;
  if (publicBase) {
    try {
      const base = new URL(publicBase);
      if (base.protocol === 'https:') return `${base.origin}${req.originalUrl}`;
    } catch {
      /* fall through to the request host */
    }
  }
  const host = firstHeader(req, 'x-forwarded-host') || firstHeader(req, 'host');
  if (!HOST.test(host)) return null;
  return `https://${host}${req.originalUrl}`;
}

/** 301 to https, and tell browsers to stay there. Healthchecks have no forwarded proto, so they pass. */
export function forceHttps(publicBase: () => string | null) {
  return (req: Request, res: Response, next: NextFunction) => {
    const target = httpsRedirectTarget(req, publicBase());
    if (target) {
      res.redirect(301, target);
      return;
    }
    const forwarded = firstHeader(req, 'x-forwarded-proto').toLowerCase();
    if (forwarded === 'https' || req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    res.setHeader('Content-Security-Policy', 'upgrade-insecure-requests');
    next();
  };
}
