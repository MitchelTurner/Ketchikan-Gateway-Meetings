import { MeetingDigest } from '../analysis/analysis.service';
import { esc, formatDate, hms } from '../util';

export interface RenderInput {
  meeting: { title: string; body: string; meetingDate: Date | null; sourceUrl: string; platform: string };
  digest: MeetingDigest;
  newsletterName: string;
  mailingAddress: string;
  unsubscribeUrl: string;
  preferencesUrl: string;
  banner?: string; // admin preview: approve link etc. (pre-escaped HTML)
  /** The subscriber's own link to this recap, and how many neighbors have joined through their links. */
  invite?: { url: string; count: number; badgesUrl: string };
}

function inviteLine(count: number): string {
  return count ? `${count} neighbor${count === 1 ? ' has' : 's have'} joined through your link so far.` : 'When they sign up through it, it counts toward your reader badges.';
}

function rows<T>(v: T[] | null | undefined): T[] {
  return Array.isArray(v) ? v.filter((x) => !!x && typeof x === 'object') : [];
}

export function timestampUrl(url: string, platform: string, t: number): string {
  const s = Math.max(0, Math.floor(t));
  if (platform === 'youtube') return `${url}&t=${s}s`;
  if (platform === 'vimeo') return `${url}#t=${s}s`;
  return url;
}

/** "krbd.org" for a link label. */
export function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Light-only, inline-styled, table-free enough for most clients.
const C = { ink: '#1b2430', muted: '#5b6675', rule: '#e3e7ec', accent: '#0b5d7a', bg: '#f6f7f9', card: '#ffffff' };

export function renderSubject(i: RenderInput): string {
  const d = i.meeting.meetingDate ? i.meeting.meetingDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
  return `${i.meeting.body}${d ? ` (${d})` : ''}: ${i.digest.headline}`;
}

export function renderHtml(i: RenderInput): string {
  const { meeting: m, digest: d } = i;
  const ts = (t: number) =>
    `<a href="${esc(timestampUrl(m.sourceUrl, m.platform, t))}" style="color:${C.accent};text-decoration:none;font-variant-numeric:tabular-nums;white-space:nowrap">${hms(t)}</a>`;
  const h2 = (s: string) =>
    `<h2 style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:${C.muted};margin:28px 0 10px;font-weight:600">${s}</h2>`;
  const li = (inner: string) => `<li style="margin:0 0 10px;line-height:1.5">${inner}</li>`;
  const list = (items: string[]) => `<ul style="padding-left:18px;margin:0">${items.join('')}</ul>`;

  const actions = rows(d.actions).filter((a) => a.item || a.outcome);
  const discussion = rows(d.discussion).filter((x) => x.topic || x.gist);
  const comments = rows(d.publicComment).filter((x) => x.who || x.topic || x.gist);
  const upcoming = rows(d.upcoming).filter((x) => x.item);
  const background = rows(d.background).filter((x) => x.point);
  const sections: string[] = [];
  sections.push(
    String(d.summary ?? '')
      .split(/\n\s*\n/)
      .map((p) => `<p style="margin:0 0 14px;line-height:1.6">${esc(p.trim())}</p>`)
      .join(''),
  );
  if (actions.length)
    sections.push(
      h2('What they decided') +
        list(actions.map((a) => li(`<strong>${esc(a.item)}</strong> — ${esc(a.outcome)}${a.vote ? ` (${esc(a.vote)})` : ''} · ${ts(a.t)}`))),
    );
  if (discussion.length)
    sections.push(h2('Also discussed') + list(discussion.map((x) => li(`<strong>${esc(x.topic)}:</strong> ${esc(x.gist)} · ${ts(x.t)}`))));
  if (comments.length)
    sections.push(
      h2('Public comment') + list(comments.map((x) => li(`<strong>${esc(x.who)}</strong> on ${esc(x.topic)}: ${esc(x.gist)} · ${ts(x.t)}`))),
    );
  if (upcoming.length)
    sections.push(h2('Coming up') + list(upcoming.map((x) => li(`${esc(x.item)}${x.when ? ` — <strong>${esc(x.when)}</strong>` : ''}`))));
  if (background.length)
    sections.push(
      h2('Background from local news') +
        list(
          background.map((x) =>
            li(`${esc(x.point)} ${(x.sources ?? []).map((u) => `<a href="${esc(u)}" style="color:${C.accent}">${esc(sourceLabel(u))}</a>`).join(' · ')}`),
          ),
        ),
    );

  const caveat = [
    'This recap was written by AI from an automated transcript. Names, numbers and votes can be misheard — check the video before relying on anything here.',
    ...(Array.isArray(d.caveats) ? d.caveats.filter((c) => typeof c === 'string') : []),
    ...nameNotes(d),
  ].map(esc);
  const checked = rows(d.checkedAgainst).filter((c) => c.label && c.url);
  if (checked.length)
    caveat.push(`Names checked against the ${checked.map((c) => `<a href="${esc(c.url)}" style="color:${C.muted}">${esc(c.label)}</a>`).join(', ')}.`);

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${esc(renderSubject(i))}</title></head>
<body style="margin:0;padding:0;background:${C.bg};color:${C.ink};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px">
<div style="max-width:620px;margin:0 auto;padding:24px 16px">
${i.banner ?? ''}
<div style="background:${C.card};border:1px solid ${C.rule};border-radius:8px;padding:28px 24px">
<div style="font-size:13px;color:${C.muted};margin-bottom:6px">${esc(i.newsletterName)} · ${esc(m.body)}</div>
<h1 style="font-size:22px;line-height:1.3;margin:0 0 6px">${esc(d.headline)}</h1>
<div style="font-size:14px;color:${C.muted};margin-bottom:22px">${esc(m.title)}${m.meetingDate ? ` · ${esc(formatDate(m.meetingDate))}` : ''} · <a href="${esc(m.sourceUrl)}" style="color:${C.accent}">Watch the meeting</a></div>
${sections.join('\n')}
<div style="margin-top:28px;padding:12px 14px;background:${C.bg};border-radius:6px;font-size:13px;color:${C.muted};line-height:1.5">${caveat.join('<br>')}</div>
</div>
${
  i.invite
    ? `<div style="margin-top:16px;background:${C.card};border:1px solid ${C.rule};border-radius:8px;padding:18px 24px;text-align:center">
<div style="font-size:16px;font-weight:600;margin-bottom:4px">Know someone who'd want this?</div>
<div style="font-size:14px;color:${C.muted};line-height:1.5;margin-bottom:12px">Forward this email or send them your link. ${esc(inviteLine(i.invite.count))}</div>
<a href="${esc(i.invite.url)}" style="display:inline-block;background:${C.ink};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:6px">Share this recap</a>
<div style="font-size:12px;margin-top:10px"><a href="${esc(i.invite.badgesUrl)}" style="color:${C.muted}">Your invite link and badges</a></div>
</div>`
    : ''
}
<div style="font-size:12px;color:${C.muted};text-align:center;line-height:1.6;margin-top:18px">
Not an official Borough publication.<br>
<a href="${esc(i.preferencesUrl)}" style="color:${C.muted}">Change which meetings you get</a> · <a href="${esc(i.unsubscribeUrl)}" style="color:${C.muted}">Unsubscribe</a><br>
${esc(i.mailingAddress)}
</div>
</div></body></html>`;
}

export function renderText(i: RenderInput): string {
  const { meeting: m, digest: d } = i;
  const actions = rows(d.actions).filter((a) => a.item || a.outcome);
  const discussion = rows(d.discussion).filter((x) => x.topic || x.gist);
  const comments = rows(d.publicComment).filter((x) => x.who || x.topic || x.gist);
  const upcoming = rows(d.upcoming).filter((x) => x.item);
  const background = rows(d.background).filter((x) => x.point);
  const out: string[] = [d.headline, `${m.title}${m.meetingDate ? ` — ${formatDate(m.meetingDate)}` : ''}`, `Video: ${m.sourceUrl}`, '', String(d.summary ?? ''), ''];
  const sec = (title: string, lines: string[]) => lines.length && out.push(title.toUpperCase(), ...lines.map((r) => `- ${r}`), '');
  sec('What they decided', actions.map((a) => `${a.item} — ${a.outcome}${a.vote ? ` (${a.vote})` : ''} [${hms(a.t)}]`));
  sec('Also discussed', discussion.map((x) => `${x.topic}: ${x.gist} [${hms(x.t)}]`));
  sec('Public comment', comments.map((x) => `${x.who} on ${x.topic}: ${x.gist} [${hms(x.t)}]`));
  sec('Coming up', upcoming.map((x) => `${x.item}${x.when ? ` — ${x.when}` : ''}`));
  sec('Background from local news', background.map((x) => `${x.point} ${(x.sources ?? []).join(' ')}`));
  out.push('Written by AI from an automated transcript; check the video before relying on it.', ...(Array.isArray(d.caveats) ? d.caveats.filter((c) => typeof c === 'string') : []), ...nameNotes(d));
  const checked = rows(d.checkedAgainst).filter((c) => c.label && c.url);
  if (checked.length) out.push(`Names checked against: ${checked.map((c) => `${c.label} (${c.url})`).join('; ')}.`);
  out.push('');
  if (i.invite) out.push(`Know someone who'd want this? Send them your link: ${i.invite.url}`, inviteLine(i.invite.count), '');
  out.push(`Not an official Borough publication. Unsubscribe: ${i.unsubscribeUrl}`, i.mailingAddress);
  return out.join('\n');
}

function nameNotes(d: MeetingDigest): string[] {
  const fixes = rows(d.nameCorrections).filter((f) => f.heard && f.corrected);
  return fixes.length ? [`Names corrected from the transcript: ${fixes.map((f) => `"${f.heard}" → ${f.corrected}`).join(', ')}.`] : [];
}
