import type { DeepDiveArticle } from '../topics/deep-dive.service';
import { esc, hms } from '../util';
import { sourceLabel, timestampUrl } from './render';

export interface DiveRenderInput {
  topic: { name: string; slug: string; description: string };
  article: DeepDiveArticle;
  meetings: Map<string, { id: string; sourceUrl: string; platform: string }>;
  baseUrl: string;
  newsletterName: string;
  mailingAddress: string;
  unsubscribeUrl: string;
  preferencesUrl: string;
  banner?: string; // admin preview: approve link (pre-escaped HTML)
}

const C = { ink: '#141412', ink2: '#3b3a36', muted: '#6f6a60', rule: '#ddd7ca', accent: '#a3201c', bg: '#f4f1ea', card: '#fbfaf6' };
const SERIF = `Georgia,'Times New Roman',serif`;
const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

export function renderDiveSubject(i: DiveRenderInput): string {
  return `Deep dive · ${i.topic.name}: ${i.article.headline}`;
}

function videoAt(i: DiveRenderInput, meetingId: string, t: number): string {
  const m = i.meetings.get(meetingId);
  return m ? timestampUrl(m.sourceUrl, m.platform, t) : `${i.baseUrl}/meetings/${meetingId}`;
}

export function renderDiveHtml(i: DiveRenderInput): string {
  const a = i.article;
  const h2 = (s: string) =>
    `<h2 style="font:700 12px/1.3 ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.ink};border-top:1px solid ${C.ink};padding-top:10px;margin:30px 0 12px">${s}</h2>`;
  const p = (s: string) => `<p style="margin:0 0 14px;font:17px/1.6 ${SERIF};color:${C.ink2}">${esc(s)}</p>`;
  const ts = (meetingId: string, t: number) =>
    `<a href="${esc(videoAt(i, meetingId, t))}" style="color:${C.accent};font:600 12px ${SANS};text-decoration:none;white-space:nowrap">▶ ${hms(t)}</a>`;
  const sections: string[] = [];
  if (a.latest) sections.push(h2('What just happened') + p(a.latest));
  if (a.whyItMatters) sections.push(h2('Why it matters') + p(a.whyItMatters));
  if (a.timeline.length)
    sections.push(
      h2('How we got here') +
        a.timeline
          .map(
            (x) => `<div style="padding:0 0 12px 14px;margin:0 0 12px;border-left:2px solid ${x.milestone ? C.accent : C.rule}">
<div style="font:600 12px ${SANS};color:${C.muted};letter-spacing:.04em;text-transform:uppercase">${esc(x.date)} · ${esc(x.body)}</div>
<div style="font:16px/1.55 ${SERIF};color:${C.ink}">${esc(x.what)} ${ts(x.meetingId, x.t)}</div></div>`,
          )
          .join(''),
    );
  if (a.residents.length)
    sections.push(
      h2('What residents said') +
        a.residents.map((x) => `<p style="margin:0 0 10px;font:16px/1.55 ${SERIF};color:${C.ink2}"><strong style="color:${C.ink}">${esc(x.who)}:</strong> ${esc(x.gist)} ${ts(x.meetingId, x.t)}</p>`).join(''),
    );
  if (a.whatsNext.length)
    sections.push(h2("What's next") + a.whatsNext.map((x) => `<p style="margin:0 0 8px;font:16px/1.55 ${SERIF};color:${C.ink2}">${esc(x.item)}${x.when ? ` — <strong>${esc(x.when)}</strong>` : ''}</p>`).join(''));
  if (a.background.length)
    sections.push(
      h2('Background from local news') +
        a.background
          .map((x) => `<p style="margin:0 0 10px;font:16px/1.55 ${SERIF};color:${C.ink2}">${esc(x.point)} ${x.sources.map((u) => `<a href="${esc(u)}" style="color:${C.accent}">${esc(sourceLabel(u))}</a>`).join(' · ')}</p>`)
          .join(''),
    );
  const notes = ['Written with AI from Borough meeting recordings and reviewed before sending. Use the ▶ links to hear each moment yourself.', ...a.caveats];
  const page = `${i.baseUrl}/topics/${encodeURIComponent(i.topic.slug)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(renderDiveSubject(i))}</title></head>
<body style="margin:0;padding:0;background:${C.bg};color:${C.ink}">
<div style="max-width:620px;margin:0 auto;padding:24px 16px">
${i.banner ?? ''}
<div style="background:${C.card};border:1px solid ${C.rule};border-top:4px solid ${C.ink};padding:28px 26px">
<div style="font:700 11px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.accent};margin-bottom:10px">Deep dive · ${esc(i.topic.name)}</div>
<h1 style="font:600 28px/1.15 ${SERIF};margin:0 0 10px;color:${C.ink}">${esc(a.headline)}</h1>
${a.dek ? `<p style="font:19px/1.45 ${SERIF};color:${C.ink2};margin:0 0 6px">${esc(a.dek)}</p>` : ''}
<p style="margin:0 0 4px;font:13px ${SANS}"><a href="${esc(page)}" style="color:${C.accent};font-weight:600">The full story on the web</a></p>
${sections.join('\n')}
<div style="margin-top:28px;padding:12px 14px;background:${C.bg};font:13px/1.55 ${SANS};color:${C.muted}">${notes.map(esc).join('<br>')}</div>
</div>
<div style="font:12px/1.6 ${SANS};color:${C.muted};text-align:center;margin-top:18px">
You get this because you follow ${esc(i.topic.name)} on ${esc(i.newsletterName)}. Not an official Borough publication.<br>
<a href="${esc(i.preferencesUrl)}" style="color:${C.muted}">Change your topics</a> · <a href="${esc(i.unsubscribeUrl)}" style="color:${C.muted}">Unsubscribe</a><br>
${esc(i.mailingAddress)}
</div></div></body></html>`;
}

export function renderDiveText(i: DiveRenderInput): string {
  const a = i.article;
  const out: string[] = [`DEEP DIVE · ${i.topic.name.toUpperCase()}`, a.headline, a.dek, `${i.baseUrl}/topics/${i.topic.slug}`, ''];
  const sec = (title: string, lines: string[]) => lines.length && out.push(title.toUpperCase(), ...lines, '');
  sec('What just happened', a.latest ? [a.latest] : []);
  sec('Why it matters', a.whyItMatters ? [a.whyItMatters] : []);
  sec('How we got here', a.timeline.map((x) => `- ${x.date} (${x.body}): ${x.what} [${hms(x.t)}]`));
  sec('What residents said', a.residents.map((x) => `- ${x.who}: ${x.gist}`));
  sec("What's next", a.whatsNext.map((x) => `- ${x.item}${x.when ? ` — ${x.when}` : ''}`));
  sec('Background from local news', a.background.map((x) => `- ${x.point} ${x.sources.join(' ')}`));
  out.push('Written with AI from Borough meeting recordings and reviewed before sending.', ...a.caveats, '');
  out.push(`Change your topics: ${i.preferencesUrl}`, `Unsubscribe: ${i.unsubscribeUrl}`, i.mailingAddress);
  return out.filter((l) => l !== undefined).join('\n');
}
