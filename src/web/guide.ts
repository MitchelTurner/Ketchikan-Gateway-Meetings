import { config } from '../config';
import { publicArticle } from './page';
import { esc } from '../util';

function origin(): string {
  try {
    return config.publicBaseUrl;
  } catch {
    return 'https://ketchikan.vote';
  }
}

/** Shown on About when Railway has an admin address. Never the getter that throws. */
function publisherEmail(): string {
  const v = (process.env.ADMIN_EMAIL || '').trim();
  if (!v || /[\s<>]/.test(v) || !v.includes('@')) return '';
  return v;
}

type Guide = 'about' | 'boards' | 'testify';

function guideNav(current: Guide): string {
  const links: { id: Guide; href: string; label: string }[] = [
    { id: 'about', href: '/about', label: 'About' },
    { id: 'boards', href: '/boards', label: 'Boards' },
    { id: 'testify', href: '/testify', label: 'Speak at a meeting' },
  ];
  return `<nav class="guide-nav" aria-label="About this site">${links
    .map((l) => `<a href="${l.href}"${l.id === current ? ' aria-current="page"' : ''}>${l.label}</a>`)
    .join('')}</nav>`;
}

function graph(nodes: Record<string, unknown>[]): Record<string, unknown> {
  return { '@context': 'https://schema.org', '@graph': nodes };
}

const ASSEMBLY = 'https://borough.ketchikan.ak.us/173/Mayor-and-Assembly';
const ATTEND = 'https://borough.ketchikan.ak.us/272/Attending-a-Meeting';
const PLANNING = 'https://borough.ketchikan.ak.us/1175/Planning-Commission';
const PLANNING_MEETINGS = 'https://borough.ketchikan.ak.us/1172/Meetings-Public-Hearings';
const SCHOOL = 'https://www.kgbsd.org/en-US/school-board';
const SCHOOL_DATES = 'https://schoolboard.kgbsd.org/BoardMeeting';
const SCHOOL_AGENDA = 'https://schoolboard.kgbsd.org/BoardPolicy/Policy/d68fb02c-c924-4bfd-97cf-07333c4778e6';
const COUNCIL = 'https://www.ketchikan.gov/mayor-and-city-council';
const CITY_AGENDAS = 'https://www.ketchikan.gov/current-agendas-and-minutes';

function a(href: string, label: string): string {
  return `<a href="${esc(href)}">${esc(label)}</a>`;
}

export function aboutPage(): string {
  const email = publisherEmail();
  const description =
    'Ketchikan.Vote is a project by Mitchel Turner to help local journalists and residents find what a public meeting decided, with a link to the recording.';
  return publicArticle({
    title: 'About Ketchikan.Vote',
    description,
    canonical: '/about',
    html: `${guideNav('about')}
<div class="kicker">About</div>
<h1>About Ketchikan.Vote</h1>
<p class="dek">A finding aid for Ketchikan's public meetings, published so a resident or a reporter can find the decision and the minute it happened.</p>
<div class="body">
<p>Ketchikan.Vote is a project by <a href="https://mitchelturner.com" rel="me">Mitchel Turner</a> of <a href="https://mitchelturner.dev" rel="me">Mitchel Turner Dev, LLC</a>. It helps local journalists and residents find what a Borough or City meeting decided, what people argued about, and the moment in the recording where it happened.</p>
<p>This is not an official publication of the Ketchikan Gateway Borough or the City of Ketchikan. Those governments keep the recordings, the agendas, and the minutes. This site writes a plain-language recap from the recordings and points back at them.</p>
<h2>How a recap is made</h2>
<p>The recording is transcribed. A recap is written with AI. Names are checked against the published roster and the agenda. Each decision links to that point in the video. The words can be wrong. The recording is the source. <a href="/#how">How we report</a> is the short version of that.</p>
<h2>Corrections</h2>
<p>On a recap, each decision has "Something wrong?". That note comes to the editor${email ? `, or you can write <a href="mailto:${esc(email)}">${esc(email)}</a>` : ''}. Say which line is off and what the recording actually says.</p>
<h2>For journalists</h2>
<p>Use a recap to find the vote and the timestamp, then quote the recording. Link the recap if it helped you find the minute. <a href="/topics">Topic pages</a> follow one issue across meetings. <a href="/boards">Who sits on each board</a> and <a href="/testify">how to speak at a meeting</a> are their own pages, with links to the official instructions.</p>
<h2>A note on the Planning Commission</h2>
<p>Mitchel Turner is a member of the Ketchikan Gateway Borough Planning Commission. Recaps of that commission are written from the recording in the same way as any other meeting. This site is not a commission publication.</p>
</div>`,
    jsonLd: graph([
      {
        '@type': 'AboutPage',
        name: 'About Ketchikan.Vote',
        description,
        url: `${origin()}/about`,
        mainEntity: {
          '@type': 'Organization',
          name: 'Ketchikan.Vote',
          url: `${origin()}/`,
          parentOrganization: { '@type': 'Organization', name: 'Mitchel Turner Dev, LLC', url: 'https://mitchelturner.dev' },
          founder: { '@type': 'Person', name: 'Mitchel Turner', url: 'https://mitchelturner.com' },
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin()}/` },
          { '@type': 'ListItem', position: 2, name: 'About', item: `${origin()}/about` },
        ],
      },
    ]),
  });
}

export function boardsPage(): string {
  const description =
    'Who votes on the Ketchikan Assembly, School Board, Planning Commission, and City Council, and when those meetings are held.';
  return publicArticle({
    title: 'Ketchikan boards and when they meet',
    description,
    canonical: '/boards',
    html: `${guideNav('boards')}
<div class="kicker">Boards</div>
<h1>Who sits on Ketchikan's boards</h1>
<p class="dek">The names below are copied from each body's own page. If this list and that page disagree, use the official page. Holidays and special meetings move the night, so the agenda for that week is the one to trust.</p>
<div class="body">
<section class="board" id="assembly">
<h2>Assembly</h2>
<p>Regular meetings are generally the first and third Monday of the month, at 5:30 p.m. in the Assembly Chambers, 1900 First Avenue, Suite 144. When that Monday is a holiday, the Borough holds the meeting on Tuesday.</p>
<p class="who"><span>Members</span> Mayor Austin Otos, Dan Ortiz, Bridget Mattson, Rodney Dial, Sharli Arntzen, Vice Mayor Jaimie Palmer, Kathy Bolling, Glen Thompson</p>
<p>${a('/notes?body=Assembly', 'Assembly recaps')} · ${a(ASSEMBLY, 'Mayor and Assembly')} · ${a(ATTEND, 'Attending a meeting')}</p>
</section>
<section class="board" id="school-board">
<h2>School Board</h2>
<p>Regular meetings are scheduled at 6:00 p.m. in the Borough Assembly Chambers. The district posts each date on its board calendar. Chloe Hall is the board clerk and does not vote.</p>
<p class="who"><span>Members</span> Melissa Reed, president; Lindsey Johnson, vice president; Shari Montgomery, clerk-treasurer; Jordan Tabb; Ali Ginter; Marissa Medford; Frances Klein</p>
<p>${a('/notes?body=School%20Board', 'School Board recaps')} · ${a(SCHOOL, 'School Board')} · ${a(SCHOOL_DATES, 'Meeting dates')}</p>
</section>
<section class="board" id="planning">
<h2>Planning Commission</h2>
<p>The commission meets on the second Tuesday of the month at 6:00 p.m. in the Assembly Chambers at the White Cliff Building, 1900 First Avenue. It may also meet on the fourth Tuesday. Four members live inside city limits and three live in the Borough outside the city. Members are appointed, not elected.</p>
<p class="who"><span>Members</span> Jos Govaars, chair, rural seat; Trevor Shaw, vice chair, rural seat; Mitchel Turner, city seat, who also publishes this site; Diane Gubatayao, city seat; Darlene Dollimont-Svenson, rural seat; Robb Arnold, city seat; Janalee Gage, city seat</p>
<p>${a('/notes?body=Planning%20Commission', 'Planning Commission recaps')} · ${a(PLANNING, 'Planning Commission')} · ${a(PLANNING_MEETINGS, 'Meetings and hearings')}</p>
</section>
<section class="board" id="city-council">
<h2>City Council</h2>
<p>Regular meetings are the first and third Thursday of the month, at 7:00 p.m. The City has been holding them in the Assembly Chambers at the White Cliff Building, 1900 First Avenue, while City Hall is under repair. The agenda for that week names the room.</p>
<p class="who"><span>Members</span> Mayor Bob Sivertsen, Vice Mayor Dick Coose, Riley Gass, Abby Bradberry, Jack Finnegan, Judy Zenge, Janalee Gage, Spencer Strassburg</p>
<p>${a('/notes?body=City%20Council', 'City Council recaps')} · ${a(COUNCIL, 'Mayor and City Council')} · ${a(CITY_AGENDAS, 'Agendas and minutes')}</p>
</section>
<section class="board" id="other">
<h2>Other meetings</h2>
<p>Service-area boards, the port board, and city committees meet on their own calendars. This site does not print a roster it has not checked against a published list. Recaps still appear here when a recording is posted.</p>
<p>${a('/notes?body=Service%20Area%20Boards', 'Service area recaps')} · ${a('/notes?body=Port%20and%20Harbors', 'Port and Harbors recaps')} · ${a('/notes?body=City%20Committees', 'City committee recaps')} · ${a(ATTEND, 'Borough calendar')} · ${a(CITY_AGENDAS, 'City agendas')}</p>
</section>
</div>`,
    jsonLd: graph([
      {
        '@type': 'WebPage',
        name: 'Ketchikan boards and when they meet',
        description,
        url: `${origin()}/boards`,
        about: [
          { '@type': 'GovernmentOrganization', name: 'Ketchikan Gateway Borough Assembly', url: ASSEMBLY },
          { '@type': 'GovernmentOrganization', name: 'Ketchikan Gateway Borough School Board', url: SCHOOL },
          { '@type': 'GovernmentOrganization', name: 'Ketchikan Gateway Borough Planning Commission', url: PLANNING },
          { '@type': 'GovernmentOrganization', name: 'City of Ketchikan City Council', url: COUNCIL },
        ],
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin()}/` },
          { '@type': 'ListItem', position: 2, name: 'Boards', item: `${origin()}/boards` },
        ],
      },
    ]),
  });
}

export function testifyPage(): string {
  const description =
    'How to speak at a Ketchikan Assembly, School Board, Planning Commission, or City Council meeting, with the official rules and where to read them.';
  return publicArticle({
    title: 'How to speak at a Ketchikan meeting',
    description,
    canonical: '/testify',
    html: `${guideNav('testify')}
<div class="kicker">Public comment</div>
<h1>How to speak at a meeting</h1>
<p class="dek">Each board sets its own rules. The agenda for that night is the one to follow. This page points at the official instructions, and at the recap of what was said last time.</p>
<div class="body">
<section class="board" id="assembly">
<h2>Assembly</h2>
<p>Regular meetings start at 5:30 p.m. on the first and third Monday, in the Assembly Chambers at 1900 First Avenue, Suite 144. A holiday Monday moves the meeting to Tuesday.</p>
<p>Citizen comments are usually just after the roll call. Sign the sheet, wait to be called, and give your name. You do not have to give your address. The Borough asks speakers to keep comments to about three minutes. A public hearing is a separate sign-up, and it comes after citizen comments.</p>
<p>To ask the Assembly to take up a new item, contact the Borough Clerk. The item has to arrive at least seven business days before the meeting.</p>
<p>${a(ATTEND, 'Attending a meeting')} · ${a(ASSEMBLY, 'Mayor and Assembly')} · ${a('/notes?body=Assembly', 'What residents said at the Assembly')}</p>
</section>
<section class="board" id="school-board">
<h2>School Board</h2>
<p>Regular meetings start at 6:00 p.m. in the Borough Assembly Chambers. The date is on the district's board calendar.</p>
<p>Citizen remarks are on the agenda. The board's own agendas cite policy BB9323 and limit each speaker to three minutes. To ask that a matter be placed on a regular agenda, send a written request to the superintendent at least ten working days before the meeting. The board does not act, at that same meeting, on a subject that was only raised in citizen remarks.</p>
<p>${a(SCHOOL_DATES, 'Meeting dates')} · ${a(SCHOOL_AGENDA, 'Agenda policy')} · ${a(SCHOOL, 'School Board')} · ${a('/notes?body=School%20Board', 'School Board recaps')}</p>
</section>
<section class="board" id="planning">
<h2>Planning Commission</h2>
<p>The commission meets on the second Tuesday at 6:00 p.m. in the Assembly Chambers at the White Cliff Building, and it may add a fourth Tuesday. You can speak at the meeting. Written comments can go to plancomment@kgbak.us. Include your name and the case number. Comments that miss the packet deadline are still handed to the commission at the meeting.</p>
<p>A conditional use permit or a variance can be appealed to the Assembly within 15 days. A subdivision decision is appealed to Superior Court.</p>
<p>${a(PLANNING, 'Planning Commission')} · ${a(PLANNING_MEETINGS, 'Meetings and hearings')} · ${a('/notes?body=Planning%20Commission', 'Planning Commission recaps')}</p>
</section>
<section class="board" id="city-council">
<h2>City Council</h2>
<p>Regular meetings are the first and third Thursday at 7:00 p.m. The City has posted that those meetings are in the Assembly Chambers at the White Cliff Building, 1900 First Avenue, while City Hall is under repair. Read that week's agenda for the room and for when public comment is taken.</p>
<p>Written comments can be mailed or delivered to 334 Front Street, Ketchikan, Alaska 99901. Anything that asks the Council to act has to reach the Clerk by Wednesday of the week before the meeting.</p>
<p>${a(COUNCIL, 'Mayor and City Council')} · ${a(CITY_AGENDAS, 'Agendas and minutes')} · ${a('/notes?body=City%20Council', 'City Council recaps')}</p>
</section>
<p>After the meeting, the recap on this site links each decision and each public comment to the minute in the recording. ${a('/about', 'About this project')}.</p>
</div>`,
    jsonLd: graph([
      {
        '@type': 'WebPage',
        name: 'How to speak at a Ketchikan meeting',
        description,
        url: `${origin()}/testify`,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin()}/` },
          { '@type': 'ListItem', position: 2, name: 'Speak at a meeting', item: `${origin()}/testify` },
        ],
      },
    ]),
  });
}
