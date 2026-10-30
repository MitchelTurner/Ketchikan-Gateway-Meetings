import { config } from '../config';
import { esc } from '../util';
import { adminPage, pill } from './page';
import type { DayCount } from './stats.service';

const n = (v: number) => v.toLocaleString('en-US');
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;

/** "Oct 30, 9:46 AM AKDT" in the newsroom's zone. */
export function stamp(d: Date | null | undefined): string {
  if (!d) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: config.timezone, timeZoneName: 'short' });
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function postButton(action: string, label: string, opts: { cls?: string; confirm?: string; disabled?: boolean; fields?: Record<string, string> } = {}): string {
  const fields = Object.entries(opts.fields ?? {})
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  const onsubmit = opts.confirm ? ` onsubmit="return confirm('${esc(opts.confirm.replace(/'/g, "\\'"))}')"` : '';
  return `<form method="post" action="${esc(action)}"${onsubmit}>${fields}<button type="submit" class="btn ${opts.cls ?? ''}"${opts.disabled ? ' disabled' : ''}>${esc(label)}</button></form>`;
}

/** Bars for page views with visits drawn inside them, one per day. */
function chart(days: DayCount[]): string {
  const W = 1000;
  const H = 210;
  const top = 18;
  const base = H - 26;
  const max = Math.max(4, ...days.map((d) => d.views));
  const step = W / Math.max(1, days.length);
  const bw = Math.max(3, step * 0.72);
  const y = (v: number) => base - ((base - top) * v) / max;
  const bars = days
    .map((d, i) => {
      const x = i * step + (step - bw) / 2;
      const tip = `<title>${esc(dayLabel(d.day))}: ${plural(d.views, 'view')}, ${plural(d.visits, 'visit')}</title>`;
      return `<g>${tip}<rect x="${x.toFixed(1)}" y="${top}" width="${bw.toFixed(1)}" height="${base - top}" fill="transparent"/>
<rect x="${x.toFixed(1)}" y="${y(d.views).toFixed(1)}" width="${bw.toFixed(1)}" height="${(base - y(d.views)).toFixed(1)}" fill="var(--tide)" opacity=".28"/>
<rect x="${(x + bw * 0.2).toFixed(1)}" y="${y(d.visits).toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${(base - y(d.visits)).toFixed(1)}" fill="var(--spruce)"/></g>`;
    })
    .join('');
  const labels = days
    .map((d, i) => (i === days.length - 1 || ((days.length - 1 - i) % 7 === 0 && i > 2) || (i === 0 && (days.length - 1) % 7 > 2) ? `<text x="${(i * step + step / 2).toFixed(1)}" y="${H - 6}" text-anchor="${i === days.length - 1 ? 'end' : 'middle'}">${esc(dayLabel(d.day))}</text>` : ''))
    .join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Page views and visits per day for the last ${days.length} days" font-family="Public Sans, sans-serif" font-size="12" fill="var(--muted)">
<path d="M0 ${top}H${W}" stroke="var(--rule)" stroke-dasharray="3 4"/><text x="${W}" y="${top - 5}" text-anchor="end">${n(max)}</text>
<path d="M0 ${(top + base) / 2}H${W}" stroke="var(--rule)" stroke-dasharray="3 4"/>
${bars}<path d="M0 ${base + 0.5}H${W}" stroke="var(--ink)"/>${labels}</svg>
<div class="legend"><span><i style="background:var(--tide);opacity:.4"></i>Page views</span><span><i style="background:var(--spruce)"></i>Visits (one person, one day)</span></div></div>`;
}

export interface StatCard {
  label: string;
  value: string;
  note?: string;
  tone?: 'up' | 'down';
}

export interface AdminOverview {
  cards: StatCard[];
  daily: DayCount[];
  topPages: { label: string; sub: string; href: string; views: number; visits: number }[];
  referrers: { host: string; views: number }[];
  mobileShare: number;
  attention: { label: string; sub: string; href: string }[];
  pipeline: { status: string; count: number }[];
  subscribers: { confirmed: number; pending: number; unsubscribed: number; newThisWeek: number };
  email: { ready: boolean; sent30: number; failed30: number };
  backfillDrafts: number;
  growth: {
    newReaders30: number;
    invited30: number;
    invitedAll: number;
    readersEver: number;
    foundingLeft: number;
    shareVisits: { via: string; views: number; visits: number }[];
    inviters: { email: string; count: number; badge: string }[];
  };
  flash?: string;
}

const CHANNEL: Record<string, string> = {
  invite: 'Personal invite links',
  sms: 'Text message',
  email: 'Email',
  facebook: 'Facebook',
  copy: 'Copied link',
  share: 'Phone share sheet',
};

function growthSection(g: AdminOverview['growth']): string {
  const rate = g.newReaders30 ? Math.round((100 * g.invited30) / g.newReaders30) : 0;
  const channels = g.shareVisits.length
    ? `<ul class="list">${g.shareVisits.map((c) => `<li><span>${esc(CHANNEL[c.via] ?? c.via)}</span><span class="n">${n(c.visits)} visit${c.visits === 1 ? '' : 's'}</span></li>`).join('')}</ul>`
    : '<p class="muted">No visits from shared links yet.</p>';
  const inviters = g.inviters.length
    ? `<table class="data"><thead><tr><th>Reader</th><th>Badge</th><th class="num">Joined</th></tr></thead><tbody>${g.inviters
        .map((r) => `<tr><td>${esc(r.email)}</td><td>${esc(r.badge)}</td><td class="num">${n(r.count)}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted">Nobody has brought a neighbor yet. Invite links go out on the confirmation page, the settings page and every recap email.</p>';
  return `<h2 class="section">Growth</h2>
<div class="status-grid"><span><b>${n(g.invited30)}</b> of ${n(g.newReaders30)} new readers this month came through an invite${g.newReaders30 ? ` (${rate}%)` : ''}</span><span><b>${n(g.invitedAll)}</b> invited reader${g.invitedAll === 1 ? '' : 's'}, all time</span><span><b>${n(g.foundingLeft)}</b> Founding Reader spots left</span></div>
<div class="cols"><section><h3 class="meta" style="text-transform:uppercase;letter-spacing:.12em;margin:10px 0 6px">Top inviters</h3>${inviters}</section>
<section><h3 class="meta" style="text-transform:uppercase;letter-spacing:.12em;margin:10px 0 6px">Visits from shared links, 30 days</h3>${channels}</section></div>`;
}

export function adminOverviewPage(o: AdminOverview): string {
  const cards = `<div class="cards">${o.cards
    .map((c) => `<div class="card"><div class="l">${esc(c.label)}</div><div class="n">${esc(c.value)}</div>${c.note ? `<div class="d ${c.tone ?? ''}">${esc(c.note)}</div>` : ''}</div>`)
    .join('')}</div>`;
  const maxViews = Math.max(1, ...o.topPages.map((p) => p.views));
  const pages = o.topPages.length
    ? `<table class="data"><thead><tr><th>Page</th><th class="num">Views</th><th class="num hide-sm">Visits</th></tr></thead><tbody>${o.topPages
        .map(
          (p) =>
            `<tr><td><a href="${esc(p.href)}">${esc(p.label)}</a><span class="sub">${esc(p.sub)}</span><span class="meter"><span style="width:${((100 * p.views) / maxViews).toFixed(1)}%"></span></span></td><td class="num">${n(p.views)}</td><td class="num hide-sm">${n(p.visits)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="muted">No visits counted yet. Views start counting from this release; your own visits while signed in are left out.</p>';
  const refs = o.referrers.length
    ? `<ul class="list">${o.referrers.map((r) => `<li><span>${esc(r.host)}</span><span class="n">${n(r.views)}</span></li>`).join('')}</ul>`
    : '<p class="muted">Nobody has arrived from another site yet. Direct visits, email links and bookmarks don\'t show a source.</p>';
  const attention = o.attention.length
    ? `<ul class="list">${o.attention.map((a) => `<li><a href="${esc(a.href)}">${esc(a.label)}</a><span class="n">${esc(a.sub)}</span></li>`).join('')}</ul>`
    : '<p class="muted">Nothing waiting on you.</p>';
  const s = o.subscribers;
  return adminPage(
    'Overview',
    'overview',
    `${o.flash ? `<div class="flash">${esc(o.flash)}</div>` : ''}<h1>Overview</h1>
<p class="lede">Readers over the last 30 days, and what's waiting on the desk. Days run midnight to midnight, ${config.timezone === 'America/Anchorage' ? 'Alaska time' : esc(config.timezone)}.</p>
${cards}
${chart(o.daily)}
<div class="cols">
<section><h2 class="section">Most read, last 30 days</h2>${pages}</section>
<section><h2 class="section">Needs you</h2>${attention}
<h2 class="section">Where readers come from</h2>${refs}<p class="muted" style="margin-top:12px">${Math.round(o.mobileShare * 100)}% of page views were on a phone or tablet.</p></section>
</div>
<div class="cols">
<section><h2 class="section">Subscribers</h2>
<div class="status-grid"><span><b>${n(s.confirmed)}</b> confirmed</span><span><b>${n(s.pending)}</b> haven't confirmed</span><span><b>${n(s.unsubscribed)}</b> unsubscribed</span><span><b>${n(s.newThisWeek)}</b> new this week</span></div>
<p class="muted">${
      o.email.ready
        ? `${plural(o.email.sent30, 'recap email')} sent in the last 30 days${o.email.failed30 ? `, ${n(o.email.failed30)} failed` : ''}.`
        : "Email isn't connected yet (Resend). Posts can still be published to the site; subscribers get nothing until it's set up."
    }</p></section>
<section><h2 class="section">Pipeline</h2>
<div class="status-grid">${o.pipeline.map((p) => `<span>${pill(p.status)} <b>${n(p.count)}</b></span>`).join('')}</div>
<div class="actions">${postButton('/admin/discover', 'Check the archive now', { cls: 'ghost' })}${
      o.backfillDrafts
        ? postButton('/admin/publish-backfill', `Publish ${plural(o.backfillDrafts, 'older draft')}`, {
            cls: 'ghost',
            confirm: `Publish ${o.backfillDrafts} drafts of older meetings on the site? None are emailed.`,
          })
        : ''
    }</div></section>
</div>
${growthSection(o.growth)}`,
  );
}

export type PostFilter = 'drafts' | 'published' | 'hidden' | 'all';

export interface AdminPostRow {
  id: string;
  headline: string;
  title: string;
  body: string;
  date: string;
  status: string;
  state: 'draft' | 'published' | 'hidden';
  edited: boolean;
  views: number;
  publicHref: string;
}

const FILTERS: { key: PostFilter; label: string }[] = [
  { key: 'drafts', label: 'Drafts' },
  { key: 'published', label: 'Published' },
  { key: 'hidden', label: 'Hidden' },
  { key: 'all', label: 'All' },
];

export function adminPostsPage(rows: AdminPostRow[], filter: PostFilter, q: string, counts: Record<PostFilter, number>, flash = ''): string {
  const href = (f: PostFilter) => `/admin/posts?filter=${f}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const tabs = `<nav class="tabs" aria-label="Filter posts">${FILTERS.map(
    (f) => `<a href="${esc(href(f.key))}"${f.key === filter ? ' class="on" aria-current="page"' : ''}>${f.label}<b>${n(counts[f.key])}</b></a>`,
  ).join('')}</nav>`;
  const stateLabel = (r: AdminPostRow) =>
    r.state === 'hidden' ? '<span class="state stopped">Hidden</span>' : r.state === 'published' ? pill(r.status === 'SENT' ? 'SENT' : 'PUBLISHED') : pill('AWAITING_APPROVAL');
  const table = rows.length
    ? `<table class="data"><thead><tr><th>Post</th><th class="hide-sm">Meeting</th><th>State</th><th class="num">Views</th></tr></thead><tbody>${rows
        .map(
          (r) =>
            `<tr><td><a class="headline" href="/admin/posts/${esc(r.id)}">${esc(r.headline || r.title)}</a><span class="sub">${esc(r.body)} · ${esc(r.date)}${r.edited ? ' · edited' : ''} · <a href="${esc(r.publicHref)}">view</a></span></td><td class="hide-sm"><span class="sub" style="margin:0">${esc(r.title)}</span></td><td>${stateLabel(r)}</td><td class="num">${n(r.views)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : `<p class="muted">${q ? `No posts match “${esc(q)}”.` : 'No posts here.'}</p>`;
  return adminPage(
    'Posts',
    'posts',
    `${flash ? `<div class="flash">${esc(flash)}</div>` : ''}<h1>Posts</h1>
<p class="lede">Every recap Claude has written. Open one to fix the headline or summary, publish it, or take it off the site.</p>
<div class="toolbar">${tabs}<form method="get" action="/admin/posts" role="search"><input type="hidden" name="filter" value="${esc(filter)}"><input type="search" name="q" value="${esc(q)}" placeholder="Search headlines and titles" aria-label="Search posts"><button type="submit" class="btn ghost">Search</button></form></div>
${table}`,
  );
}

export interface AdminPost {
  id: string;
  title: string;
  body: string;
  date: string;
  status: string;
  error: string | null;
  state: 'draft' | 'published' | 'hidden';
  headline: string;
  summary: string;
  views: number;
  publicHref: string;
  approvedAt: Date | null;
  hiddenAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
  backfill: boolean;
  subscribers: number;
  emailReady: boolean;
  nameCorrections: { heard: string; corrected: string }[];
  checkedAgainst: { label: string; url: string }[];
  caveats: string[];
  hasTranscript: boolean;
  sourceUrl: string;
  flash?: string;
}

export function adminPostPage(p: AdminPost): string {
  const base = `/admin/posts/${encodeURIComponent(p.id)}`;
  let publish = '';
  if (p.state === 'draft') {
    const emailNote = p.backfill
      ? 'This is an older meeting, so it is published without email.'
      : p.emailReady
        ? `Publishing and emailing sends it to ${plural(p.subscribers, 'subscriber')}.`
        : 'Email isn\'t connected yet, so this posts it on the site only.';
    publish = `<div class="panel"><h3>Publish</h3><p>${esc(emailNote)}</p><div class="actions">${
      !p.backfill && p.emailReady
        ? postButton(`${base}/approve`, 'Publish and email', { confirm: `Publish this recap and email it to ${p.subscribers} subscriber(s)?` }) +
          postButton(`${base}/publish`, 'Site only', { cls: 'ghost' })
        : postButton(`${base}/publish`, 'Publish on the site')
    }</div></div>`;
  }
  const visibility =
    p.state === 'hidden'
      ? `<div class="panel"><h3>Hidden</h3><p>Taken off the site ${esc(stamp(p.hiddenAt))}. Nobody can open it, and it's out of search and the sitemap.</p>${postButton(`${base}/unhide`, 'Put it back', { cls: 'ghost' })}</div>`
      : `<div class="panel"><h3>Visibility</h3><p>${
          p.state === 'published' ? `Published ${esc(stamp(p.approvedAt))}.` : 'Drafts are shown on the front page docket, marked as unreviewed.'
        } Hiding takes it off every public page${p.state === 'published' && p.status === 'SENT' ? ' (emails already sent stay sent)' : ''}.</p>${postButton(`${base}/hide`, 'Hide from the site', {
          cls: 'warn',
          confirm: 'Hide this post from every public page?',
        })}</div>`;
  const names = p.nameCorrections.length
    ? `<ul>${p.nameCorrections.map((c) => `<li>“${esc(c.heard)}” → ${esc(c.corrected)}</li>`).join('')}</ul>`
    : '<p>None.</p>';
  const sources = p.checkedAgainst.length
    ? `<ul>${p.checkedAgainst.map((s) => `<li><a href="${esc(s.url)}">${esc(s.label)}</a></li>`).join('')}</ul>`
    : '<p>Not recorded for this recap.</p>';
  return adminPage(
    p.headline || p.title,
    'posts',
    `${p.flash ? `<div class="flash">${esc(p.flash)}</div>` : ''}<p class="meta"><a href="/admin/posts">← All posts</a></p>
<div class="kicker">${esc(p.body)} · ${esc(p.date)}</div>
<div class="status-grid">${p.state === 'hidden' ? '<span class="state stopped">Hidden</span>' : pill(p.state === 'published' ? (p.status === 'SENT' ? 'SENT' : 'PUBLISHED') : 'AWAITING_APPROVAL')}<span class="meta">${plural(p.views, 'view')}</span><span class="meta">Written ${esc(stamp(p.createdAt))}</span>${p.editedAt ? `<span class="meta">Edited ${esc(stamp(p.editedAt))}</span>` : ''}</div>
${p.error ? `<div class="flash bad">${esc(p.error)}</div>` : ''}
<div class="editor">
<form method="post" action="${esc(base)}">
<label for="headline">Headline</label>
<input type="text" id="headline" class="headline" name="headline" value="${esc(p.headline)}" maxlength="200" required>
<label for="summary">Summary</label>
<textarea id="summary" name="summary" required>${esc(p.summary)}</textarea>
<p class="hint">Blank lines separate paragraphs. The rest of the recap (votes, discussion, public comment) stays as Claude wrote it. Saved edits are kept: automatic rewrites skip this post.</p>
<div class="actions" style="margin-top:16px"><button type="submit" class="btn">Save changes</button><a class="btn ghost" href="${esc(p.publicHref)}">View on site</a><a class="btn ghost" href="/admin/meetings/${esc(p.id)}/preview">Email preview</a></div>
</form>
<aside>
${publish}${visibility}
<div class="panel"><h3>Names corrected</h3>${names}</div>
<div class="panel"><h3>Checked against</h3>${sources}</div>
${p.caveats.length ? `<div class="panel"><h3>Caveats</h3><ul>${p.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
<div class="panel"><h3>Source</h3><p><a href="${esc(p.sourceUrl)}">Meeting video</a>${p.hasTranscript ? ` · <a href="/admin/meetings/${esc(p.id)}/transcript">Transcript</a>` : ''}</p>
<p>Rewriting runs research and Claude again (a few cents). It replaces your edits and, if published, takes the post down until you publish it again.</p>
${postButton(`${base}/rewrite`, 'Rewrite with Claude', { cls: 'warn', confirm: 'Rewrite this recap from the transcript? Your edits are replaced and it goes back to draft.' })}</div>
</aside>
</div>`,
  );
}

export function adminLoginPage(next: string, error = ''): string {
  return adminPage(
    'Sign in',
    '',
    `<div style="max-width:420px;margin:20px auto 40px">
<h1>Sign in</h1>
<p class="lede">The editor's desk for ${esc(config.newsletterName)}.</p>
${error ? `<div class="flash bad">${esc(error)}</div>` : ''}
<form method="post" action="/admin/login">
<input type="hidden" name="next" value="${esc(next)}">
<label for="token">Admin token</label>
<input type="password" id="token" name="token" autocomplete="current-password" required autofocus>
<p class="hint">The ADMIN_TOKEN value from Railway. You stay signed in on this browser for 30 days.</p>
<button type="submit" class="btn" style="margin-top:18px;width:100%;padding:15px">Sign in</button>
</form></div>`,
    false,
  );
}
