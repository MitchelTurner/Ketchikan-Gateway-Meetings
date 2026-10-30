export interface NewsArticle {
  outlet: string;
  title: string;
  url: string;
  published: Date | null;
  excerpt: string;
}

/**
 * KRBD's search feed and the Borough's news releases. The Ketchikan Daily News
 * and Alaska Beacon refuse automated requests, and Alaska Public Media has no
 * search feed, so they are left out. A miss here just means less context.
 */
const KRBD = 'https://www.krbd.org/';
const BOROUGH_NEWS = 'https://www.kgbak.us/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml';

const DAY = 24 * 3600_000;

export async function findLocalNews(opts: {
  body: string;
  title: string;
  meetingDate: Date | null;
  userAgent: string;
}): Promise<NewsArticle[]> {
  if (!opts.meetingDate) return [];
  const meeting = opts.meetingDate;
  const month = meeting.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const year = meeting.getUTCFullYear();
  const found = await collect(
    [
      { url: krbdSearch(`${opts.body} ${month} ${year}`), outlet: 'KRBD' },
      { url: krbdSearch(`Ketchikan ${opts.body} ${year}`), outlet: 'KRBD' },
      { url: BOROUGH_NEWS, outlet: 'Ketchikan Gateway Borough' },
    ],
    opts.userAgent,
  );
  return found
    .filter((a) => between(a.published, meeting.getTime() - 2 * DAY, meeting.getTime() + 18 * DAY) && aboutBody(a, opts.body))
    .sort((a, b) => distance(a.published, meeting) - distance(b.published, meeting))
    .slice(0, 4);
}

function krbdSearch(q: string): string {
  return `${KRBD}?s=${encodeURIComponent(q)}&feed=rss2`;
}

async function collect(feeds: { url: string; outlet: string }[], userAgent: string): Promise<NewsArticle[]> {
  const found = new Map<string, NewsArticle>();
  await Promise.all(
    feeds.map(async ({ url, outlet }) => {
      try {
        for (const article of parseRss(await getText(url, userAgent), outlet)) {
          if (!found.has(article.url)) found.set(article.url, article);
        }
      } catch {
        /* one failed feed should not block the recap */
      }
    }),
  );
  return [...found.values()];
}

export function leadSentence(excerpt: string): string {
  const s = excerpt.replace(/\s+/g, ' ').trim();
  const m = s.match(/^.{40,280}?[.!?]/);
  return (m ? m[0] : s.slice(0, 220)).trim();
}

function aboutBody(article: NewsArticle, body: string): boolean {
  const hay = `${article.title} ${article.excerpt}`.toLowerCase();
  if (body === 'Assembly') return /assembly|borough/.test(hay);
  if (body === 'School Board') return /school/.test(hay);
  if (body === 'Planning Commission') return /planning|commission/.test(hay);
  const keys = body.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  return keys.some((k) => hay.includes(k));
}

function between(published: Date | null, start: number, end: number): boolean {
  if (!published || Number.isNaN(published.getTime())) return false;
  const t = published.getTime();
  return t >= start && t <= end;
}

function distance(published: Date | null, meeting: Date): number {
  if (!published) return Number.MAX_SAFE_INTEGER;
  return Math.abs(published.getTime() - meeting.getTime());
}

function parseRss(xml: string, outlet: string): NewsArticle[] {
  return xml
    .split(/<item\b/i)
    .slice(1)
    .map((chunk) => {
      const title = plain(textOf(chunk, 'title'));
      const url = textOf(chunk, 'link');
      const pub = textOf(chunk, 'pubDate');
      const body = textOf(chunk, 'content:encoded') || textOf(chunk, 'description');
      const published = pub ? new Date(pub) : null;
      return {
        outlet,
        title,
        url,
        published: published && !Number.isNaN(published.getTime()) ? published : null,
        excerpt: plain(body).slice(0, 1400),
      };
    })
    .filter((a) => a.title && a.url.startsWith('http'));
}

function textOf(chunk: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = chunk.match(re);
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function plain(s: string): string {
  return decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;(#\d+|#x[0-9a-f]+);/gi, (_, n: string) =>
      String.fromCharCode(n[1] === 'x' || n[1] === 'X' ? parseInt(n.slice(2), 16) : Number(n.slice(1))),
    )
    .replace(/&amp;/g, '&');
}

async function getText(url: string, userAgent: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(12_000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}
