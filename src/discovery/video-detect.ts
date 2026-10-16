import * as cheerio from 'cheerio';

export type VideoPlatform = 'youtube' | 'youtube-list' | 'vimeo' | 'granicus' | 'swagit' | 'file';
export interface VideoRef {
  url: string;
  platform: VideoPlatform;
  label?: string;
}

/**
 * Finds meeting videos on an archive page without knowing the host in advance:
 * iframes/embeds, links, and bare URLs inside scripts are all checked against
 * the known video hosts. YouTube channel/playlist links come back as
 * 'youtube-list' so the caller can expand them.
 */
export function detectVideos(html: string, baseUrl: string): VideoRef[] {
  const $ = cheerio.load(html);
  const found = new Map<string, VideoRef>();

  const consider = (raw: string | undefined, label?: string) => {
    if (!raw) return;
    let u: URL;
    try {
      u = new URL(raw.trim().replace(/&amp;/g, '&'), baseUrl);
    } catch {
      return;
    }
    const ref = classify(u);
    if (!ref) return;
    const cleanLabel = label?.replace(/\s+/g, ' ').trim() || undefined;
    const existing = found.get(ref.url);
    if (!existing) found.set(ref.url, { ...ref, label: cleanLabel });
    else if (!existing.label && cleanLabel) existing.label = cleanLabel;
  };

  $('iframe, embed, video, source').each((_, el) => {
    const $el = $(el);
    const label = $el.attr('title') || $el.closest('div, section, li, td').find('h1,h2,h3,h4,strong').first().text();
    consider($el.attr('src') || $el.attr('data-src'), label);
  });
  $('a[href]').each((_, el) => {
    const $el = $(el);
    consider($el.attr('href'), $el.text() || $el.attr('title'));
  });
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)) consider(m[0]);

  return [...found.values()];
}

/** Lists every iframe/embed source on the page — used by /admin/inspect to see what host the Borough uses. */
export function listEmbeds(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const out = new Set<string>();
  $('iframe, embed, video, source, script[src]').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (src) {
      try { out.add(new URL(src, baseUrl).toString()); } catch { /* ignore */ }
    }
  });
  return [...out];
}

export function classify(u: URL): Omit<VideoRef, 'label'> | null {
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const path = u.pathname;
  const yt = (id: string): Omit<VideoRef, 'label'> => ({ url: `https://www.youtube.com/watch?v=${id}`, platform: 'youtube' });

  if (host === 'youtu.be') {
    const id = path.slice(1).split('/')[0];
    return /^[\w-]{11}$/.test(id) ? yt(id) : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host.endsWith('.youtube.com')) {
    const v = u.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return yt(v);
    const embed = path.match(/^\/(?:embed|live|shorts|v)\/([\w-]{11})(?:[/?]|$)/);
    if (embed && embed[1] !== 'videoseries') return yt(embed[1]);
    const list = u.searchParams.get('list');
    if (list) return { url: `https://www.youtube.com/playlist?list=${list}`, platform: 'youtube-list' };
    const ch = path.match(/^\/(@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)/);
    if (ch) return { url: `https://www.youtube.com/${ch[1]}`, platform: 'youtube-list' };
    return null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = path.match(/(?:^\/|\/video\/)(\d{6,})/);
    return m ? { url: `https://vimeo.com/${m[1]}`, platform: 'vimeo' } : null;
  }
  if (host.endsWith('granicus.com')) {
    const clip = u.searchParams.get('clip_id');
    const view = u.searchParams.get('view_id');
    if (clip) return { url: `https://${u.hostname}/MediaPlayer.php?${view ? `view_id=${view}&` : ''}clip_id=${clip}`, platform: 'granicus' };
    return null;
  }
  if (host.endsWith('swagit.com') && /\/play\//.test(path)) {
    return { url: `https://${u.hostname}${path.replace(/\/$/, '')}`, platform: 'swagit' };
  }
  if (/\.(mp4|m4v|mov|m3u8|mp3|m4a)$/i.test(path)) {
    return { url: u.toString(), platform: 'file' };
  }
  return null;
}
