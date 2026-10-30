export interface NewsArticle {
  outlet: string;
  title: string;
  url: string;
  published: Date | null;
  excerpt: string;
}

/**
 * KRBD's public feed. The Daily News blocks automated requests, so a miss here
 * just means the recap stays on the transcript.
 */
const SEARCH = 'https://www.krbd.org/';

export async function findLocalNews(opts: {
  body: string;
  title: string;
  meetingDate: Date | null;
  userAgent: string;
}): Promise<NewsArticle[]> {
  if (!opts.meetingDate) return [];
  const month = opts.meetingDate.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const year = opts.meetingDate.getUTCFullYear();
  const queries = [`${opts.body} ${month} ${year}`, `Ketchikan ${opts.body} ${year}`];
  const found = new Map<string, NewsArticle>();
  await Promise.all(
    queries.map(async (q) => {
      try {
        const url = `${SEARCH}?s=${encodeURIComponent(q)}&feed=rss2`;
        const xml = await getText(url, opts.userAgent);
        for (const article of parseRss(xml)) {
          if (!found.has(article.url)) found.set(article.url, article);
        }
      } catch {
        /* one failed search should not block the recap */
      }
    }),
  );
  return [...found.values()]
    .filter((a) => inWindow(a.published, opts.meetingDate!) && aboutBody(a, opts.body))
    .sort((a, b) => distance(a.published, opts.meetingDate!) - distance(b.published, opts.meetingDate!))
    .slice(0, 4);
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

function inWindow(published: Date | null, meeting: Date): boolean {
  if (!published || Number.isNaN(published.getTime())) return false;
  const day = 24 * 3600_000;
  const t = published.getTime();
  return t >= meeting.getTime() - 2 * day && t <= meeting.getTime() + 18 * day;
}

function distance(published: Date | null, meeting: Date): number {
  if (!published) return Number.MAX_SAFE_INTEGER;
  return Math.abs(published.getTime() - meeting.getTime());
}

function parseRss(xml: string): NewsArticle[] {
  return xml
    .split(/<item\b/i)
    .slice(1)
    .map((chunk) => {
      const title = textOf(chunk, 'title');
      const url = textOf(chunk, 'link');
      const pub = textOf(chunk, 'pubDate');
      const body = textOf(chunk, 'content:encoded') || textOf(chunk, 'description');
      const published = pub ? new Date(pub) : null;
      return {
        outlet: 'KRBD',
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
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
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
