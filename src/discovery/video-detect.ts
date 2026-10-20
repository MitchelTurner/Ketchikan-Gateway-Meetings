import * as cheerio from 'cheerio';

export type VideoPlatform = 'youtube' | 'youtube-list' | 'vimeo' | 'granicus' | 'swagit' | 'file';
export interface VideoRef {
  url: string;
  platform: VideoPlatform;
  label?: string;
  durationSec?: number;
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

/** ViewPublisher frames embedded on the Borough archive page. */
export function granicusPublisherUrls(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const found = new Set<string>();
  const consider = (raw?: string) => {
    const url = granicusPublisherUrl(raw, baseUrl);
    if (url) found.add(url);
  };
  $('iframe, embed, a[href]').each((_, el) => {
    consider($(el).attr('src') || $(el).attr('data-src') || $(el).attr('href'));
  });
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)) consider(m[0]);
  return [...found];
}

export function isGranicusPublisher(url: string): boolean {
  return granicusPublisherUrl(url, url) !== null;
}

function granicusPublisherUrl(raw: string | undefined, baseUrl: string): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/&amp;/g, '&'), baseUrl);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!host.endsWith('granicus.com') || !/\/ViewPublisher\.php$/i.test(u.pathname)) return null;
  const view = u.searchParams.get('view_id');
  if (!view) return null;
  return `https://${host}/ViewPublisher.php?view_id=${view}`;
}

/**
 * Archive rows on a Granicus ViewPublisher page. Upcoming events have agendas
 * only, so a row counts when it has a MediaPlayer clip. The stored URL is the
 * player page (stable clip id), not the MP4, which is a changing file name.
 */
export function parseGranicusArchive(html: string, pageUrl: string): VideoRef[] {
  const $ = cheerio.load(html);
  const found = new Map<string, VideoRef>();
  $('tr').each((_, tr) => {
    let name = '';
    let date = '';
    let duration = '';
    $(tr).find('td').each((__, td) => {
      const header = ($(td).attr('headers') || '').split(/\s+/)[0] || '';
      const text = $(td).text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (header === 'Name' && text) name = text;
      else if (header === 'Date' && text) date = text;
      else if (header === 'Duration' && text) duration = text;
    });
    const rowHtml = $.html(tr).replace(/&amp;/g, '&').replace(/\\\//g, '/');
    const player = rowHtml.match(/\/\/([^/"'\s]+)\/MediaPlayer\.php\?[^"'\s]*clip_id=(\d+)/i);
    if (!player) return;
    const view = rowHtml.match(/MediaPlayer\.php\?[^"'\s]*view_id=(\d+)/i)?.[1];
    const url = `https://${player[1]}/MediaPlayer.php?${view ? `view_id=${view}&` : ''}clip_id=${player[2]}`;
    if (found.has(url)) return;
    const label = [name, date].filter(Boolean).join(' – ') || undefined;
    found.set(url, { url, platform: 'granicus', label, durationSec: parseGranicusDuration(duration) });
  });
  if (found.size === 0 && isGranicusPublisher(pageUrl)) {
    // Some publisher skins put the player link outside a labeled row.
    for (const m of html.matchAll(/\/\/([^/"'\s]+)\/MediaPlayer\.php\?[^"'\s]*clip_id=(\d+)/gi)) {
      const view = m[0].match(/view_id=(\d+)/i)?.[1];
      const url = `https://${m[1]}/MediaPlayer.php?${view ? `view_id=${view}&` : ''}clip_id=${m[2]}`;
      if (!found.has(url)) found.set(url, { url, platform: 'granicus' });
    }
  }
  return [...found.values()];
}

/** "03h 11m" from the Granicus duration column. */
export function parseGranicusDuration(text: string): number | undefined {
  if (!text) return undefined;
  const h = text.match(/(\d+)\s*h/i);
  const m = text.match(/(\d+)\s*m/i);
  const s = text.match(/(\d+)\s*s/i);
  if (!h && !m && !s) return undefined;
  return (h ? +h[1] : 0) * 3600 + (m ? +m[1] : 0) * 60 + (s ? +s[1] : 0);
}

/** Audio file linked from a MediaPlayer page. The MP3 is preferred over the multi-GB MP4. */
export function granicusDownloadUrl(html: string): string | null {
  const text = html.replace(/\\\//g, '/');
  const links = [...text.matchAll(/https?:\/\/archive-video\.granicus\.com\/[^\s"'<>\\]+/gi)].map((m) =>
    m[0].replace(/[),;]+$/, ''),
  );
  return links.find((l) => /\.mp3(\?|$)/i.test(l)) ?? links.find((l) => /\.(mp4|m4a|m4v)(\?|$)/i.test(l)) ?? null;
}

/** Title Granicus puts on the player page, when it is a meeting name rather than a file id. */
export function granicusPlayerTitle(html: string): string | undefined {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  if (!m) return undefined;
  const title = m[1].replace(/\s+/g, ' ').trim();
  if (!title || isFileLikeTitle(title) || /media player/i.test(title)) return undefined;
  return title;
}

/** Site origin CloudFront expects as Referer/Origin for archive-video.granicus.com. */
export function granicusSiteOrigin(fileUrl: string): string {
  const u = new URL(fileUrl);
  if (u.hostname === 'archive-video.granicus.com') {
    const site = u.pathname.split('/').filter(Boolean)[0];
    if (site) return `https://${site}.granicus.com`;
  }
  return `https://${u.hostname}`;
}

/** yt-dlp's title for these files is the uuid; keep the archive row label instead. */
export function meetingTitle(metaTitle: string | undefined, label: string | undefined, fallback: string): string {
  const meta = metaTitle?.replace(/\s+/g, ' ').trim();
  const nice = label?.replace(/\s+/g, ' ').trim();
  if (nice && (!meta || isFileLikeTitle(meta))) return nice;
  return meta || nice || fallback;
}

export function isFileLikeTitle(title: string): boolean {
  return /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(title) || /borough-ketchikan_/i.test(title) || /\.(mp[34]|m4a|webm)$/i.test(title);
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
