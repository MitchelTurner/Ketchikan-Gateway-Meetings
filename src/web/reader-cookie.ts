import type { Request } from 'express';
import { requestIsHttps } from './https';
import { readCookie } from './stats.service';

export const READER_COOKIE = 'kgb_reader';

/** The subscriber token saved when a confirmed reader opens Ask, or an empty string. */
export function readerToken(req: Request): string {
  return readCookie(req.headers.cookie, READER_COOKIE);
}

/** HttpOnly. Pass an empty token to clear it. */
export function readerCookie(req: Request, token: string): string {
  const secure = requestIsHttps(req) ? '; Secure' : '';
  const maxAge = token ? 180 * 24 * 3600 : 0;
  return `${READER_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
