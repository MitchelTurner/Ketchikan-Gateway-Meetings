import { config } from '../config';
import { sourceLabel, timestampUrl } from '../email/render';
import { MeetingDigest } from '../analysis/analysis.service';
import type { DeepDiveArticle } from '../topics/deep-dive.service';
import { BODIES, esc, formatDate, hms, meetingParts, shortDate, slugify } from '../util';

export { slugify };

const FONTS =
  'https://fonts.googleapis.com/css2?family=Libre+Caslon+Display&family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&family=Limelight&family=Public+Sans:wght@400;500;600;700&display=swap';

// A magazine page for a rain coast: fog-white paper, cold ink, cedar-bark red for
// rubrics, spruce and tide-slate in the drawings. Light only.
const CSS = `
:root{--paper:#f9f8f4;--ink:#16191a;--ink-2:#3a4042;--muted:#6b7275;--rule:#d8dbd6;--rule-strong:#16191a;--accent:#a3372a;--spruce:#24463b;--tide:#4f6772;--wash:#eef0ec;
--display:'Limelight','Libre Caslon Display',Georgia,serif;--head:'Libre Caslon Display',Georgia,'Times New Roman',serif;--serif:'Libre Caslon Text',Georgia,'Times New Roman',serif;
--sans:'Public Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.65 var(--serif)}
a{color:inherit;text-decoration-color:var(--rule);text-underline-offset:3px}
a:hover{color:var(--accent);text-decoration-color:currentColor}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.narrow{max-width:680px}

/* Masthead */
.masthead{border-bottom:1px solid var(--rule)}
.topline{display:flex;justify-content:space-between;gap:16px;max-width:1120px;margin:0 auto;padding:12px 24px 0;font:500 11.5px/1.4 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.nameplate{text-align:center;padding:22px 24px 0}
.nameplate a{font:400 clamp(40px,7.4vw,84px)/1 var(--display);letter-spacing:.005em;text-decoration:none;color:var(--ink)}
.nameplate a:hover{color:var(--ink)}
.tagline{text-align:center;font:italic 400 16px/1.4 var(--serif);color:var(--ink-2);padding:12px 24px 0}
.vista{display:block;width:100%;max-width:1120px;height:auto;margin:6px auto 0;padding:0 24px;color:var(--ink)}
.masthead.compact .topline,.masthead.compact .tagline,.masthead.compact .vista{display:none}
.masthead.compact .nameplate{padding:18px 24px 14px}.masthead.compact .nameplate a{font-size:clamp(28px,4.2vw,40px)}
.sections{display:flex;justify-content:center;flex-wrap:wrap;gap:6px 30px;padding:12px 24px;border-top:1px solid var(--rule);font:600 11.5px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase}
.masthead.compact .sections{border-top:1px solid var(--rule)}
.sections a{text-decoration:none;color:var(--ink-2)}.sections a:hover{color:var(--accent)}

/* Type */
h1,h2,h3{font-family:var(--head);font-weight:400;letter-spacing:-.005em;margin:0}
h1{font-size:clamp(34px,5vw,52px);line-height:1.08;margin:0 0 14px}
p{margin:0 0 16px}
.kicker{font:400 15px/1.3 var(--display);letter-spacing:.02em;color:var(--accent);margin-bottom:10px}
.meta{font:500 12.5px/1.5 var(--sans);letter-spacing:.02em;color:var(--muted)}
.muted{color:var(--muted);font-size:15px}
.dek{font:italic 400 20px/1.5 var(--serif);color:var(--ink-2)}
.rubric{display:flex;align-items:center;gap:16px;margin:0 0 22px;font:400 20px/1.2 var(--display);color:var(--accent);letter-spacing:.01em}
.rubric::before,.rubric::after{content:"";flex:1;height:1px;background:var(--rule-strong)}
.rubric a{order:3;font:600 11px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);text-decoration:none}
.rubric a:hover{color:var(--accent)}
.more{font:600 11.5px/1.4 var(--sans);letter-spacing:.12em;text-transform:uppercase;text-decoration:none;color:var(--accent)}
mark{background:#e6ece3;padding:0 2px}

/* Generic page body */
.sheet{padding:44px 0 8px}
.sheet h2{font-size:24px;margin:30px 0 10px}
.sheet h2.section{font:600 11.5px/1.3 var(--sans);letter-spacing:.14em;text-transform:uppercase;border-top:1px solid var(--rule-strong);padding-top:10px;margin:36px 0 14px}

/* Forms */
label{display:block;font:600 12.5px/1.4 var(--sans);letter-spacing:.02em;margin:18px 0 6px}
input[type=email],input[type=search],select{width:100%;padding:12px 14px;font:16px/1.3 var(--sans);border:0;border-bottom:1px solid var(--ink);border-radius:0;background:transparent;color:inherit}
select{border:1px solid var(--rule);background:#fff}
input:focus,select:focus,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
fieldset{border:0;padding:0;margin:20px 0 0}legend{font:600 12.5px/1.4 var(--sans);margin-bottom:8px;padding:0}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips label{position:relative;margin:0;font:500 13px/1 var(--sans);border:1px solid var(--rule);border-radius:999px;padding:8px 13px;cursor:pointer;background:#fff;letter-spacing:0}
.chips input{position:absolute;opacity:0;width:1px;height:1px}
.chips label:has(input:checked){background:var(--spruce);border-color:var(--spruce);color:#fff}
.chips label:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.hint{font:400 12.5px/1.5 var(--sans);color:var(--muted);margin:8px 0 0}
button{margin-top:22px;width:100%;padding:15px;font:600 12px/1 var(--sans);letter-spacing:.16em;text-transform:uppercase;color:#fff;background:var(--ink);border:0;border-radius:0;cursor:pointer}
button:hover{background:var(--accent)}

/* Front page */
.hero{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:64px;padding:48px 0 52px;align-items:start}
.hero h1{font-size:clamp(40px,5.8vw,66px);line-height:1.02;letter-spacing:-.012em;margin-bottom:20px}
.hero .dek{max-width:32em}
.facts{display:flex;flex-wrap:wrap;gap:10px 34px;margin-top:28px;padding-top:16px;border-top:1px solid var(--rule)}
.facts div{font:500 12.5px/1.35 var(--sans);color:var(--muted)}
.facts strong{display:block;font:400 28px/1.1 var(--head);color:var(--ink)}
.signup{background:var(--paper);border:1px solid var(--ink);padding:28px 28px 24px;text-align:left}
.signup h2{font:400 30px/1.1 var(--display);color:var(--ink);margin:0 0 8px;text-align:center}
.signup p{font:italic 400 16px/1.5 var(--serif);color:var(--ink-2);margin:0;text-align:center}
.signup p.hint{font:400 12.5px/1.5 var(--sans);color:var(--muted);margin:12px 0 0;text-align:center}
.grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:64px;padding:0 0 60px}
.lead{text-align:center;padding:0 4%}
.lead h2{font-size:clamp(30px,3.8vw,44px);line-height:1.1;margin:0 0 14px}
.lead h2 a{text-decoration:none}
.lead .dek{font-size:19px;margin:0 0 14px}
.lead .meta{margin-bottom:12px;text-transform:uppercase;letter-spacing:.1em;font-size:11.5px}
.stack .item{display:block;text-decoration:none;padding:0 0 18px;margin:0 0 18px;border-bottom:1px solid var(--rule)}
.stack .item:last-child{border-bottom:0}
.stack .item .kicker{font-size:13.5px;margin-bottom:4px}
.stack .item h3{font:400 21px/1.22 var(--head);margin:2px 0 6px}
.stack .item p{font-size:15px;color:var(--ink-2);margin:0}
.stack .item:hover h3{color:var(--accent)}
.empty{font-style:italic;color:var(--muted)}

/* Docket: the meeting list */
.docket{list-style:none;margin:0;padding:0}
.docket>li{border-top:1px solid var(--rule)}
.docket>li:first-child{border-top:0}
.docket a{display:grid;grid-template-columns:92px minmax(0,1fr) auto;gap:4px 22px;padding:18px 0;text-decoration:none}
.docket .when{font:600 11px/1.4 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding-top:4px}
.docket .when b{display:block;font:400 25px/1.05 var(--head);letter-spacing:0;color:var(--ink);text-transform:none}
.docket h3{font:400 22px/1.2 var(--head);margin:0 0 4px}
.docket a:hover h3{color:var(--accent)}
.docket .parts{list-style:none;margin:0 0 4px;padding:0;font:400 13.5px/1.5 var(--sans);color:var(--muted)}
.docket .headline{font:italic 400 16px/1.45 var(--serif);color:var(--ink-2);margin:2px 0 0}
.state{display:inline-flex;align-items:center;gap:7px;font:600 10.5px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);white-space:nowrap;padding-top:6px}
.state::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.state.work{color:var(--tide)}.state.ready{color:var(--spruce)}.state.done{color:var(--muted)}.state.stopped{color:var(--accent)}

/* How we report */
.timeline{list-style:none;margin:0;padding:0}
.timeline li{position:relative;padding:0 0 22px 22px;border-left:1px solid var(--rule);margin-left:4px}
.timeline li::before{content:"";position:absolute;left:-5px;top:7px;width:9px;height:9px;transform:rotate(45deg);background:var(--paper);border:1px solid var(--muted)}
.timeline li.milestone{border-left-color:var(--accent)}.timeline li.milestone::before{background:var(--accent);border-color:var(--accent)}
.timeline p{margin:4px 0 0;font-size:17px}.timeline p.meta{font-size:12.5px}.timeline .meta a{color:var(--accent)}
.method{counter-reset:step;list-style:none;margin:0;padding:0}
.method li{counter-increment:step;position:relative;padding:0 0 18px 44px;font-size:16px;line-height:1.5;color:var(--ink-2)}
.method li::before{content:counter(step);position:absolute;left:0;top:-6px;font:400 32px/1 var(--display);color:var(--accent)}
.method b{display:block;color:var(--ink);font-weight:700}
.aside-note{font:italic 400 14px/1.6 var(--serif);color:var(--muted);border-top:1px solid var(--rule);padding-top:14px;margin-top:6px}

/* Article */
.article{padding:52px 0 24px}
.article > .kicker,.article > h1,.article > .dek,.article > .parts,.article > .status-line{text-align:center;justify-content:center}
.article h1{font-size:clamp(36px,5.4vw,58px);line-height:1.06;letter-spacing:-.01em;margin-bottom:16px}
.article > .kicker{font-size:18px}
.byline{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 18px;align-items:center;font:600 11px/1.5 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);padding:0;margin:22px 0 34px}
.byline a{color:var(--accent);text-decoration:none}
.article .parts{list-style:none;margin:-2px 0 0;padding:0;font:italic 400 16px/1.55 var(--serif);color:var(--ink-2)}
.body{font-size:18.5px;line-height:1.7}
.body > p:first-of-type::first-letter{float:left;font:400 82px/.78 var(--head);padding:8px 10px 0 0;color:var(--ink)}
.body h2{display:flex;align-items:center;gap:14px;font:400 19px/1.3 var(--display);color:var(--accent);margin:46px 0 18px}
.body h2::after{content:"";flex:1;height:1px;background:var(--rule)}
.body ul{padding-left:0;margin:0;list-style:none}
.body li{position:relative;padding-left:22px;margin:0 0 14px}
.body li::before{content:"";position:absolute;left:3px;top:.72em;width:6px;height:6px;transform:rotate(45deg);background:var(--spruce)}
.body a{color:var(--accent)}
.body > p:last-child::after,.body > ul:last-child > li:last-child::after{content:"";display:inline-block;width:11px;height:14px;margin-left:8px;vertical-align:-1px;background:var(--spruce);clip-path:polygon(50% 0,72% 30%,62% 30%,84% 58%,70% 58%,100% 88%,56% 88%,56% 100%,44% 100%,44% 88%,0 88%,30% 58%,16% 58%,38% 30%,28% 30%)}
.ts{font:600 11.5px/1 var(--sans);letter-spacing:.04em;font-variant-numeric:tabular-nums;color:var(--muted);text-decoration:none;white-space:nowrap}
.ts:hover{color:var(--accent)}
.notice{margin-top:48px;padding:18px 0 0;border-top:1px solid var(--ink);font:italic 400 15px/1.65 var(--serif);color:var(--ink-2)}
.notice strong{display:block;font:600 11px/1.4 var(--sans);font-style:normal;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px;color:var(--ink)}
.notice a{color:var(--accent)}
.status-line{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:16px}
.status-line .muted{font:italic 400 15px/1.5 var(--serif);margin:0}
.transcript{margin-top:52px}
.transcript p{display:grid;grid-template-columns:76px minmax(0,1fr);gap:12px;font:400 15px/1.6 var(--sans);color:var(--ink-2);margin:0 0 12px}
.transcript .who{font:600 11.5px/1.6 var(--sans);color:var(--muted);font-variant-numeric:tabular-nums}

/* Notes search and legacy lists */
.hits .hit{display:block;text-decoration:none;color:inherit;border-top:1px solid var(--rule);padding:20px 0}
.hits .hit:first-child{border-top:0;padding-top:4px}
.hit .kicker{font-size:14px}
.hit h2{font:400 25px/1.2 var(--head);margin:2px 0 8px}
.hit p{margin:0;font:400 15.5px/1.6 var(--serif);color:var(--ink-2)}
.hit:hover h2{color:var(--accent)}
.search{display:grid;grid-template-columns:minmax(0,1fr) 200px auto;gap:12px;align-items:end;margin:8px 0 8px}
.search label{margin:0 0 6px}.search button{margin:0;width:auto;padding:14px 24px}

footer.site{margin-top:40px;padding:0 24px 44px;font:400 13px/1.7 var(--sans);color:var(--muted);text-align:center}
footer.site .treeline{display:block;width:100%;max-width:1120px;height:auto;margin:0 auto 18px;color:var(--spruce)}
footer.site .sign{font:400 22px/1 var(--display);color:var(--ink);margin-bottom:10px}
footer.site a{color:var(--ink)}

@media (max-width:860px){
  .hero,.grid{grid-template-columns:minmax(0,1fr);gap:40px}
  .hero{padding:30px 0 36px}
  .lead{padding:0}
  .topline span:nth-child(1),.topline span:nth-child(3){display:none}.topline{justify-content:center}
  .search{grid-template-columns:minmax(0,1fr)}.search button{width:100%}
}
@media (max-width:520px){
  .wrap{padding:0 18px}
  .vista{padding:0 8px}
  .body{font-size:17.5px}
  .docket a{grid-template-columns:minmax(0,1fr) auto}
  .docket .when{grid-column:1 / -1;padding:0}.docket .when b{display:inline;font-size:15px;font-family:var(--sans);margin:0 5px}
  .transcript p{grid-template-columns:minmax(0,1fr);gap:2px}
}
`;

/** Line drawing for the masthead: Deer Mountain over the Tongass Narrows, spruce shoreline, a troller, two eagles. */
function vista(): string {
  const trees: string[] = [];
  // Fixed pseudo-random heights so every page draws the same shoreline.
  let seed = 7;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let x = 6; x < 1194; x += 7 + rand() * 9) {
    if (x > 520 && x < 690) continue;
    const h = 9 + rand() * 15;
    const base = 96 - rand() * 3;
    trees.push(`M${x.toFixed(1)} ${base.toFixed(1)}l${(h * 0.22).toFixed(1)} -${h.toFixed(1)}l${(h * 0.22).toFixed(1)} ${h.toFixed(1)}`);
  }
  const water = [
    [40, 104, 120], [210, 104, 60], [330, 108, 150], [560, 103, 90], [700, 108, 70], [880, 104, 130], [1060, 108, 90],
    [120, 113, 80], [470, 114, 60], [760, 115, 110], [990, 114, 70], [260, 120, 50], [640, 121, 70], [1120, 121, 50],
  ]
    .map(([x, y, w]) => `M${x} ${y}h${w}`)
    .join('');
  return `<svg class="vista" viewBox="0 0 1200 128" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Mountains over the Tongass Narrows, with a fishing boat">
<path stroke="var(--tide)" stroke-width="1" d="M0 74L70 60L130 66L210 44L270 56L330 40L392 52L450 38L520 50L600 24L628 18L650 26L700 44L770 34L840 52L910 38L990 56L1060 44L1130 58L1200 52"/>
<path stroke="var(--tide)" stroke-width=".8" d="M600 24l12 10l-6 2M628 18l-8 14M650 26l10 12"/>
<path stroke-width="1.2" fill="var(--paper)" d="M0 88C90 74 150 80 230 70S390 76 460 64S600 80 690 68S870 76 950 66S1110 78 1200 72V98H0Z"/>
<path stroke="var(--spruce)" stroke-width="1.1" d="${trees.join('')}"/>
<path stroke-width="1.2" d="M0 98H520M690 98H1200"/>
<path stroke-width="1.2" d="M560 101h62l-7 7h-48z"/><path stroke-width="1" d="M584 101V80M584 80L612 101M584 84L566 101M592 101v-6h10v6"/>
<path stroke="var(--tide)" stroke-width="1" d="${water}"/>
<path stroke-width="1" d="M300 22q6 -6 12 0q6 -6 12 0M352 14q4 -4 8 0q4 -4 8 0"/>
</svg>`;
}

function today(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: config.timezone });
}

function masthead(compact: boolean): string {
  return `<header class="masthead${compact ? ' compact' : ''}">
<div class="topline"><span>${esc(today())}</span><span>Ketchikan · Southeast Alaska</span><span>Independent · Free</span></div>
<div class="nameplate"><a href="/">${esc(config.newsletterName)}</a></div>
<div class="tagline">Plain-language reporting on the Borough's public meetings, from the First City</div>
${compact ? '' : vista()}
<nav class="sections" aria-label="Sections"><a href="/">Front page</a><a href="/notes">Recaps</a><a href="/topics">Topics</a><a href="/#docket">The docket</a><a href="/#subscribe">Subscribe</a></nav>
</header>`;
}

function treeline(): string {
  const trees: string[] = [];
  let seed = 3;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let x = 4; x < 1196; x += 6 + rand() * 8) {
    const h = 8 + rand() * 18;
    trees.push(`M${x.toFixed(1)} 30l${(h * 0.24).toFixed(1)} -${h.toFixed(1)}l${(h * 0.24).toFixed(1)} ${h.toFixed(1)}`);
  }
  return `<svg class="treeline" viewBox="0 0 1200 32" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" aria-hidden="true"><path d="${trees.join('')}"/><path stroke="var(--ink)" d="M0 30.5H1200"/></svg>`;
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
<footer class="site">${treeline()}<div class="sign">${esc(config.newsletterName)}</div>An independent public service from Ketchikan. Not an official Ketchikan Gateway Borough publication.<br>Recaps are written with AI from the Borough's own recordings and reviewed before they're published. <a href="/notes">Read every recap</a>.</footer>
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

export interface TopicOption {
  slug: string;
  name: string;
}

/** Deep-dive opt-in. Only shown once you've approved at least one topic. */
export function topicCheckboxes(topics: TopicOption[], selected: string[] = []): string {
  if (!topics.length) return '';
  return `<fieldset><legend>Follow a topic</legend><div class="chips">
${topics
  .map((t) => `<label><input type="checkbox" name="topics" value="${esc(t.slug)}"${selected.includes(t.slug) ? ' checked' : ''}>${esc(t.name)}</label>`)
  .join('')}</div><p class="hint">Get an in-depth explainer when something big happens on these issues.</p></fieldset>`;
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

export const signupPage = (recent: NoteHit[], work: WorkHit[], archiveCount: number, sinceLabel: string, topics: TopicOption[] = []) => {
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
    ? `<article class="lead"><div class="kicker">${lead.draft ? 'Draft · ' : ''}${esc(lead.body)}</div>
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
      ${topicCheckboxes(topics)}
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
  const checked = (d.checkedAgainst ?? []).map((c) => `<a href="${esc(c.url)}">${esc(c.label)}</a>`);
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
<div class="notice"><strong>How this was made</strong>Written with AI from the Borough's recording and an automated transcript${opts.draft ? '' : ', then reviewed by a person'}. Names, numbers and votes can be misheard; use the ▶ links to check the video.${checked.length ? `<br><br>Names checked against the ${checked.join(', ')}.` : ''}${caveats.length ? `<br><br>${caveats.map(esc).join('<br>')}` : ''}</div>
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

export interface TopicSummary {
  slug: string;
  name: string;
  description: string;
  meetings: number;
  lastDate: string;
  latest: string;
}

export function topicsIndexPage(topics: TopicSummary[]): string {
  const list = topics.length
    ? `<ul class="docket">${topics
        .map(
          (t) => `<li><a href="/topics/${esc(t.slug)}" style="grid-template-columns:minmax(0,1fr) auto"><div><h3>${esc(t.name)}</h3><p class="headline">${esc(t.description)}</p>${t.latest ? `<p class="meta" style="margin-top:6px">Latest${t.lastDate ? `, ${esc(t.lastDate)}` : ''}: ${esc(t.latest)}</p>` : ''}</div><span class="state done">${t.meetings} meeting${t.meetings === 1 ? '' : 's'}</span></a></li>`,
        )
        .join('')}</ul>`
    : '<p class="empty">Topics appear here once the first issues have been picked out of the recaps.</p>';
  const description = 'The issues that keep coming back to Ketchikan Gateway Borough meetings, each followed from meeting to meeting in plain language.';
  return shell(
    `Ketchikan issues to follow · ${config.newsletterName}`,
    `<main class="wrap" style="max-width:820px"><div class="article">
<div class="kicker">Topics</div>
<h1>The issues, meeting by meeting</h1>
<p class="dek">Some questions take months to settle. Each topic follows one issue across every meeting where it came up, with an in-depth explainer whenever something big happens.</p>
<h2 class="rubric" style="margin-top:30px">Following now</h2>
${list}
<div class="signup" style="margin-top:36px"><h2>Follow an issue</h2><p>Pick topics when you <a href="/#subscribe">subscribe</a>, or from the link at the bottom of any email.</p></div>
</div></main>`,
    { seo: { description, canonical: '/topics' } },
  );
}

export interface TopicTimelineRow {
  meetingId: string;
  body: string;
  date: string;
  summary: string;
  milestone: boolean;
  why: string | null;
  href: string;
  videoHref: string;
}

/** The evergreen page for one issue: the latest deep dive, then every meeting that touched it. */
export function topicPage(
  topic: { slug: string; name: string; description: string },
  rows: TopicTimelineRow[],
  dive: { article: DeepDiveArticle; date: Date; videoAt: (meetingId: string, t: number) => string } | null,
  topics: TopicOption[],
): string {
  const a = dive?.article;
  const ts = (meetingId: string, t: number) => (dive ? `<a class="ts" href="${esc(dive.videoAt(meetingId, t))}">▶ ${hms(t)}</a>` : '');
  const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '');
  const story = a
    ? `<div class="body">
${a.latest ? `<p>${esc(a.latest)}</p>` : ''}
${a.whyItMatters ? `<h2>Why it matters</h2><p>${esc(a.whyItMatters)}</p>` : ''}
${a.residents.length ? `<h2>What residents said</h2>${list(a.residents.map((x) => `<strong>${esc(x.who)}:</strong> ${esc(x.gist)} ${ts(x.meetingId, x.t)}`))}` : ''}
${a.whatsNext.length ? `<h2>What's next</h2>${list(a.whatsNext.map((x) => `${esc(x.item)}${x.when ? ` — <strong>${esc(x.when)}</strong>` : ''}`))}` : ''}
${a.background.length ? `<h2>Background from local news</h2>${list(a.background.map((x) => `${esc(x.point)} ${x.sources.map((u) => `<a href="${esc(u)}">${esc(sourceLabel(u))}</a>`).join(' · ')}`))}` : ''}
</div>`
    : '';
  const timeline = rows.length
    ? `<ol class="timeline">${rows
        .map(
          (r) => `<li class="${r.milestone ? 'milestone' : ''}"><div class="meta">${esc(r.date || 'Date unknown')} · ${esc(r.body)}${r.milestone ? ' · <b>Key moment</b>' : ''}</div><p>${esc(r.summary)}</p><p class="meta"><a href="${esc(r.href)}">Meeting recap</a> · <a href="${esc(r.videoHref)}">Recording</a></p></li>`,
        )
        .join('')}</ol>`
    : '<p class="empty">No meetings on this topic yet.</p>';
  const headline = a?.headline || topic.name;
  const description = a?.dek || `${topic.description} Followed across every Ketchikan Gateway Borough meeting where it came up.`;
  return shell(
    `${topic.name} in Ketchikan: ${a ? a.headline : 'what the Borough has decided'} · ${config.newsletterName}`,
    `<main class="wrap" style="max-width:720px"><article class="article">
<div class="kicker">Topic · ${esc(topic.name)}</div>
<h1>${esc(headline)}</h1>
${a?.dek ? `<p class="dek">${esc(a.dek)}</p>` : `<p class="dek">${esc(topic.description)}</p>`}
<div class="byline"><span>${rows.length} meeting${rows.length === 1 ? '' : 's'}${dive ? ` · Updated ${esc(shortDate(dive.date, false))}` : ''}</span><a href="#follow">Follow this topic</a><a href="/topics">All topics</a></div>
${story}
<section><h2 class="rubric" style="margin-top:40px">How we got here</h2>${timeline}</section>
<aside class="signup" id="follow" style="margin-top:40px"><h2>Follow ${esc(topic.name)}</h2><p>We'll email you an explainer when something big happens.</p>
<form method="post" action="/subscribe"><label for="email">Email address</label><input id="email" type="email" name="email" required autocomplete="email" placeholder="you@example.com">
<input type="hidden" name="topics" value="${esc(topic.slug)}"><input type="hidden" name="topicOnly" value="1">
<button type="submit">Follow</button></form><p class="hint">Topic emails only. Add meeting recaps anytime from the link in each email.</p></aside>
</article></main>`,
    {
      seo: {
        description: describe(description),
        canonical: `/topics/${topic.slug}`,
        ogType: dive ? 'article' : 'website',
        jsonLd: dive
          ? {
              '@context': 'https://schema.org',
              '@type': 'NewsArticle',
              headline: headline.slice(0, 110),
              description: describe(description),
              dateModified: dive.date.toISOString().slice(0, 10),
              author: { '@type': 'Organization', name: config.newsletterName },
              publisher: { '@type': 'Organization', name: config.newsletterName },
              about: { '@type': 'Thing', name: `${topic.name}, Ketchikan Gateway Borough` },
            }
          : undefined,
      },
    },
  );
}

export interface AdminTopicRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  meetings: number;
  milestones: number;
  dives: { id: string; status: string; createdAt: Date; headline: string; previewHref: string; approveHref: string }[];
}

/** Suggestions to approve or archive, approved topics, and deep-dive drafts. */
export function adminTopicsPage(rows: AdminTopicRow[]): string {
  const btn = (action: string, label: string, style = '') =>
    `<form method="post" action="${esc(action)}" style="display:inline"><button type="submit" style="width:auto;margin:0 6px 0 0;padding:8px 12px;font-size:11px;${style}">${esc(label)}</button></form>`;
  const card = (t: AdminTopicRow) => `<div class="hit"><div class="kicker">${esc(t.status)} · ${t.meetings} meeting${t.meetings === 1 ? '' : 's'} · ${t.milestones} key moment${t.milestones === 1 ? '' : 's'}</div>
<h2>${esc(t.name)}</h2><p>${esc(t.description)}</p>
<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px">${
    t.status === 'SUGGESTED'
      ? btn(`/admin/topics/${t.id}/approve`, 'Approve') + btn(`/admin/topics/${t.id}/archive`, 'Not a topic', 'background:#fff;color:#141412;border:1px solid #c9c2b2')
      : `${btn(`/admin/topics/${t.id}/dive`, 'Write a deep dive now')}${btn(`/admin/topics/${t.id}/archive`, 'Archive', 'background:#fff;color:#141412;border:1px solid #c9c2b2')}<a href="/topics/${esc(t.slug)}" class="meta">Public page →</a>`
  }</div>
${t.dives.length ? `<ul class="parts" style="margin-top:10px">${t.dives.map((d) => `<li>${esc(d.status)} · ${esc(d.headline)} · <a href="${esc(d.previewHref)}">Preview</a>${d.status === 'DRAFT' ? ` · <a href="${esc(d.approveHref)}">Approve and send</a>` : ''}</li>`).join('')}</ul>` : ''}</div>`;
  const suggested = rows.filter((r) => r.status === 'SUGGESTED');
  const approved = rows.filter((r) => r.status === 'APPROVED');
  return page(
    'Topics',
    `<h1>Topics</h1>
<p>Claude suggests issues as it reads each recap; the ones raised at the most meetings are at the top. Approved topics get a public page, a signup option, and a deep dive drafted automatically after each key moment.</p>
<p>${btn('/admin/topics/scan', 'Tag older recaps now')}</p>
<h2 class="section">Suggested (${suggested.length})</h2>${suggested.length ? `<div class="hits">${suggested.map(card).join('')}</div>` : '<p class="muted">No suggestions waiting.</p>'}
<h2 class="section">Approved (${approved.length})</h2>${approved.length ? `<div class="hits">${approved.map(card).join('')}</div>` : '<p class="muted">None yet.</p>'}
<p><a href="/admin/meetings">Meetings</a></p>`,
    true,
  );
}
