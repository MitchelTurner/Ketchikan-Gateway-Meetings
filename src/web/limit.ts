import type { NextFunction, Request, Response } from 'express';
import { page } from './page';

const HOUR = 60 * 60 * 1000;
const MAX_KEYS = 5000;

interface Rule {
  id: string;
  method: string;
  match: (path: string) => boolean;
  limit: number;
  windowMs: number;
}

const RULES: Rule[] = [
  { id: 'login', method: 'POST', match: (p) => p === '/login' || p === '/ask/link' || p === '/subscribe', limit: 8, windowMs: HOUR },
  { id: 'admin-login', method: 'POST', match: (p) => p === '/admin/login', limit: 8, windowMs: 15 * 60 * 1000 },
  { id: 'ask', method: 'POST', match: (p) => p === '/ask', limit: 12, windowMs: HOUR },
  { id: 'checkout', method: 'POST', match: (p) => p === '/account/checkout' || p === '/ask/checkout', limit: 6, windowMs: HOUR },
  { id: 'comment', method: 'POST', match: (p) => /^\/notes\/[^/]+\/comment$/.test(p), limit: 20, windowMs: HOUR },
  { id: 'push', method: 'POST', match: (p) => p === '/push/subscribe', limit: 10, windowMs: HOUR },
];

/** True when this hit is still inside the allowance. Denied hits are not stored. */
export function takeHit(store: Map<string, number[]>, key: string, limit: number, windowMs: number, now: number): boolean {
  const prev = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  if (prev.length >= limit) {
    store.set(key, prev);
    return false;
  }
  prev.push(now);
  store.set(key, prev);
  return true;
}

function trim(store: Map<string, number[]>, now: number): void {
  if (store.size <= MAX_KEYS) return;
  for (const [key, times] of store) {
    if (times.every((t) => now - t >= HOUR)) store.delete(key);
    if (store.size <= MAX_KEYS) return;
  }
  while (store.size > MAX_KEYS) {
    const first = store.keys().next().value;
    if (first === undefined) break;
    store.delete(first);
  }
}

function cleanPath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.replace(/\/+$/, '');
  return path || '/';
}

/**
 * Per-address limits for the routes that send mail, call Claude, or create
 * Stripe customers. One process, which is this app's single instance.
 * Uses the proxy-aware address, not a client-supplied forwarded header.
 */
export function rateLimit(now: () => number = Date.now) {
  const store = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const rule = RULES.find((r) => r.method === req.method && r.match(cleanPath(req.path || '/')));
    if (!rule) {
      next();
      return;
    }
    const ip = req.ip || 'unknown';
    const at = now();
    trim(store, at);
    if (takeHit(store, `${rule.id} ${ip}`, rule.limit, rule.windowMs, at)) {
      next();
      return;
    }
    const message = 'Too many tries from this network. Wait a bit and try again.';
    if (String(req.headers.accept ?? '').includes('text/html')) {
      res.status(429).type('html').send(page('Slow down', `<h1>Slow down</h1><p>${message}</p>`));
      return;
    }
    res.status(429).type('text/plain').send(message);
  };
}
