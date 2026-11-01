/** Hosts a browser is actually allowed to subscribe to. Anything else is refused. */
const PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
  'notify.windows.com',
]);

function isIp(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, '');
  if (name.includes(':')) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(name);
}

/** A push subscription we are willing to POST a recap to. */
export function pushEndpointAllowed(endpoint: string): boolean {
  if (!endpoint.startsWith('https://') || endpoint.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || isIp(host)) return false;
  if (PUSH_HOSTS.has(host)) return true;
  return host.endsWith('.notify.windows.com');
}
