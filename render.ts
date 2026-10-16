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
}

export function timestampUrl(url: string, platform: string, t: number): string {
  const s = Math.max(0, Math.floor(t));
  if (platform === 'youtube') return `${url}&t=${s}s`;
  if (platform === 'vimeo') return `${url}#t=${s}s`;
  return url;
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

  const sections: string[] = [];
  sections.push(
    d.summary
      .split(/\n\s*\n/)
      .map((p) => `<p style="margin:0 0 14px;line-height:1.6">${esc(p.trim())}</p>`)
      .join(''),
  );
  if (d.actions.length)
    sections.push(
      h2('What they decided') +
        list(d.actions.map((a) => li(`<strong>${esc(a.item)}</strong> — ${esc(a.outcome)}${a.vote ? ` (${esc(a.vote)})` : ''} · ${ts(a.t)}`))),
    );
  if (d.discussion.length)
    sections.push(h2('Also discussed') + list(d.discussion.map((x) => li(`<strong>${esc(x.topic)}:</strong> ${esc(x.gist)} · ${ts(x.t)}`))));
  if (d.publicComment.length)
    sections.push(
      h2('Public comment') + list(d.publicComment.map((x) => li(`<strong>${esc(x.who)}</strong> on ${esc(x.topic)}: ${esc(x.gist)} · ${ts(x.t)}`))),
    );
  if (d.upcoming.length)
    sections.push(h2('Coming up') + list(d.upcoming.map((x) => li(`${esc(x.item)}${x.when ? ` — <strong>${esc(x.when)}</strong>` : ''}`))));

  const caveat = [
    'This recap was written by AI from an automated transcript. Names, numbers and votes can be misheard — check the video before relying on anything here.',
    ...d.caveats,
  ];

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${esc(renderSubject(i))}</title></head>
<body style="margin:0;padding:0;background:${C.bg};color:${C.ink};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px">
<div style="max-width:620px;margin:0 auto;padding:24px 16px">
${i.banner ?? ''}
<div style="background:${C.card};border:1px solid ${C.rule};border-radius:8px;padding:28px 24px">
<div style="font-size:13px;color:${C.muted};margin-bottom:6px">${esc(i.newsletterName)} · ${esc(m.body)}</div>
<h1 style="font-size:22px;line-height:1.3;margin:0 0 6px">${esc(d.headline)}</h1>
<div style="font-size:14px;color:${C.muted};margin-bottom:22px">${esc(m.title)}${m.meetingDate ? ` · ${esc(formatDate(m.meetingDate))}` : ''} · <a href="${esc(m.sourceUrl)}" style="color:${C.accent}">Watch the meeting</a></div>
${sections.join('\n')}
<div style="margin-top:28px;padding:12px 14px;background:${C.bg};border-radius:6px;font-size:13px;color:${C.muted};line-height:1.5">${caveat.map(esc).join('<br>')}</div>
</div>
<div style="font-size:12px;color:${C.muted};text-align:center;line-height:1.6;margin-top:18px">
Not an official Borough publication.<br>
<a href="${esc(i.preferencesUrl)}" style="color:${C.muted}">Change which meetings you get</a> · <a href="${esc(i.unsubscribeUrl)}" style="color:${C.muted}">Unsubscribe</a><br>
${esc(i.mailingAddress)}
</div>
</div></body></html>`;
}

export function renderText(i: RenderInput): string {
  const { meeting: m, digest: d } = i;
  const out: string[] = [d.headline, `${m.title}${m.meetingDate ? ` — ${formatDate(m.meetingDate)}` : ''}`, `Video: ${m.sourceUrl}`, '', d.summary, ''];
  const sec = (title: string, rows: string[]) => rows.length && out.push(title.toUpperCase(), ...rows.map((r) => `- ${r}`), '');
  sec('What they decided', d.actions.map((a) => `${a.item} — ${a.outcome}${a.vote ? ` (${a.vote})` : ''} [${hms(a.t)}]`));
  sec('Also discussed', d.discussion.map((x) => `${x.topic}: ${x.gist} [${hms(x.t)}]`));
  sec('Public comment', d.publicComment.map((x) => `${x.who} on ${x.topic}: ${x.gist} [${hms(x.t)}]`));
  sec('Coming up', d.upcoming.map((x) => `${x.item}${x.when ? ` — ${x.when}` : ''}`));
  out.push('Written by AI from an automated transcript; check the video before relying on it.', ...d.caveats, '');
  out.push(`Not an official Borough publication. Unsubscribe: ${i.unsubscribeUrl}`, i.mailingAddress);
  return out.join('\n');
}
