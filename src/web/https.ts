import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';

const HOST = /^[A-Za-z0-9.-]+(?::\d+)?$/;

export function requestIsHttps(req: Request): boolean {
  if (req.secure) return true;
  return firstHeader(req, 'x-forwarded-proto').toLowerCase().startsWith('https');
}

/**
 * A form posted from this site. Browsers send Origin on a POST. A missing
 * Origin and Referer is refused, so another site cannot submit the form.
 */
export function postedFromHere(req: Request): boolean {
  const source = String(req.headers.origin || req.headers.referer || '');
  if (!source) return false;
  let from: URL;
  try {
    from = new URL(source);
  } catch {
    return false;
  }
  const hosts = new Set<string>();
  const forwarded = firstHeader(req, 'x-forwarded-host') || firstHeader(req, 'host');
  if (forwarded) hosts.add(forwarded.toLowerCase());
  try {
    hosts.add(new URL(config.publicBaseUrl).host.toLowerCase());
  } catch {
    /* a local run with no public URL still matches the request host */
  }
  return hosts.has(from.host.toLowerCase());
}

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
    if (requestIsHttps(req)) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    res.setHeader(
      'Content-Security-Policy',
      "upgrade-insecure-requests; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    const target = httpsRedirectTarget(req, publicBase());
    if (target) {
      res.redirect(301, target);
      return;
    }
    next();
  };
}
