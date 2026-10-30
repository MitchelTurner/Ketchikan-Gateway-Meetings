import { Logger } from '@nestjs/common';
import { MeetingContext } from '../research/research.service';
import { fetchAgenda } from './agenda';
import { loadRoster, officials, ROSTER_SOURCES } from './names';
import { findLocalNews, leadSentence } from './news';

const log = new Logger('PublishedSources');

/** Rosters are today's. Older meetings rely on research, which looks up the members as of the meeting date. */
const ROSTER_WINDOW_MS = 180 * 24 * 3600_000;

/**
 * Adds what can be read directly from the source sites to the web-research
 * context: the official rosters, the agenda document, and KRBD and Borough
 * news feeds. Roster spellings come first, so they win over a search result's.
 * Each source fails on its own and only means less context.
 */
export async function withPublishedSources(
  meeting: { title: string; body: string; meetingDate: Date | null; sourceUrl: string },
  ctx: MeetingContext | null,
  userAgent: string,
): Promise<MeetingContext> {
  const current = !meeting.meetingDate || Date.now() - meeting.meetingDate.getTime() < ROSTER_WINDOW_MS;
  const [roster, agenda, news] = await Promise.all([
    current
      ? loadRoster(userAgent).catch((err: Error) => {
          log.warn(`Roster fetch failed: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    fetchAgenda(meeting, userAgent).catch((err: Error) => {
      log.warn(`Agenda fetch failed: ${err.message}`);
      return null;
    }),
    findLocalNews({ body: meeting.body, title: meeting.title, meetingDate: meeting.meetingDate, userAgent }).catch(() => []),
  ]);
  const base: MeetingContext = ctx ? { ...ctx } : { people: [], agenda: [], terms: [], articles: [] };

  const rosterPeople = roster.map((p) => ({ name: p.full, role: p.role ?? '', ...(p.source ? { source: p.source } : {}) }));
  const onRoster = new Set(rosterPeople.map((p) => p.name.toLowerCase()));
  const people = [...rosterPeople, ...base.people.filter((p) => !onRoster.has(p.name.toLowerCase()))];

  const haveUrl = new Set(base.articles.map((a) => a.url));
  const articles = [
    ...base.articles,
    ...news
      .filter((a) => !haveUrl.has(a.url))
      .map((a) => ({
        title: a.title,
        url: a.url,
        outlet: a.outlet,
        date: a.published ? a.published.toISOString().slice(0, 10) : '',
        summary: leadSentence(a.excerpt),
      })),
  ];

  const agendaLabel = `${meeting.body === 'School Board' && agenda && !agenda.url.includes('granicus.com') ? 'School District' : 'Borough'} agenda for this meeting`;
  log.log(
    `${meeting.title}: ${roster.length} roster names, ${agenda ? `agenda (${agenda.text.length} chars)` : 'no agenda document'}, ${news.length} feed article(s)`,
  );
  return {
    ...base,
    people,
    articles,
    ...(agenda ? { agendaDoc: { label: agendaLabel, url: agenda.url, text: agenda.text } } : {}),
    ...(current ? { officials: officials(roster).map((p) => p.full) } : {}),
    checked: [
      ...(current ? ROSTER_SOURCES : []).map((s) => ({ label: s.label.endsWith('directory') ? s.label : `${s.label} roster`, url: s.url })),
      ...(agenda ? [{ label: agendaLabel, url: agenda.url }] : []),
    ],
  };
}
