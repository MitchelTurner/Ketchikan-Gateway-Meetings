import { config } from '../config';
import { sourceLabel, timestampUrl } from '../email/render';
import { MeetingDigest } from '../analysis/analysis.service';
import { BODIES, esc, formatDate, hms } from '../util';

/** Minimal light-only page shell for the public signup, search, and account screens. */
export function page(title: string, inner: string, wide = false, below = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(title)}</title>
<style>
:root{--ink:#1b2430;--muted:#5b6675;--rule:#d9dee5;--accent:#0b5d7a;--bg:#f6f7f9;--card:#fff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:${wide ? '720px' : '520px'};margin:48px auto;padding:0 16px}
.nav{display:flex;gap:16px;margin:0 0 14px;font-size:14px;font-weight:600}
.nav a{color:var(--accent);text-decoration:none}
.nav a:hover{text-decoration:underline}
.card{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:28px 24px}
.card+.card{margin-top:16px}
h2.section{font-size:18px;line-height:1.3;margin:22px 0 8px}
h1{font-size:24px;line-height:1.25;margin:0 0 10px}p{margin:0 0 14px}.muted{color:var(--muted);font-size:14px}
label{display:block;font-weight:600;margin:18px 0 6px}
input[type=email],input[type=search],select{width:100%;padding:11px 12px;font-size:16px;border:1px solid var(--rule);border-radius:6px;background:#fff;color:inherit}
input:focus,select:focus{outline:2px solid var(--accent);outline-offset:1px}
fieldset{border:0;padding:0;margin:18px 0 0}legend{font-weight:600;margin-bottom:6px}
.check{display:flex;gap:8px;align-items:center;font-weight:400;margin:6px 0}
button{margin-top:22px;width:100%;padding:12px;font-size:16px;font-weight:600;color:#fff;background:var(--accent);border:0;border-radius:6px;cursor:pointer}
button:hover{filter:brightness(1.08)}
.hit{display:block;text-decoration:none;color:inherit;border-top:1px solid var(--rule);padding:14px 0}
.hits .hit:first-child{border-top:0;padding-top:4px}
.hit h2{font-size:18px;line-height:1.3;margin:2px 0 6px}
.hit p{margin:0;color:var(--muted);font-size:14px}
.hit a{color:var(--accent)}
.kicker{font-size:13px;color:var(--muted)}
mark{background:#fff3c4;padding:0 2px;border-radius:2px}
.note h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:28px 0 10px;font-weight:600}
.note ul{padding-left:18px;margin:0}.note li{margin:0 0 10px}
.note a{color:var(--accent)}
.caveat{margin-top:28px;padding:12px 14px;background:var(--bg);border-radius:6px;font-size:13px;color:var(--muted)}
footer{text-align:center;margin-top:18px}
</style></head><body><main>
<nav class="nav"><a href="/notes">Notes</a><a href="/">Email updates</a></nav>
<div class="card">${inner}</div>
${below}
<footer class="muted">Not an official Ketchikan Gateway Borough publication.</footer></main></body></html>`;
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
}

/** Staff list. A transcript link means transcription finished, with or without Resend. */
export function adminMeetingsPage(rows: AdminMeetingRow[]): string {
  const list = rows.length
    ? `<div class="hits">${rows
        .map((m) => {
          const links = [
            m.hasTranscript ? `<a href="/admin/meetings/${esc(m.id)}/transcript">Transcript</a>` : '',
            m.hasAnalysis ? `<a href="/admin/meetings/${esc(m.id)}/preview">Recap</a>` : '',
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
  return `<fieldset><legend>Which meetings?</legend><p class="muted" style="margin:0 0 6px">Leave all unchecked to get every one.</p>
${BODIES.map(
  (b) => `<label class="check"><input type="checkbox" name="bodies" value="${esc(b.name)}"${selected.includes(b.name) ? ' checked' : ''}> ${esc(b.name)}</label>`,
).join('')}</fieldset>`;
}

export function hitList(hits: NoteHit[]): string {
  if (!hits.length) return '';
  return `<div class="hits">${hits
    .map(
      (h) => `<a class="hit" href="/notes/${esc(h.id)}"><div class="kicker">${esc(h.body)}${h.date ? ` · ${esc(h.date)}` : ''}</div><h2>${esc(h.headline)}</h2><p>${h.snippet}</p></a>`,
    )
    .join('')}</div>`;
}

const STATUS_LABEL: Record<string, string> = {
  DISCOVERED: 'Found — waiting to download',
  RESEARCHING: 'Looking up the agenda and news coverage',
  DOWNLOADING: 'Downloading audio',
  TRANSCRIBING: 'Transcribing',
  ANALYZING: 'Writing the recap',
  AWAITING_APPROVAL: 'Transcript ready',
  SENDING: 'Emailing subscribers',
  SENT: 'Emailed',
  FAILED: 'Stopped before it finished',
  SKIPPED: 'Older than the transcription window',
};

export interface WorkHit {
  id: string;
  title: string;
  body: string;
  date: string;
  status: string;
  detail: string;
}

export function workList(hits: WorkHit[]): string {
  if (!hits.length) return '';
  return `<div class="hits">${hits
    .map((h) => {
      const label = STATUS_LABEL[h.status] || h.status;
      return `<a class="hit" href="/meetings/${esc(h.id)}"><div class="kicker">${esc(h.body)}${h.date ? ` · ${esc(h.date)}` : ''} · ${esc(label)}</div><h2>${esc(h.title)}</h2>${h.detail ? `<p>${esc(h.detail)}</p>` : ''}</a>`;
    })
    .join('')}</div>`;
}

export function archiveCard(work: WorkHit[], archiveCount: number, sinceLabel: string): string {
  const intro = archiveCount
    ? `${archiveCount.toLocaleString('en-US')} clips found on the Borough video archive. Meetings on or after ${esc(sinceLabel)} are downloaded and transcribed.`
    : 'No clips recorded yet. The archive is checked when the server starts, then every few hours. Refresh in a minute.';
  const list = work.length
    ? workList(work)
    : archiveCount
      ? '<p class="muted">Nothing in that window is waiting to be transcribed. Older clips are saved and left alone.</p>'
      : '';
  return `<div class="card"><h2 class="section" style="margin-top:0">From the archive</h2><p class="muted">${intro}</p>${list}</div>`;
}

export const signupPage = (recent: NoteHit[], work: WorkHit[], archiveCount: number, sinceLabel: string) =>
  page(
    config.newsletterName,
    `<h1>${esc(config.newsletterName)}</h1>
<p>A plain-language recap of Ketchikan Gateway Borough meetings in your inbox, usually within a day: what passed, what was discussed, what residents said, and what's coming up — with links to the exact moment in the video.</p>
<form method="post" action="/subscribe">
<label for="email">Email</label><input id="email" type="email" name="email" required autocomplete="email">
${bodyCheckboxes()}
<button type="submit">Subscribe</button></form>
<p class="muted" style="margin-top:16px">Recaps are written by AI from automated transcripts and reviewed before sending. One-click unsubscribe in every email.</p>`,
    true,
    `${archiveCard(work, archiveCount, sinceLabel)}
<div class="card"><h2 class="section" style="margin-top:0">Most recent</h2>
${recent.length ? hitList(recent) : '<p class="muted">No emailed recaps yet. Transcripts show up under From the archive as soon as they are ready.</p>'}
<p style="margin:14px 0 0"><a href="/notes">Search all notes</a></p></div>`,
  );

export interface NoteHit {
  id: string;
  title: string;
  body: string;
  date: string;
  headline: string;
  snippet: string;
}

export function notesSearchPage(q: string, body: string, hits: NoteHit[]): string {
  const options = ['<option value="">Every body</option>'].concat(
    BODIES.map((b) => `<option value="${esc(b.name)}"${b.name === body ? ' selected' : ''}>${esc(b.name)}</option>`),
  );
  const list = hits.length
    ? hitList(hits)
    : `<p class="muted">${q ? `Nothing in the published notes matches “${esc(q)}”.` : 'No emailed recaps yet. Meetings found on the archive, and their transcripts, are on the <a href="/">home page</a>.'}</p>`;
  const count = hits.length ? `<p class="muted">${hits.length} ${hits.length === 1 ? 'note' : 'notes'}${q ? ` matching “${esc(q)}”` : ''}, newest first.</p>` : '';
  const heading = q ? 'Results' : 'Most recent';
  return page(
    q ? `Search: ${q}` : 'Most recent notes',
    `<h1>Meeting notes</h1>
<p>The same recaps that go out by email, after they've been reviewed. Newest first.</p>
<form method="get" action="/notes">
<label for="q">Search</label><input id="q" type="search" name="q" value="${esc(q)}" placeholder="harbor, budget, ordinance…">
<label for="body">Which meetings?</label><select id="body" name="body">${options.join('')}</select>
<button type="submit">Search</button></form>
<h2 class="section">${heading}</h2>
${count}${list}`,
    true,
  );
}

export function transcriptHtml(segments: { start?: number; speaker?: string; text?: string }[] | null | undefined): string {
  if (!segments?.length) return '';
  return `<h2 class="section">Transcript</h2>${segments
    .map((s) => {
      const who = typeof s.speaker === 'string' && s.speaker ? `${esc(s.speaker)} · ` : '';
      return `<p><span class="kicker">${who}${hms(Number(s.start) || 0)}</span><br>${esc(s.text)}</p>`;
    })
    .join('')}`;
}

export function meetingPage(
  meeting: { id: string; title: string; body: string; meetingDate: Date | null; sourceUrl: string; platform: string; status: string; error: string | null },
  digest: MeetingDigest | null,
  approved: boolean,
  segments: { start?: number; speaker?: string; text?: string }[],
): string {
  const status = STATUS_LABEL[meeting.status] || meeting.status;
  const banner = `<p class="kicker">${esc(status)}</p>${meeting.error ? `<p>${esc(meeting.error)}</p>` : ''}${digest && !approved ? '<p class="muted">Draft recap — not emailed yet.</p>' : ''}`;
  const transcript = transcriptHtml(segments);
  if (digest) return noteDetailPage(meeting, digest, { banner, after: transcript, backHref: '/', backLabel: 'Home' });
  return page(
    meeting.title,
    `<div class="kicker">${esc(meeting.body)}${meeting.meetingDate ? ` · ${esc(formatDate(meeting.meetingDate))}` : ''}</div>
<h1>${esc(meeting.title)}</h1>
${banner}
<p class="muted"><a href="${esc(meeting.sourceUrl)}">Watch the meeting</a></p>
${transcript || '<p>No transcript yet. This page updates when transcription finishes.</p>'}
<p style="margin-top:18px"><a href="/">Home</a></p>`,
    true,
  );
}

export function noteDetailPage(
  meeting: { id: string; title: string; body: string; meetingDate: Date | null; sourceUrl: string; platform: string },
  d: MeetingDigest,
  opts: { banner?: string; after?: string; backHref?: string; backLabel?: string } = {},
): string {
  const ts = (t: number) =>
    `<a href="${esc(timestampUrl(meeting.sourceUrl, meeting.platform, t))}">${hms(t)}</a>`;
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
        list(actions.map((a) => `<strong>${esc(a.item)}</strong> — ${esc(a.outcome)}${a.vote ? ` (${esc(a.vote)})` : ''} · ${ts(a.t)}`))
      : '',
    discussion.length
      ? h2('Also discussed') + list(discussion.map((x) => `<strong>${esc(x.topic)}:</strong> ${esc(x.gist)} · ${ts(x.t)}`))
      : '',
    comments.length
      ? h2('Public comment') +
        list(comments.map((x) => `<strong>${esc(x.who)}</strong> on ${esc(x.topic)}: ${esc(x.gist)} · ${ts(x.t)}`))
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
    'This recap was written by AI from an automated transcript. Names, numbers and votes can be misheard — check the video before relying on anything here.',
    ...(Array.isArray(d.caveats) ? d.caveats.filter((c) => typeof c === 'string') : []),
    ...(fixes.length
      ? [`Names corrected from the transcript using the Borough's published spelling: ${fixes.map((f) => `"${f.heard}" → ${f.corrected}`).join(', ')}.`]
      : []),
  ];
  return page(
    d.headline,
    `<div class="note">${opts.banner ?? ''}<div class="kicker">${esc(meeting.body)}${meeting.meetingDate ? ` · ${esc(formatDate(meeting.meetingDate))}` : ''}</div>
<h1>${esc(d.headline)}</h1>
<p class="muted">${esc(meeting.title)} · <a href="${esc(meeting.sourceUrl)}">Watch the meeting</a></p>
${sections}
<div class="caveat">${caveats.map(esc).join('<br>')}</div>
${opts.after ?? ''}
<p style="margin-top:18px"><a href="${esc(opts.backHref ?? '/notes')}">${esc(opts.backLabel ?? 'All notes')}</a></p></div>`,
    true,
  );
}
