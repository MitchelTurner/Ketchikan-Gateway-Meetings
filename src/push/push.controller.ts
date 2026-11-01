import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException, Body, Controller, Get, Header, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ICON_192, ICON_512 } from './icons';
import { pushEndpointAllowed } from './push-endpoint';
import { PushService } from './push.service';

/** The uploaded mark, Ketchikan.Vote.png, copied next to the app in the image. */
let logoBytes: Buffer | undefined;
function siteLogo(): Buffer | undefined {
  if (logoBytes) return logoBytes;
  try {
    logoBytes = readFileSync(join(process.cwd(), 'Ketchikan.Vote.png'));
    return logoBytes;
  } catch {
    return undefined;
  }
}

const SW = `self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(event) { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function() {});
self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  var title = data.title || 'A new recap is up';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'Open it to read what the meeting decided.',
    icon: '/logo.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' }
  }));
});
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var raw = (event.notification.data && event.notification.data.url) || '/';
  var url = '/';
  try {
    var parsed = new URL(raw, self.location.origin);
    if (parsed.origin === self.location.origin) url = parsed.pathname + parsed.search + parsed.hash;
  } catch (e) {}
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(url) !== -1 && list[i].focus) return list[i].focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
`;

const MANIFEST = {
  name: 'Votes',
  short_name: 'Votes',
  description: 'Plain-language recaps of Ketchikan public meetings, with a buzz when a new one is published.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#06080b',
  theme_color: '#06080b',
  icons: [
    { src: '/logo.png', sizes: '1000x1000', type: 'image/png', purpose: 'any' },
  ],
};

function pushBody(body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }): { endpoint: string; p256dh: string; auth: string } | null {
  const endpoint = String(body?.endpoint ?? '');
  const p256dh = String(body?.keys?.p256dh ?? '');
  const auth = String(body?.keys?.auth ?? '');
  const key = /^[A-Za-z0-9_-]{16,200}$/;
  if (!pushEndpointAllowed(endpoint)) return null;
  if (!key.test(p256dh) || !key.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

@Controller()
export class PushController {
  constructor(private push: PushService) {}

  @Get('manifest.webmanifest')
  manifest(@Res() res: Response) {
    res.type('application/manifest+json').setHeader('Cache-Control', 'public, max-age=3600').send(MANIFEST);
  }

  @Get('sw.js')
  serviceWorker(@Res() res: Response) {
    res.type('application/javascript').setHeader('Cache-Control', 'no-cache').send(SW);
  }

  @Get('logo.png')
  logo(@Res() res: Response) {
    const file = siteLogo();
    if (!file) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.type('image/png').setHeader('Cache-Control', 'public, max-age=86400').send(file);
  }

  @Get('icon-192.png')
  icon192(@Res() res: Response) {
    res.type('image/png').setHeader('Cache-Control', 'public, max-age=86400').send(ICON_192);
  }

  @Get('icon-512.png')
  icon512(@Res() res: Response) {
    res.type('image/png').setHeader('Cache-Control', 'public, max-age=86400').send(ICON_512);
  }

  @Get('push/vapid')
  @Header('Cache-Control', 'no-store')
  async vapid() {
    return { publicKey: await this.push.publicKey() };
  }

  @Post('push/subscribe')
  @HttpCode(204)
  async subscribe(@Body() body: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; bodies?: string[] | string }) {
    const parsed = pushBody(body);
    if (!parsed) throw new BadRequestException('That subscription was not usable');
    const bodies = body.bodies === undefined ? undefined : (Array.isArray(body.bodies) ? body.bodies : [body.bodies]).map(String);
    await this.push.subscribe(parsed.endpoint, parsed.p256dh, parsed.auth, bodies);
  }

  @Post('push/unsubscribe')
  @HttpCode(204)
  async unsubscribe(@Body() body: { endpoint?: string }) {
    const endpoint = String(body?.endpoint ?? '');
    if (!endpoint.startsWith('https://') || endpoint.length > 2000) throw new BadRequestException('That subscription was not usable');
    await this.push.unsubscribe(endpoint);
  }
}
