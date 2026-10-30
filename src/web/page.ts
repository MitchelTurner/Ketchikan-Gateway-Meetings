import { config } from '../config';
import { sourceLabel, timestampUrl } from '../email/render';
import { MeetingDigest } from '../analysis/analysis.service';
import { BODIES, esc, formatDate, hms, meetingParts, shortDate } from '../util';

const FONTS =
  'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Public+Sans:wght@400;500;600;700&display=swap';

// Newsprint palette: warm paper, near-black ink, one editorial red. Light only.
const CSS = `
:root{--paper:#fbfaf6;--ink:#141412;--ink-2:#3b3a36;--muted:#6f6a60;--rule:#ddd7ca;--rule-strong:#141412;--accent:#a3201c;--wash:#f2eee4;
--serif:'Newsreader',Georgia,'Times New Roman',serif;--sans:'Public Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.6 var(--serif);font-optical-sizing:auto}
a{color:inherit;text-decoration-color:var(--rule);text-underline-offset:3px}
a:hover{color:var(--accent);text-decoration-color:currentColor}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.narrow{max-width:680px}

/* Masthead */
.masthead{border-bottom:1px solid var(--rule-strong)}
.topline{display:flex;justify-content:space-between;gap:16px;padding:10px 24px;font:500 12px/1.4 var(--sans);letter-spacing:.04em;color:var(--muted);border-bottom:1px solid var(--rule)}
.topline span:nth-child(2){text-align:center}
.nameplate{text-align:center;padding:26px 24px 6px}
.nameplate a{font:600 clamp(34px,6.4vw,64px)/1 var(--serif);letter-spacing:-.02em;text-decoration:none;color:var(--ink)}
.nameplate a:hover{color:var(--ink)}
.tagline{text-align:center;font:italic 400 17px/1.4 var(--serif);color:var(--muted);padding:6px 24px 18px}
.masthead.compact .nameplate{padding:16px 24px 14px}.masthead.compact .nameplate a{font-size:clamp(26px,4vw,34px)}
.masthead.compact .tagline{display:none}
.sections{display:flex;justify-content:center;flex-wrap:wrap;gap:6px 28px;padding:11px 24px;border-top:1px solid var(--rule-strong);box-shadow:0 2px 0 -1px var(--paper),0 3px 0 -1px var(--rule-strong);font:600 12px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase}
.sections a{text-decoration:none}

/* Type */
h1,h2,h3{font-family:var(--serif);font-weight:600;letter-spacing:-.012em;margin:0}
h1{font-size:clamp(32px,4.6vw,46px);line-height:1.08;margin:0 0 14px}
p{margin:0 0 16px}
.kicker{font:700 11.5px/1.4 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:10px}
.meta{font:500 13px/1.5 var(--sans);color:var(--muted)}
.muted{color:var(--muted);font-size:15px}
.dek{font-size:21px;line-height:1.45;color:var(--ink-2)}
.rubric{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-top:3px solid var(--rule-strong);padding-top:10px;margin:0 0 18px;font:700 12px/1.3 var(--sans);letter-spacing:.14em;text-transform:uppercase}
.rubric a{font-weight:600;letter-spacing:.04em;text-transform:none;font-size:13px;color:var(--muted)}
.more{font:600 14px/1.4 var(--sans);text-decoration:none;color:var(--accent)}
mark{background:#f6e7a8;padding:0 2px}

/* Generic page body */
.sheet{padding:44px 0 8px}
.sheet h2{font-size:22px;margin:30px 0 10px}
.sheet h2.section{font:700 12px/1.3 var(--sans);letter-spacing:.14em;text-transform:uppercase;border-top:1px solid var(--rule-strong);padding-top:10px;margin:36px 0 14px}

/* Forms */
label{display:block;font:600 13px/1.4 var(--sans);margin:18px 0 6px}
input[type=email],input[type=search],select{width:100%;padding:12px 14px;font:16px/1.3 var(--sans);border:1px solid #c9c2b2;border-radius:2px;background:#fff;color:inherit}
input:focus,select:focus,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
fieldset{border:0;padding:0;margin:18px 0 0}legend{font:600 13px/1.4 var(--sans);margin-bottom:8px;padding:0}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips label{position:relative;margin:0;font:500 13px/1 var(--sans);border:1px solid #c9c2b2;border-radius:999px;padding:8px 12px;cursor:pointer;background:#fff}
.chips input{position:absolute;opacity:0;width:1px;height:1px}
.chips label:has(input:checked){background:var(--ink);border-color:var(--ink);color:#fff}
.chips label:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.hint{font:400 12.5px/1.5 var(--sans);color:var(--muted);margin:8px 0 0}
button{margin-top:20px;width:100%;padding:14px;font:700 13px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:#fff;background:var(--ink);border:0;border-radius:2px;cursor:pointer}
button:hover{background:var(--accent)}

/* Front page */
.hero{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:56px;padding:52px 0 48px;align-items:start}
.hero h1{font-size:clamp(38px,5.6vw,62px);line-height:1.02;letter-spacing:-.025em;margin-bottom:20px}
.hero .dek{max-width:34em}
.facts{display:flex;flex-wrap:wrap;gap:10px 28px;margin-top:26px;padding-top:16px;border-top:1px solid var(--rule)}
.facts div{font:500 13px/1.35 var(--sans);color:var(--muted)}
.facts strong{display:block;font:600 26px/1.1 var(--serif);color:var(--ink);letter-spacing:-.01em}
.signup{background:#fff;border:1px solid var(--rule);border-top:4px solid var(--ink);padding:26px 26px 22px}
.signup h2{font-size:26px;margin:0 0 6px}
.signup p{font-size:16px;color:var(--ink-2);margin:0}
.signup p.hint{font:400 12.5px/1.5 var(--sans);color:var(--muted);margin:10px 0 0}
.grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:56px;padding:0 0 56px}
.lead h2{font-size:clamp(28px,3.6vw,40px);line-height:1.1;margin:0 0 12px}
.lead h2 a{text-decoration:none}
.lead .dek{font-size:19px;margin:0 0 12px}
.lead .meta{margin-bottom:6px}
.stack .item{display:block;text-decoration:none;padding:0 0 16px;margin:0 0 16px;border-bottom:1px solid var(--rule)}
.stack .item:last-child{border-bottom:0}
.stack .item h3{font-size:19px;line-height:1.25;margin:4px 0 6px}
.stack .item p{font-size:15px;color:var(--ink-2);margin:0}
.stack .item:hover h3{color:var(--accent)}
.empty{font-style:italic;color:var(--muted)}

/* Docket: the meeting list */
.docket{list-style:none;margin:0;padding:0}
.docket>li{border-top:1px solid var(--rule)}
.docket>li:first-child{border-top:0}
.docket a{display:grid;grid-template-columns:92px minmax(0,1fr) auto;gap:4px 20px;padding:16px 0;text-decoration:none}
.docket .when{font:600 12px/1.35 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding-top:4px}
.docket .when b{display:block;font:600 24px/1.05 var(--serif);letter-spacing:-.01em;color:var(--ink);text-transform:none}
.docket h3{font-size:20px;line-height:1.25;margin:0 0 4px}
.docket a:hover h3{color:var(--accent)}
.docket .parts{list-style:none;margin:0 0 4px;padding:0;font:400 14px/1.5 var(--sans);color:var(--muted)}
.docket .headline{font-size:16px;color:var(--ink-2);margin:2px 0 0}
.state{display:inline-flex;align-items:center;gap:7px;font:600 11.5px/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);white-space:nowrap;padding-top:6px}
.state::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.state.work{color:#2b6577}.state.ready{color:#2c7a43}.state.done{color:var(--muted)}.state.stopped{color:var(--accent)}

/* How we report */
.method{counter-reset:step;list-style:none;margin:0;padding:0}
.method li{counter-increment:step;position:relative;padding:0 0 18px 44px;font-size:16px;line-height:1.5;color:var(--ink-2)}
.method li::before{content:counter(step);position:absolute;left:0;top:-4px;font:500 30px/1 var(--serif);color:var(--accent)}
.method b{display:block;color:var(--ink);font-weight:600}
.aside-note{font:400 13px/1.55 var(--sans);color:var(--muted);border-top:1px solid var(--rule);padding-top:14px;margin-top:6px}

/* Article */
.article{padding:48px 0 24px}
.article h1{font-size:clamp(34px,5vw,50px);line-height:1.06;letter-spacing:-.02em}
.byline{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font:500 13px/1.5 var(--sans);color:var(--muted);padding:12px 0;margin:18px 0 28px;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.byline a{color:var(--accent);font-weight:600;text-decoration:none}
.article .parts{list-style:none;margin:-4px 0 0;padding:0;font:400 15px/1.55 var(--sans);color:var(--muted)}
.body > p:first-of-type{font-size:21px;line-height:1.5}
.body > p:first-of-type::first-letter{float:left;font:600 64px/.84 var(--serif);padding:6px 10px 0 0;color:var(--ink)}
.body h2{font:700 12px/1.3 var(--sans);letter-spacing:.14em;text-transform:uppercase;border-top:1px solid var(--rule-strong);padding-top:10px;margin:40px 0 16px}
.body ul{padding-left:0;margin:0;list-style:none}
.body li{position:relative;padding-left:20px;margin:0 0 14px}
.body li::before{content:"";position:absolute;left:2px;top:.72em;width:6px;height:6px;background:var(--accent)}
.body a{color:var(--accent)}
.ts{font:600 12.5px/1 var(--sans);font-variant-numeric:tabular-nums;color:var(--muted);text-decoration:none;white-space:nowrap}
.ts:hover{color:var(--accent)}
.notice{margin-top:40px;padding:18px 20px;background:var(--wash);border-left:3px solid var(--ink);font:400 14px/1.6 var(--sans);color:var(--ink-2)}
.notice strong{display:block;font-weight:700;font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px;color:var(--ink)}
.status-line{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px}
.status-line .muted{font:400 14px/1.5 var(--sans);margin:0}
.transcript{margin-top:44px}
.transcript p{display:grid;grid-template-columns:76px minmax(0,1fr);gap:12px;font:400 15px/1.6 var(--sans);color:var(--ink-2);margin:0 0 12px}
.transcript .who{font:600 12px/1.6 var(--sans);color:var(--muted);font-variant-numeric:tabular-nums}

/* Notes search and legacy lists */
.hits .hit{display:block;text-decoration:none;color:inherit;border-top:1px solid var(--rule);padding:18px 0}
.hits .hit:first-child{border-top:0;padding-top:4px}
.hit h2{font-size:22px;line-height:1.22;margin:2px 0 8px}
.hit p{margin:0;font:400 15px/1.55 var(--sans);color:var(--ink-2)}
.hit:hover h2{color:var(--accent)}
.search{display:grid;grid-template-columns:minmax(0,1fr) 200px auto;gap:10px;align-items:end;margin:8px 0 8px}
.search label{margin:0 0 6px}.search button{margin:0;width:auto;padding:14px 22px}

footer.site{border-top:1px solid var(--rule-strong);margin-top:24px;padding:22px 24px 40px;font:400 13px/1.6 var(--sans);color:var(--muted);text-align:center}
footer.site a{color:var(--ink)}

@media (max-width:860px){
  .hero,.grid{grid-template-columns:minmax(0,1fr);gap:36px}
  .hero{padding:32px 0 36px}
  .topline span:nth-child(1),.topline span:nth-child(3){display:none}.topline{justify-content:center}
  .search{grid-template-columns:minmax(0,1fr)}.search button{width:100%}
}
@media (max-width:520px){
  .wrap{padding:0 16px}
  .docket a{grid-template-columns:minmax(0,1fr) auto}
  .docket .when{grid-column:1 / -1;padding:0}.docket .when b{display:inline;font-size:15px;font-family:var(--sans);margin:0 5px}
  .transcript p{grid-template-columns:minmax(0,1fr);gap:2px}
}
`;

function today(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: config.timezone });
}

function masthead(compact: boolean): string {
  return `<header class="masthead${compact ? ' compact' : ''}">
<div class="topline"><span>${esc(today())}</span><span>Ketchikan Gateway Borough, Alaska</span><span>Independent · Free</span></div>
<div class="nameplate"><a href="/">${esc(config.newsletterName)}</a></div>
<div class="tagline">Plain-language reporting on the Borough's public meetings</div>
<nav class="sections" aria-label="Sections"><a href="/">Front page</a><a href="/notes">Recaps</a><a href="/#docket">The docket</a><a href="/#subscribe">Subscribe</a></nav>
</header>`;
}

export interface Seo {
  /** Search-result snippet, ~155 characters. */
  description?: string;
  /** Path of the preferred URL for this content, e.g. /notes/abc/assembly-approves-harbor-bond. */
  canonical?: string;
  /** Drafts and admin screens stay out of search engines. */
  noindex?: boolean;
  /** schema.org object, emitted as JSON-LD. */
  jsonLd?: Record<string, unknown>;
  ogType?: 'website' | 'article';
}

function baseUrl(): string {
  try {
    return config.publicBaseUrl;
  } catch {
    return '';
  }
}

function seoTags(title: string, seo: Seo): string {
  const base = baseUrl();
  const url = seo.canonical && base ? `${base}${seo.canonical}` : '';
  const tags = [
    seo.description ? `<meta name="description" content="${esc(seo.description)}">` : '',
    seo.noindex ? '<meta name="robots" content="noindex">' : '',
    url ? `<link rel="canonical" href="${esc(url)}">` : '',
    `<meta property="og:site_name" content="${esc(config.newsletterName)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:type" content="${seo.ogType ?? 'website'}">`,
    seo.description ? `<meta property="og:description" content="${esc(seo.description)}">` : '',
    url ? `<meta property="og:url" content="${esc(url)}">` : '',
    '<meta name="twitter:card" content="summary">',
    // "<" is escaped so a headline can never close the script element.
    seo.jsonLd ? `<script type="application/ld+json">${JSON.stringify(seo.jsonLd).replace(/</g, '\\u003c')}</script>` : '',
  ];
  return tags.filter(Boolean).join('\n');
}

/** Full document: masthead, the page's own main element, footer. */
function shell(title: string, main: string, opts: { compact?: boolean; seo?: Seo } = {}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(title)}</title>
${seoTags(title, opts.seo ?? {})}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${CSS}</style></head><body>
${masthead(opts.compact ?? true)}
${main}
<footer class="site">An independent public service. Not an official Ketchikan Gateway Borough publication.<br>Recaps are written with AI from the Borough's own recordings and reviewed before they're published. <a href="/notes">Read every recap</a>.</footer>
</body></html>`;
}

/** A simple centered page for forms, confirmations and admin screens. Not indexed. */
export function page(title: string, inner: string, wide = false, below = ''): string {
  return shell(
    `${title} · ${config.newsletterName}`,
    `<main class="wrap" style="max-width:${wide ? '760px' : '560px'}"><div class="sheet">${inner}</div>${below}</main>`,
    { seo: { noindex: true } },
  );
}

/** "assembly-approves-4m-harbor-bond" for readable, keyword-bearing URLs. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+[^-]*$/, (m) => (m.length > 20 ? '' : m));
}

export function noteHref(id: string, headline: string): string {
  const slug = slugify(headline);
  return `/notes/${encodeURIComponent(id)}${slug ? `/${slug}` : ''}`;
}

/** First sentences of a summary, cut to fit a search snippet. */
export function describe(text: string, max = 158): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const sentence = cut.lastIndexOf('. ');
  return sentence > 80 ? cut.slice(0, sentence + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/** "Ketchikan Assembly" / "Ketchikan School Board": the place name people search with. */
function placeBody(body: string): string {
  return body === 'Other' ? 'Ketchikan Gateway Borough' : `Ketchikan ${body}`;
}

export interface AdminMeetingRow {
  id: string;
  title: string;
  body: string;
  date: string;
  status: string;
  error: string | null;
  hasTranscript: boolean;
  hasAnalysis: boolean;
  approveHref?: string;
}

/** Staff list. A transcript link means transcription finished, with or without Resend. */
export function adminMeetingsPage(rows: AdminMeetingRow[]): string {
  const list = rows.length
    ? `<div class="hits">${rows
        .map((m) => {
          const links = [
            m.hasTranscript ? `<a href="/admin/meetings/${esc(m.id)}/transcript">Transcript</a>` : '',
            m.hasAnalysis ? `<a href="/admin/meetings/${esc(m.id)}/preview">Recap</a>` : '',
            m.approveHref ? `<a href="${esc(m.approveHref)}">Approve</a>` : '',
          ].filter(Boolean);
          return `<div class="hit"><div class="kicker">${esc(m.body)}${m.date ? ` · ${esc(m.date)}` : ''} · ${esc(m.status)}</div><h2>${esc(m.title)}</h2>${m.error ? `<p>${esc(m.error)}</p>` : ''}${links.length ? `<p>${links.join(' · ')}</p>` : ''}</div>`;
        })
        .join('')}</div>`
    : '<p class="muted">No meetings yet. Discovery adds them from the archive.</p>';
  return page(
    'Meetings',
    `<h1>Meetings</h1><p>A transcript link means that meeting has been transcribed. Email can wait until Resend is connected.</p>${list}`,
    true,
  );
}

export function adminTranscriptPage(
  meeting: { id: string; title: string; body: string; meetingDate: Date | null },
  provider: string,
  segments: { start?: number; speaker?: string; text?: string }[],
): string {
  const lines = segments
    .map((s) => {
      const who = typeof s.speaker === 'string' && s.speaker ? `${esc(s.speaker)} · ` : '';
      return `<p><span class="kicker">${who}${hms(Number(s.start) || 0)}</span><br>${esc(s.text)}</p>`;
    })
    .join('');
  return page(
    meeting.title,
    `<div class="kicker">${esc(meeting.body)}${meeting.meetingDate ? ` · ${esc(formatDate(meeting.meetingDate))}` : ''} · ${esc(provider)} · ${segments.length} lines</div>
<h1>${esc(meeting.title)}</h1>
<p><a href="/admin/meetings">All meetings</a></p>
${lines || '<p class="muted">This transcript is empty.</p>'}`,
    true,
  );
}

export function bodyCheckboxes(selected: string[] = []): string {
  return `<fieldset><legend>Which meetings?</legend><div class="chips">
${BODIES.map(
  (b) => `<label><input type="checkbox" name="bodies" value="${esc(b.name)}"${selected.includes(b.name) ? ' checked' : ''}>${esc(b.name)}</label>`,
).join('')}</div><p class="hint">Leave them all off to get every meeting.</p></fieldset>`;
}

export interface NoteHit {
  id: string;
  title: string;
  body: string;
  date: string;
  headline: string;
  snippet: string;
}

export function hitList(hits: NoteHit[]): string {
  if (!hits.length) return '';
  return `<div class="hits">${hits
    .map(
      (h) => `<a class="hit" href="${esc(noteHref(h.id, h.headline))}"><div class="kicker">${esc(h.body)}${h.date ? ` <span class="meta" style="text-transform:none;letter-spacing:0;font-weight:500">· ${esc(h.date)}</span>` : ''}</div><h2>${esc(h.headline)}</h2><p>${h.snippet}</p></a>`,
    )
    .join('')}</div>`;
}

// Short labels in one voice; the tone picks the dot color.
const STATUS: Record<string, { label: string; tone: 'work' | 'ready' | 'done' | 'stopped' }> = {
  DISCOVERED: { label: 'Queued', tone: 'work' },
  RESEARCHING: { label: 'Researching', tone: 'work' },
  DOWNLOADING: { label: 'Downloading', tone: 'work' },
  TRANSCRIBING: { label: 'Transcribing', tone: 'work' },
  ANALYZING: { label: 'Writing recap', tone: 'work' },
  AWAITING_APPROVAL: { label: 'Draft ready', tone: 'ready' },
  SENDING: { label: 'Emailing', tone: 'done' },
  SENT: { label: 'Published', tone: 'done' },
  PUBLISHED: { label: 'Published', tone: 'done' },
  FAILED: { label: 'Not finished', tone: 'stopped' },
  SKIPPED: { label: 'Not transcribed', tone: 'done' },
};

function pill(status: string): string {
  const s = STATUS[status] ?? { label: status, tone: 'done' as const };
  return `<span class="state ${s.tone}">${esc(s.label)}</span>`;
}

/** What a resident sees about a meeting's state. Internal errors stay on the admin pages. */
function publicStatusNote(status: string, hasDigest: boolean, approved: boolean): string {
  if (status === 'FAILED') return "Processing stopped before it finished. It's retried automatically.";
  if (hasDigest && !approved) return "Draft recap. It hasn't been reviewed yet.";
  if (STATUS[status]?.tone === 'work') return 'This page fills in when transcription finishes.';
  return '';
}

/** Agenda-style items from the archive title, beyond the body name and date. */
function partsList(title: string, body: string): string {
  const parts = meetingParts(title, body);
  return parts.length ? `<ul class="parts">${parts.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
}

export interface WorkHit {
  id: string;
  title: string;
  body: string;
  /** "Wed, Oct 21, 2026" */
  date: string;
  status: string;
  /** The recap headline, once there is one. */
  headline: string;
  /** First paragraph of the recap. */
  summary: string;
}

/** "Wed, Oct 21, 2026" → weekday + "Oct 21" for the docket's date column. */
function docketDate(date: string): string {
  const m = date.match(/^(\w+), (\w+ \d+), (\d{4})$/);
  return m ? `${esc(m[1])}<b>${esc(m[2])}</b>${esc(m[3])}` : `<b>${esc(date || '—')}</b>`;
}

export function workList(hits: WorkHit[]): string {
  if (!hits.length) return '';
  return `<ul class="docket">${hits
    .map(
      (h) => `<li><a href="/meetings/${esc(h.id)}"><div class="when">${docketDate(h.date)}</div>
<div><h3>${esc(h.body)}</h3>${partsList(h.title, h.body)}${h.headline ? `<p class="headline">${esc(h.headline)}</p>` : ''}</div>${pill(h.status)}</a></li>`,
    )
    .join('')}</ul>`;
}

const METHOD = `<ol class="method">
<li><b>Recorded</b>Every meeting the Borough posts to its video archive.</li>
<li><b>Transcribed</b>Word for word, with each point linked to its moment in the video.</li>
<li><b>Checked</b>Names and item numbers against the Borough's roster and agenda, with context from local news.</li>
<li><b>Reviewed</b>A person reads each recap before it's published or emailed.</li>
</ol>
<p class="aside-note">Recaps are written with AI and can contain mistakes. Every item links to the recording so you can hear it yourself.</p>`;

export const signupPage = (recent: NoteHit[], work: WorkHit[], archiveCount: number, sinceLabel: string) => {
  // Lead with the newest reviewed recap; fall back to the newest draft so the page is never empty.
  const draft = work.find((w) => w.headline);
  const lead = recent[0]
    ? { href: noteHref(recent[0].id, recent[0].headline), body: recent[0].body, date: recent[0].date, headline: recent[0].headline, dek: recent[0].snippet, draft: false }
    : draft
      ? { href: `/meetings/${draft.id}`, body: draft.body, date: draft.date, headline: draft.headline, dek: esc(describe(draft.summary, 260)), draft: true }
      : null;
  const more = recent.slice(1, 5);
  const title = `${config.newsletterName}: Ketchikan Assembly, School Board and Planning Commission meetings in plain language`;
  const description =
    'What the Ketchikan Gateway Borough Assembly, School Board and Planning Commission decided, debated and heard from residents, written in plain language and linked to the meeting video.';

  const leadHtml = lead
    ? `<article class="lead"><div class="kicker">${lead.draft ? 'Draft · ' : 'Latest · '}${esc(lead.body)}</div>
<h2><a href="${esc(lead.href)}">${esc(lead.headline)}</a></h2>
<p class="dek">${lead.dek}</p>
<p class="meta">${esc(lead.date)}${lead.draft ? ' · Not yet reviewed' : ''}</p>
<a class="more" href="${esc(lead.href)}">Read the recap →</a></article>`
    : `<article class="lead"><p class="empty">The first recap appears here as soon as a meeting has been transcribed.</p></article>`;

  const moreHtml = more.length
    ? `<div class="stack">${more
        .map(
          (h) => `<a class="item" href="${esc(noteHref(h.id, h.headline))}"><div class="kicker">${esc(h.body)}</div><h3>${esc(h.headline)}</h3><p class="meta">${esc(h.date)}</p></a>`,
        )
        .join('')}</div>`
    : `<p class="empty">Earlier recaps will collect here.</p>`;

  const docketIntro = archiveCount
    ? `<p class="muted">${archiveCount.toLocaleString('en-US')} meetings on the Borough's video archive. Everything since ${esc(sinceLabel)} is transcribed, newest first.</p>`
    : '<p class="muted">No meetings recorded yet. The archive is checked every few hours.</p>';

  return shell(
    title,
    `<main class="wrap">
<section class="hero">
  <div>
    <div class="kicker">Ketchikan Gateway Borough · Public meetings</div>
    <h1>Every public meeting, reported in plain language.</h1>
    <p class="dek">What passed, what was debated, what residents said, and what comes next. Written from the official recording, checked against the agenda, and linked to the exact moment in the video.</p>
    <div class="facts">
      <div><strong>${archiveCount.toLocaleString('en-US')}</strong>meetings on the record</div>
      <div><strong>Assembly</strong>School Board, Planning &amp; more</div>
      <div><strong>Free</strong>no ads, unsubscribe anytime</div>
    </div>
  </div>
  <aside class="signup" id="subscribe">
    <h2>Get the recap</h2>
    <p>One email after each meeting, usually the next day.</p>
    <form method="post" action="/subscribe">
      <label for="email">Email address</label><input id="email" type="email" name="email" required autocomplete="email" placeholder="you@example.com">
      ${bodyCheckboxes()}
      <button type="submit">Subscribe</button>
    </form>
    <p class="hint">Confirm by email. One-click unsubscribe in every message.</p>
  </aside>
</section>

<section class="grid">
  <div><h2 class="rubric">Latest</h2>${leadHtml}</div>
  <div><h2 class="rubric">More recaps <a href="/notes">All →</a></h2>${moreHtml}</div>
</section>

<section class="grid">
  <div id="docket"><h2 class="rubric">The docket</h2>${docketIntro}${workList(work)}</div>
  <aside><h2 class="rubric">How we report</h2>${METHOD}</aside>
</section>
</main>`,
    {
      compact: false,
      seo: {
        description,
        canonical: '/',
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: config.newsletterName,
          description,
          ...(baseUrl() ? { url: `${baseUrl()}/` } : {}),
          about: { '@type': 'AdministrativeArea', name: 'Ketchikan Gateway Borough, Alaska' },
        },
      },
    },
  );
};

export function notesSearchPage(q: string, body: string, hits: NoteHit[]): string {
  const options = ['<option value="">Every body</option>'].concat(
    BODIES.map((b) => `<option value="${esc(b.name)}"${b.name === body ? ' selected' : ''}>${esc(b.name)}</option>`),
  );
  const list = hits.length
    ? hitList(hits)
    : `<p class="empty">${q ? `Nothing in the published recaps matches “${esc(q)}”.` : 'No published recaps yet. Meetings being transcribed are on the <a href="/#docket">front page</a>.'}</p>`;
  const count = hits.length ? `${hits.length} ${hits.length === 1 ? 'recap' : 'recaps'}${q ? ` matching “${esc(q)}”` : ''}` : '';
  const scope = body ? placeBody(body) : 'Ketchikan Gateway Borough';
  const title = q ? `“${q}” in ${scope} meeting recaps` : `${scope} meeting recaps`;
  return shell(
    `${title} · ${config.newsletterName}`,
    `<main class="wrap" style="max-width:820px"><div class="article">
<div class="kicker">Archive</div>
<h1>${esc(title)}</h1>
<p class="dek">Every reviewed recap, newest first. Search for a street, a project, an ordinance, or a name.</p>
<form method="get" action="/notes" class="search" role="search">
<div><label for="q">Search</label><input id="q" type="search" name="q" value="${esc(q)}" placeholder="harbor, budget, ordinance…"></div>
<div><label for="body">Meetings</label><select id="body" name="body">${options.join('')}</select></div>
<button type="submit">Search</button></form>
<h2 class="rubric" style="margin-top:34px">${q ? 'Results' : 'Most recent'}${count ? ` <span class="meta" style="letter-spacing:0;text-transform:none">${count}</span>` : ''}</h2>
${list}</div></main>`,
    {
      seo: {
        description: `Plain-language recaps of ${scope} public meetings: decisions, votes, public comment and what's coming up, linked to the meeting video.`,
        canonical: q ? undefined : `/notes${body ? `?body=${encodeURIComponent(body)}` : ''}`,
        noindex: Boolean(q),
      },
    },
  );
}

export function transcriptHtml(segments: { start?: number; speaker?: string; text?: string }[] | null | undefined): string {
  if (!segments?.length) return '';
  return `<section class="transcript"><h2 class="rubric">Transcript</h2>${segments
    .map((s) => {
      const who = typeof s.speaker === 'string' && s.speaker ? `${esc(s.speaker)}<br>` : '';
      return `<p><span class="who">${who}${hms(Number(s.start) || 0)}</span><span>${esc(s.text)}</span></p>`;
    })
    .join('')}</section>`;
}

type MeetingInfo = { id: string; title: string; body: string; meetingDate: Date | null; sourceUrl: string; platform: string };

export function meetingPage(
  meeting: MeetingInfo & { status: string; error: string | null },
  digest: MeetingDigest | null,
  approved: boolean,
  segments: { start?: number; speaker?: string; text?: string }[],
): string {
  const note = publicStatusNote(meeting.status, Boolean(digest), approved);
  const banner = `<div class="status-line">${pill(meeting.status)}${note ? `<p class="muted">${esc(note)}</p>` : ''}</div>`;
  const transcript = transcriptHtml(segments);
  // A reviewed recap has its own canonical page; drafts stay out of search.
  if (digest) return noteDetailPage(meeting, digest, { banner, after: transcript, draft: !approved });
  const date = formatDate(meeting.meetingDate);
  return shell(
    `${placeBody(meeting.body)} meeting${date ? `, ${date}` : ''} · ${config.newsletterName}`,
    `<main class="wrap" style="max-width:720px"><article class="article">
${banner}<div class="kicker">${esc(meeting.body)}</div>
<h1>${esc(placeBody(meeting.body))} meeting</h1>
${partsList(meeting.title, meeting.body)}
<div class="byline"><span>${esc(date || 'Date unknown')}</span><a href="${esc(meeting.sourceUrl)}">Watch the recording</a></div>
${transcript || '<p class="empty">No transcript yet.</p>'}
</article></main>`,
    { seo: { noindex: true } },
  );
}

export function noteDetailPage(
  meeting: MeetingInfo,
  d: MeetingDigest,
  opts: { banner?: string; after?: string; draft?: boolean } = {},
): string {
  const ts = (t: number) =>
    `<a class="ts" href="${esc(timestampUrl(meeting.sourceUrl, meeting.platform, t))}">▶ ${hms(t)}</a>`;
  const h2 = (s: string) => `<h2>${esc(s)}</h2>`;
  const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '');
  const actions = (d.actions ?? []).filter((a) => a && (a.item || a.outcome));
  const discussion = (d.discussion ?? []).filter((x) => x && (x.topic || x.gist));
  const comments = (d.publicComment ?? []).filter((x) => x && (x.who || x.topic || x.gist));
  const upcoming = (d.upcoming ?? []).filter((x) => x && x.item);
  const background = (d.background ?? []).filter((x) => x && x.point);
  const fixes = (d.nameCorrections ?? []).filter((x) => x && x.heard && x.corrected);
  const sections = [
    String(d.summary ?? '')
      .split(/\n\s*\n/)
      .map((p) => `<p>${esc(p.trim())}</p>`)
      .join(''),
    actions.length
      ? h2('What they decided') +
        list(actions.map((a) => `<strong>${esc(a.item)}</strong> — ${esc(a.outcome)}${a.vote ? ` (${esc(a.vote)})` : ''} ${ts(a.t)}`))
      : '',
    discussion.length
      ? h2('Also discussed') + list(discussion.map((x) => `<strong>${esc(x.topic)}.</strong> ${esc(x.gist)} ${ts(x.t)}`))
      : '',
    comments.length
      ? h2('What residents said') +
        list(comments.map((x) => `<strong>${esc(x.who)}</strong>, on ${esc(x.topic)}: ${esc(x.gist)} ${ts(x.t)}`))
      : '',
    upcoming.length
      ? h2('Coming up') + list(upcoming.map((x) => `${esc(x.item)}${x.when ? ` — <strong>${esc(x.when)}</strong>` : ''}`))
      : '',
    background.length
      ? h2('Background from local news') +
        list(background.map((x) => `${esc(x.point)} ${(x.sources ?? []).map((u) => `<a href="${esc(u)}">${esc(sourceLabel(u))}</a>`).join(' · ')}`))
      : '',
  ].join('');
  const caveats = [
    ...(Array.isArray(d.caveats) ? d.caveats.filter((c) => typeof c === 'string') : []),
    ...(fixes.length
      ? [`Names corrected from the transcript using the Borough's published spelling: ${fixes.map((f) => `"${f.heard}" → ${f.corrected}`).join(', ')}.`]
      : []),
  ];
  const date = formatDate(meeting.meetingDate);
  const short = meeting.meetingDate ? shortDate(meeting.meetingDate, false) : '';
  // Headline first for search results, then the place and date people search with.
  const title = `${d.headline} | ${placeBody(meeting.body)}${short ? `, ${short}` : ''}`;
  const canonical = noteHref(meeting.id, d.headline);
  const description = describe(d.summary);
  const base = baseUrl();
  return shell(
    title,
    `<main class="wrap" style="max-width:720px"><article class="article">
${opts.banner ?? ''}<div class="kicker">${esc(placeBody(meeting.body))}</div>
<h1>${esc(d.headline)}</h1>
${partsList(meeting.title, meeting.body)}
<div class="byline"><span>${esc(date ? `Meeting of ${date}` : 'Meeting date unknown')}</span><a href="${esc(meeting.sourceUrl)}">Watch the recording</a>${opts.draft ? '' : `<a href="/notes">More recaps</a>`}</div>
<div class="body">${sections}</div>
<div class="notice"><strong>How this was made</strong>Written with AI from the Borough's recording and an automated transcript${opts.draft ? '' : ', then reviewed by a person'}. Names, numbers and votes can be misheard; use the ▶ links to check the video.${caveats.length ? `<br><br>${caveats.map(esc).join('<br>')}` : ''}</div>
${opts.after ?? ''}
</article></main>`,
    {
      seo: {
        description,
        canonical,
        noindex: opts.draft,
        ogType: 'article',
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          headline: d.headline.slice(0, 110),
          description,
          ...(meeting.meetingDate ? { datePublished: meeting.meetingDate.toISOString().slice(0, 10) } : {}),
          ...(base ? { url: `${base}${canonical}`, mainEntityOfPage: `${base}${canonical}` } : {}),
          author: { '@type': 'Organization', name: config.newsletterName },
          publisher: { '@type': 'Organization', name: config.newsletterName },
          about: {
            '@type': 'Event',
            name: `${placeBody(meeting.body)} meeting`,
            ...(meeting.meetingDate ? { startDate: meeting.meetingDate.toISOString().slice(0, 10) } : {}),
            location: { '@type': 'Place', name: 'Ketchikan, Alaska' },
          },
          isBasedOn: meeting.sourceUrl,
        },
      },
    },
  );
}
