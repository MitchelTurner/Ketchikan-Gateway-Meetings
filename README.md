# KGB Meeting Digest

Watches the Ketchikan Gateway Borough [meeting video archive](https://www.kgbak.us/434/Meeting-Video-Archive), transcribes each new meeting, has Claude write a plain-language recap, and emails it to residents who sign up.

```
every 3h ─▶ discover ─▶ process (1 at a time) ─────────────────────────────────────────────▶ review email to you
            archive page  web research → yt-dlp audio → AssemblyAI/Whisper → Claude digest     │ approve link
            + Granicus                                                                ▼
            clips                                                 deliver ─▶ email queue (rate-limited)
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
| `AWAITING_APPROVAL` | Transcript and recap are saved. When Resend is configured, a review email goes to `ADMIN_EMAIL`. Until then, read the transcript on the meetings page. |
| `SENT` | Queued to subscribers. Per-subscriber results are in `EmailSend`. |
| `PUBLISHED` | Older than `EMAIL_SINCE`: approved and on `/notes`, not emailed. |
| `FAILED` | See `error`; retried automatically 3×, or re-run with the process endpoint. |

Set `AUTO_SEND=true` to skip approval once you trust the output.

## Backfilling older meetings
Set `PROCESS_SINCE` back, e.g. `PROCESS_SINCE=2023-11-01` for three years, and redeploy. On start (and every discovery run), meetings that were saved as `SKIPPED` and now fall inside the window are queued.

- **Newest first.** Jobs are prioritized by meeting date, so a meeting from this week always jumps ahead of the backlog.
- **No email for old meetings.** Anything dated before `EMAIL_SINCE` (default: 14 days ago) gets no review email and is never sent to subscribers. With `AUTO_SEND=true` it is published straight to `/notes` (status `PUBLISHED`). Otherwise it waits in `AWAITING_APPROVAL`: approve one from `/admin/meetings` or publish them all with `POST /admin/publish-backfill`. Drafts are readable on `/meetings/:id` before then.
- **Research uses the roster as of the meeting date**, not today's, so names from a 2023 Assembly are checked against the 2023 members.
- **Throughput:** one meeting at a time, about 30–45 minutes each, so a few hundred meetings take roughly a week. Watch progress with `GET /admin/stats`.
- **Cost:** about $1–2 per meeting (transcription + research + recap). 200 meetings ≈ $200–400. Narrow it by moving `PROCESS_SINCE` forward; meetings already done are kept.
- Only clips listed on the Granicus archive can be pulled. `GET /admin/inspect` shows how far back it goes.

## Topics and deep dives
Some issues run for months: a budget, a harbor project, a zoning case. Topics follow one issue across meetings.

1. **Claude suggests topics.** After each recap, Claude tags the meeting with the topics it touched and suggests new ones. On start, recaps that haven't been tagged yet (including the backfill) are tagged too, so suggestions reflect the whole year.
2. **You approve them** at `/admin/topics` (open `/admin/topics?token=$ADMIN_TOKEN` once to sign in). Suggestions are ranked by how many meetings raised them. "Not a topic" archives one so it's never suggested again.
3. **Approved topics** get a public page at `/topics/:slug` with a timeline of every meeting, and appear as a choice on the signup form and the preferences page. The topic page has a "Follow" form that signs up for topic emails only.
4. **Key moments trigger a deep dive.** When a meeting is a milestone for an approved topic (a final vote, a budget adopted, a contract awarded, a hearing held, a major new proposal), Claude drafts an explainer from every meeting on that topic plus local news coverage: what just happened, why it matters, how we got here, what residents said, what's next. It's emailed to you for review like a recap, then sent only to subscribers following that topic, and becomes the story on the topic page. `AUTO_SEND=true` skips the review. Backfilled meetings never trigger one; use "Write a deep dive now" on `/admin/topics` for a first explainer.

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

`KNOWN_NAMES="Jane Doe — Borough Clerk; …"` pins spellings the web gets wrong. Research failing never stops a meeting; it carries on without it and tries again next run. Coverage often appears days later: `POST /admin/meetings/:id/process?reanalyze=true` redoes the research and the recap (the transcript is reused). Set `RESEARCH_ENABLED=false` to turn it off.

## Admin endpoints (Bearer `ADMIN_TOKEN`)
- `GET /admin/inspect` — what's on the archive page
- `POST /admin/discover` — check the archive now
- `GET /admin/meetings?status=FAILED` — list meetings. In a browser, open `/admin/meetings?token=YOUR_ADMIN_TOKEN` to read transcripts before Resend is connected. `hasTranscript` is true once transcription has finished.
- `POST /admin/meetings/:id/process[?reanalyze=true]` — retry / force / regenerate the research and recap
- `GET /admin/meetings/:id/preview` — the email as subscribers will see it
- `GET /admin/meetings/:id/transcript` — transcript text in a browser, JSON from curl
- `POST /admin/publish-backfill` — publish every drafted recap older than `EMAIL_SINCE` on `/notes` (no email)
- `GET /admin/stats`

Resend can stay unset while you check a transcript. The meeting lands on `AWAITING_APPROVAL` and the review email is skipped. Add `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL`, and `MAILING_ADDRESS`, then open the meeting again or re-run process to send the review.

## Public pages
`/` front page: signup, latest recaps, the docket of meetings being transcribed · `/topics` and `/topics/:slug` issues followed across meetings · `/meetings/:id` one meeting's transcript and draft recap, before any email is sent · `/notes` newest published recaps, with search · `/notes/:id` one emailed recap · `/confirm/:token` · `/preferences/:token` (pick bodies) · `/unsubscribe/:token` (also RFC 8058 one-click). Light theme only. The home page lists a transcript as soon as it exists. `/notes` stays limited to recaps that were approved and emailed.

The archive check runs when the server starts, not only on the 3-hour schedule. Meetings in the processing window that stopped early (a deploy resets the in-container queue) are queued again, including ones that already have a transcript but never got a recap. Download and transcription are skipped when those stages are already saved.

## Costs (rough, per 3-hour meeting)
AssemblyAI ≈ $0.45–1.10 depending on model · Claude Sonnet ≈ $0.30–0.60 (≈60–90k input tokens) · research ≈ $0.10–0.40 (up to 12 web searches at $10/1,000, plus fetched pages) · Resend free tier covers 3,000 emails/month.

## Things to know
- **Borough site:** the archive page embeds a Granicus publisher (`ViewPublisher.php`). Discovery follows that frame, stores each clip's MediaPlayer link, and downloads the meeting MP3 (not the multi-gigabyte MP4). Meetings older than `PROCESS_SINCE` are recorded as `SKIPPED` and are not transcribed. The Borough robots.txt blocks some automated fetchers; this checks the archive every 3 hours with an identifying user agent.
- **YouTube from Railway:** YouTube sometimes blocks datacenter IPs ("confirm you're not a bot"). Fix: export cookies from a throwaway Google account, `base64 -w0 cookies.txt`, set `YTDLP_COOKIES_B64`.
- **Accuracy:** Claude is told to use names only when clearly spoken, never print "Speaker A", and flag unclear votes. Every item links to its timestamp in the video. Keep approval on for the first several meetings.
- **Body categories** come from title keywords in `src/util.ts` (`BODIES`).
- **Signup abuse:** `/subscribe` sends a confirmation email to any address; add rate limiting (e.g. `@nestjs/throttler`) or Cloudflare Turnstile before promoting it widely.
