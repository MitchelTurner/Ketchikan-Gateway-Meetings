const ORIGIN = 'https://ketchikan.vote';

/**
 * Where the admin sign-in form may return. Only a path on this site under
 * /admin. A value that resolves off the site, or that still carries the
 * token, becomes the dashboard.
 */
export function adminSafeNext(next: unknown): string {
  const raw = String(next ?? '').trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('..')) return '/admin';
  let url: URL;
  try {
    url = new URL(raw, ORIGIN);
  } catch {
    return '/admin';
  }
  if (url.origin !== ORIGIN) return '/admin';
  const path = url.pathname;
  if (!path.startsWith('/admin') || path === '/admin/login' || path.startsWith('/admin/login/')) return '/admin';
  if (path.includes('//') || path.includes('..')) return '/admin';
  url.searchParams.delete('token');
  const search = url.searchParams.toString();
  return path + (search ? `?${search}` : '');
}

/** The same request path with the admin token removed from the query. */
export function adminPathWithoutToken(originalUrl: string): string {
  try {
    const url = new URL(originalUrl || '/admin', ORIGIN);
    if (url.origin !== ORIGIN) return '/admin';
    url.searchParams.delete('token');
    const search = url.searchParams.toString();
    const path = url.pathname + (search ? `?${search}` : '');
    if (!path.startsWith('/admin') || path.includes('//')) return '/admin';
    return path;
  } catch {
    return '/admin';
  }
}
