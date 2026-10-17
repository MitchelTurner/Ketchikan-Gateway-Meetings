# KGB Meeting Digest

Watches the Ketchikan Gateway Borough [meeting video archive](https://www.kgbak.us/434/Meeting-Video-Archive), transcribes each new meeting, has Claude write a plain-language recap, and emails it to residents who sign up.

```
every 3h ─▶ discover ─▶ process (1 at a time) ───────────────────────────▶ review email to you
            scrape page   yt-dlp audio → AssemblyAI/Whisper → Claude digest         │ approve link
            + expand YT                                                              ▼
            channels                                              deliver ─▶ email queue (rate-limited)
```

## Stack
NestJS 11 · BullMQ on Redis · Prisma/Postgres · yt-dlp + ffmpeg · AssemblyAI (or OpenAI Whisper) · Claude API · Resend. One Railway service runs the web app and all workers.

## Deploy on Railway
1. New project → add **Postgres** and **Redis** → add this repo as a service (it builds from the Dockerfile).
2. Set variables from `env.example`. Reference `${{Postgres.DATABASE_URL}}`. Redis is optional: if `REDIS_URL` is unset, the container runs Redis itself and the job queue resets on every deploy. To keep jobs across deploys, add Redis and set `REDIS_URL=${{Redis.REDIS_URL}}`.
3. Verify your sending domain in Resend and set `EMAIL_FROM` to an address on it.
4. Deploy. The schema is applied on start (`prisma db push`).
5. **Check what the scraper sees** — the video host isn't known yet:
   ```
   curl -H "Authorization: Bearer $ADMIN_TOKEN" https://YOUR_APP/admin/inspect
   ```
   `detected` lists videos found; `embeds` lists every iframe/script on the page. If `detected` is empty, the host in `embeds` needs a rule in `src/discovery/video-detect.ts` (`classify`).
6. Kick off the first run: `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://YOUR_APP/admin/discover`

## How a meeting flows
| Status | Meaning |
|---|---|
| `SKIPPED` | Dated before `PROCESS_SINCE` (or no date found). Force with `POST /admin/meetings/:id/process`. |
| `DOWNLOADING` → `TRANSCRIBING` → `ANALYZING` | Working. Finished stages are saved and reused on retry. |
| `AWAITING_APPROVAL` | Review email sent to `ADMIN_EMAIL` with an approve link. |
| `SENT` | Queued to subscribers. Per-subscriber results are in `EmailSend`. |
| `FAILED` | See `error`; retried automatically 3×, or re-run with the process endpoint. |

Set `AUTO_SEND=true` to skip approval once you trust the output.

## Admin endpoints (Bearer `ADMIN_TOKEN`)
- `GET /admin/inspect` — what's on the archive page
- `POST /admin/discover` — check the archive now
- `GET /admin/meetings?status=FAILED` — list meetings
- `POST /admin/meetings/:id/process[?reanalyze=true]` — retry / force / regenerate the recap
- `GET /admin/meetings/:id/preview` — the email as subscribers will see it
- `GET /admin/meetings/:id/transcript` — raw transcript JSON
- `GET /admin/stats`

## Public pages
`/` signup (double opt-in) · `/confirm/:token` · `/preferences/:token` (pick bodies) · `/unsubscribe/:token` (also RFC 8058 one-click). Light theme only.

## Costs (rough, per 3-hour meeting)
AssemblyAI ≈ $0.45–1.10 depending on model · Claude Sonnet ≈ $0.30–0.60 (≈60–90k input tokens) · Resend free tier covers 3,000 emails/month.

## Things to know
- **Borough site:** its robots.txt blocks some automated fetchers. This checks one page every 3 hours with an identifying user agent. If the videos turn out to be on YouTube, consider pointing `ARCHIVE_URL` at a page that just links the channel, or ask the Clerk's office — they may be glad to help.
- **YouTube from Railway:** YouTube sometimes blocks datacenter IPs ("confirm you're not a bot"). Fix: export cookies from a throwaway Google account, `base64 -w0 cookies.txt`, set `YTDLP_COOKIES_B64`.
- **Accuracy:** Claude is told to use names only when clearly spoken, never print "Speaker A", and flag unclear votes. Every item links to its timestamp in the video. Keep approval on for the first several meetings.
- **Body categories** come from title keywords in `src/util.ts` (`BODIES`).
- **Signup abuse:** `/subscribe` sends a confirmation email to any address; add rate limiting (e.g. `@nestjs/throttler`) or Cloudflare Turnstile before promoting it widely.
