# KGB Meeting Digest

Watches the Ketchikan Gateway Borough [meeting video archive](https://www.kgbak.us/434/Meeting-Video-Archive), transcribes each new meeting, has Claude write a plain-language recap, and emails it to residents who sign up.

```
every 3h ─▶ discover ─▶ process (1 at a time) ──▶ site + subscriber email + phone buzz
            archive page  web research → yt-dlp audio → AssemblyAI/Whisper → Claude digest
            + Granicus
            clips         review email to you (mark reviewed; does not send again)
```

## Stack
NestJS 11 · BullMQ on Redis · Prisma/Postgres · yt-dlp + ffmpeg · AssemblyAI (or OpenAI Whisper) · Claude API · Resend. One Railway service runs the web app and all workers.

## Deploy on Railway
1. New project → add **Postgres** and **Redis** → add this repo as a service (it builds from the Dockerfile).
2. Set variables from `env.example`. Reference `${{Postgres.DATABASE_URL}}`. Redis is optional: if `REDIS_URL` is unset, the container runs Redis itself and the job queue resets on every deploy. To keep jobs across deploys, add Redis and set `REDIS_URL=${{Redis.REDIS_URL}}`.
3. Verify your sending domain in Resend and set `EMAIL_FROM` to an address on it.
4. Deploy. The schema is applied on start (`prisma db push`).
5. Check discovery, then run it:
   ```
   curl -H "Authorization: Bearer $ADMIN_TOKEN" https://YOUR_APP/admin/inspect
   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://YOUR_APP/admin/discover
   ```
   `detected` lists meeting clips. The Borough archive embeds a Granicus publisher, and inspect follows that frame. Meetings older than `PROCESS_SINCE` (default: the last 14 days) are saved as `SKIPPED` and are not downloaded.

## How a meeting flows
| Status | Meaning |
|---|---|
| `SKIPPED` | Dated before `PROCESS_SINCE` (or no date found). Force with `POST /admin/meetings/:id/process`. |
| `RESEARCHING` → `DOWNLOADING` → `TRANSCRIBING` → `ANALYZING` | Working. Finished stages are saved and reused on retry. |
| `AWAITING_APPROVAL` | Transcript and recap are saved and already on the site. Subscribers are emailed and phones buzz as soon as it is written, once Resend is configured. Nobody has to review it first. |
| `SENT` | Queued to subscribers. Per-subscriber results are in `EmailSend`. |
| `PUBLISHED` | Older than `EMAIL_SINCE`: approved and on `/notes`, not emailed. |
| `FAILED` | See `error`; retried automatically 3×, or re-run with the process endpoint. |

Set `AUTO_SEND=true` to also mark each new recap reviewed as soon as it is written. Subscribers are emailed either way, once Resend is configured. Meetings older than `EMAIL_SINCE` are never emailed.

## Backfilling older meetings
Set `PROCESS_SINCE` back, e.g. `PROCESS_SINCE=2023-11-01` for three years, and redeploy. On start (and every discovery run), meetings that were saved as `SKIPPED` and now fall inside the window are queued.

- **Newest first.** Jobs are prioritized by meeting date, so a meeting from this week always jumps ahead of the backlog.
- **No email for old meetings.** Anything dated before `EMAIL_SINCE` (default: 14 days ago) is never sent to subscribers. With `AUTO_SEND=true` it is published straight to `/notes` (status `PUBLISHED`). Otherwise it waits in `AWAITING_APPROVAL`: approve one from `/admin/meetings` or publish them all with `POST /admin/publish-backfill`. Drafts are readable on `/meetings/:id` before then.
- **Research uses the roster as of the meeting date**, not today's, so names from a 2023 Assembly are checked against the 2023 members.
- **Throughput:** one meeting at a time, about 30–45 minutes each, so a few hundred meetings take roughly a week. Watch progress with `GET /admin/stats`.
- **Cost:** about $1–2 per meeting (transcription + research + recap). 200 meetings ≈ $200–400. Narrow it by moving `PROCESS_SINCE` forward; meetings already done are kept.
- Only clips listed on the Granicus archive can be pulled. `GET /admin/inspect` shows how far back it goes.

## Topics and deep dives
Some issues run for months: a budget, a harbor project, a zoning case. Topics follow one issue across meetings.

1. **Claude suggests topics.** After each recap, Claude tags the meeting with the topics it touched and suggests new ones. On start, recaps that haven't been tagged yet (including the backfill) are tagged too, so suggestions reflect the whole year.
2. **You approve them** at `/admin/topics` (open `/admin/topics?token=$ADMIN_TOKEN` once to sign in). Suggestions are ranked by how many meetings raised them. "Not a topic" archives one so it's never suggested again.
3. **Topics are public as soon as they're suggested.** `/topics` lists the issues that came up at more than one meeting. An issue mentioned only once stays off that list until you search: the box matches the name, the description, and what was said, including a plural or a name written as one word. `/topics/:slug` stays up either way, with a timeline of the meetings that raised it. Approving one adds it to the signup form. The topic page has a "Follow" form that signs up for topic emails only; a reader can follow a suggestion before you approve it.
4. **Key moments trigger a deep dive.** When a meeting is a milestone for an approved topic (a final vote, a budget adopted, a contract awarded, a hearing held, a major new proposal), Claude drafts an explainer from every meeting on that topic plus local news coverage: what just happened, why it matters, how we got here, what residents said, what's next. It is emailed to subscribers following that topic and becomes the story on the topic page, without a review click. Backfilled meetings never trigger one; use "Write a deep dive now" on `/admin/topics` for a first explainer.

Subscribers who follow a topic from its page get topic emails only (`recaps = false`); they can add meeting recaps from the preferences link. Cost: tagging ≈ $0.01–0.03 per meeting, a deep dive ≈ $0.10–0.40.

## Names and news coverage
Before downloading, Claude searches the web (`RESEARCH_DOMAINS`: the Borough site, Granicus agendas, Ketchikan Daily News, KRBD, Alaska Public Media, Alaska Beacon, ADN, …) for:
- **The roster**: members of the body, Mayor, Manager, Clerk, Attorney and department heads, spelled as the Borough publishes them.
- **The agenda**: item titles and ordinance/resolution numbers.
- **News coverage** of the meeting and its agenda items.

The result is saved per meeting (`Research` table) and used three ways:
1. Names and local terms go to AssemblyAI as `word_boost` (or into the Whisper prompt), so they are transcribed correctly in the first place.
2. The recap prompt gets the roster and agenda. Claude replaces misheard names with the published spelling, lists each fix in `nameCorrections` (shown in the review email and under the recap), and uses agenda numbers when the transcript refers to an item. Votes and outcomes still come only from the transcript.
3. News articles become a **Background from local news** section, each point linked to its article. Links are kept only when a search actually returned that URL, so the section can't cite an article that doesn't exist.

Alongside the search, the app reads a few sources directly, so they don't depend on what search turns up:
- **Official rosters**: the [Assembly](https://www.kgbak.us/173/Mayor-and-Assembly), [School Board](https://www.kgbsd.org/en-US/school-board) and [Planning Commission](https://www.kgbak.us/1175/Planning-Commission) pages and the [Borough staff directory](https://www.kgbak.us/directory.aspx). They are today's rosters, so they're used only for meetings from the last six months. After Claude writes the recap, any remaining near-miss of an Assembly, School Board or Planning Commission member's name ("Member Tab", "Bowling, Mattson…") is replaced with the roster spelling and added to `nameCorrections`. Staff names only help transcription and the prompt, because surnames like King or Lane would rewrite ordinary words.
- **The agenda document**: the Granicus agenda PDF, or for the School Board, the agenda in the district's Google Drive meeting folder. Its text goes into the prompt as the authority for item titles, numbers and amounts. Reading PDFs needs `pdftotext` (`poppler-utils`, installed in the Docker image).
- **News feeds**: KRBD search and Borough news releases near the meeting date, added to the articles Claude may cite.

Each recap lists the rosters and agenda its names were checked against, on the page and in the email. On deploy, unsent drafts from the email window that were written before this check are rewritten with it; if the rewrite fails, the earlier draft stays.

`KNOWN_NAMES="Jane Doe — Borough Clerk; …"` pins spellings the web gets wrong. Research failing never stops a meeting; it carries on without it and tries again next run. Coverage often appears days later: `POST /admin/meetings/:id/process?reanalyze=true` redoes the research and the recap (the transcript is reused). Set `RESEARCH_ENABLED=false` to turn it off.

## Admin dashboard

Open `/admin` and sign in with `ADMIN_TOKEN` (the browser stays signed in for 30 days; `/admin/logout` signs out).

- **Overview** (`/admin`): visits and page views for the last 30 days by Alaska day, compared with the 30 days before; the most-read pages; the sites readers came from; subscribers; pipeline status; and what's waiting on you.
- **Posts** (`/admin/posts`): every recap, filtered by draft, published or hidden, with all-time views. Open one to edit the headline and summary, publish it on the site (with or without email), hide it from every public page, or rewrite it with Claude. Hand-edited drafts are skipped by automatic rewrites.

Page views are also counted on the server: the IP address and browser are hashed with a salt that changes daily, so a "visit" is one person on one day and neither is stored. Bots, link previews and your own signed-in visits are left out. Public pages load Google tag `G-P8S0LSF5JV`. The editor's desk does not.

## Readers bring readers

- **Invite links.** Every confirmed reader gets a personal link (`/?r=code`) on their confirmation page, their settings page (`/preferences/:token`) and in every recap email ("Share this recap" goes to that recap with their code). The code is remembered for 30 days, so a visitor who reads a few recaps first still credits the neighbor who sent them.
- **Credit only on confirmation.** A referral counts when the new reader confirms by email. Your own link never counts for you, and the first invite a person used keeps the credit.
- **Tiers:** Greenhorn (1), Deckhand (3), Skipper (5, a sticker), Captain (10, a t-shirt), Commodore (25, a hat and a t-shirt), plus Founding Reader for the first 100 readers. Merch is mailed after we email for a shipping address; the Growth list on `/admin` shows who has earned it. Each reader sees their reader number. With email connected, the inviter gets a note when a neighbor joins (never who).
- **Sharing.** Every published recap ends with Share / Text / Email / Facebook / Copy buttons (tagged `?via=` so the dashboard can count them) and a sign-up box.
- **A goal everyone shares.** The sign-up boxes show progress toward the next round number of Ketchikan readers.
- **Dashboard.** `/admin` → Growth: new readers who came through an invite, top inviters, and visits by share channel.

## Admin endpoints (Bearer `ADMIN_TOKEN`)
- `GET /admin/inspect` — what's on the archive page
- `POST /admin/discover` — check the archive now
- `GET /admin/meetings?status=FAILED` — list meetings. In a browser, open `/admin/meetings?token=YOUR_ADMIN_TOKEN` to read transcripts before Resend is connected. `hasTranscript` is true once transcription has finished.
- `POST /admin/meetings/:id/process[?reanalyze=true]` — retry / force / regenerate the research and recap
- `GET /admin/meetings/:id/preview` — the email as subscribers will see it
- `GET /admin/meetings/:id/transcript` — transcript text in a browser, JSON from curl
- `POST /admin/publish-backfill` — publish every drafted recap older than `EMAIL_SINCE` on `/notes` (no email)
- `GET /admin/stats`

Resend can stay unset while you check a transcript. The meeting lands on `AWAITING_APPROVAL`, phones can still buzz, and subscriber email waits. Add `RESEND_API_KEY`, `EMAIL_FROM`, `MAILING_ADDRESS`, and `PUBLIC_BASE_URL`. The next start emails every current recap already on the site that subscribers have not received. A new recap emails itself when it is written. Older meetings are not emailed.

## Public pages
`/` front page: signup, latest recaps (with the vote, when one was recorded), what the latest meetings said is coming up, and the docket of meetings being transcribed (filterable by body) · `/topics` and `/topics/:slug` issues followed across meetings (the index shows issues that came up more than once; search finds a single mention; archived stays hidden) · `/meetings/:id` one meeting's transcript and recap · `/notes` newest written recaps, with search · `/notes/:id` one recap · `/confirm/:token` · `/preferences/:token` (pick bodies) · `/unsubscribe/:token` (also RFC 8058 one-click). Light theme only. A recap shows on `/notes` as soon as it's written, and subscribers and phones are told then. The "reviewed by a person" line still waits for approval. Hidden recaps stay off every public page. Borough meetings and City of Ketchikan meetings (from the city's YouTube channel) are both included. A YouTube title with no day is dated from the opening of the transcript when that spoken date is within a week of the upload.

AI crawlers are turned away. `robots.txt` disallows training and answer-engine crawlers, every page carries `noai` and a text-and-data-mining reservation, and a crawler that arrives with one of those names gets an empty refusal. Google and Bing search still read the public recaps. Sharing a link still shows a preview.

The archive check runs when the server starts, not only on the 3-hour schedule. It also reads the City of Ketchikan YouTube channel (`CITY_YOUTUBE_URL`). Meetings in the processing window that stopped early (a deploy resets the in-container queue) are queued again, including ones that already have a transcript but never got a recap. Download and transcription are skipped when those stages are already saved.

## Ask

`/ask` answers a question from the published recaps. The recaps stay free. A confirmed reader gets 3 questions each Alaska month. **$10 a month** raises that to 20. Each answer names the meeting and, when it can, the timestamp. It says it can be wrong.

The reader signs in with a one-time link (`/login`, or the email field on `/ask`). A new address gets the confirmation letter, and confirming creates the account. Checkout is Stripe (`mode: subscription`). Access changes only from the webhook at `/stripe/webhook`, not from the page they land on after paying.

`/account` is where a signed-in reader sets the name shown on comments, sees the question count, and opens invoices. The first "Invoices and subscription" click creates a Stripe Customer Portal configuration with invoice history, card updates, and cancel-at-period-end. Hosted portal login stays off. The restricted key needs permission to write portal configurations as well as portal sessions.

Set `STRIPE_SECRET_KEY` (a restricted key), `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_ID` for the $10 monthly price. Leave them blank and the 3 free questions still work, once `ANTHROPIC_API_KEY` is set. Sales tax is not collected. Turn on Stripe Tax only after you have an active registration. See [Collect taxes for recurring payments](https://docs.stripe.com/billing/taxes/collect-taxes.md).

Comments sit on each recap. A signed-in reader needs a display name first. The email address is not published. Eight comments a day.

## Account

`/login` emails a sign-in link in the same letter as the confirmation email. A new address creates the account. The page says what the account is for: commenting under a public name, and the $10 subscription. Coming from a recap, the comment box asks for the email there and returns to that recap. `/login/in/:nonce` signs that browser in and forgets the code. `/account` holds the comment name, the Ask quota, invoices, and log out. Unsubscribing stops the recap emails and does not delete the account; the same person can sign in again to comment or manage a subscription.

## Costs (rough, per 3-hour meeting)
AssemblyAI ≈ $0.45–1.10 depending on model · Claude Sonnet ≈ $0.30–0.60 (≈60–90k input tokens) · research ≈ $0.10–0.40 (up to 12 web searches at $10/1,000, plus fetched pages) · one Ask question is a few cents · Resend free tier covers 3,000 emails/month.

## Things to know
- **Borough site:** the archive page embeds a Granicus publisher (`ViewPublisher.php`). Discovery follows that frame, stores each clip's MediaPlayer link, and downloads the meeting MP3 (not the multi-gigabyte MP4). Meetings older than `PROCESS_SINCE` are recorded as `SKIPPED` and are not transcribed. The Borough robots.txt blocks some automated fetchers; this checks the archive every 3 hours with an identifying user agent.
- **City of Ketchikan:** the same check reads `@cityofketchikan8631` (council, port and harbors, and city boards). A YouTube video uses YouTube's own captions when they cover the meeting, and otherwise the usual transcription. Set `CITY_YOUTUBE_URL` empty to skip the channel.
- **YouTube from Railway:** YouTube sometimes blocks datacenter IPs ("confirm you're not a bot"). Fix: export cookies from a throwaway Google account, `base64 -w0 cookies.txt`, set `YTDLP_COOKIES_B64`. The channel's public videos page is also read, so a blocked listing still finds recent uploads.
- **Accuracy:** Claude is told to use names only when clearly spoken, never print "Speaker A", and flag unclear votes. Every item links to its timestamp in the video. Keep approval on for the first several meetings.
- **Body categories** come from title keywords in `src/util.ts` (`BODIES`).
- **Signup abuse:** `/subscribe` sends a confirmation email to any address; add rate limiting (e.g. `@nestjs/throttler`) or Cloudflare Turnstile before promoting it widely.
