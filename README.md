# KGB Meeting Digest

Watches the Ketchikan Gateway Borough [meeting video archive](https://www.kgbak.us/434/Meeting-Video-Archive), transcribes each new meeting, has Claude write a plain-language recap, and emails it to residents who sign up.

```
every 3h ─▶ discover ─▶ process (1 at a time) ───────────────────────────▶ review email to you
            archive page  yt-dlp audio → AssemblyAI/Whisper → Claude digest         │ approve link
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
| `DOWNLOADING` → `TRANSCRIBING` → `ANALYZING` | Working. Finished stages are saved and reused on retry. |
| `AWAITING_APPROVAL` | Transcript and recap are saved. When Resend is configured, a review email goes to `ADMIN_EMAIL`. Until then, read the transcript on the meetings page. |
| `SENT` | Queued to subscribers. Per-subscriber results are in `EmailSend`. |
| `FAILED` | See `error`; retried automatically 3×, or re-run with the process endpoint. |

Set `AUTO_SEND=true` to skip approval once you trust the output.

## Admin endpoints (Bearer `ADMIN_TOKEN`)
- `GET /admin/inspect` — what's on the archive page
- `POST /admin/discover` — check the archive now
- `GET /admin/meetings?status=FAILED` — list meetings. In a browser, open `/admin/meetings?token=YOUR_ADMIN_TOKEN` to read transcripts before Resend is connected. `hasTranscript` is true once transcription has finished.
- `POST /admin/meetings/:id/process[?reanalyze=true]` — retry / force / regenerate the recap
- `GET /admin/meetings/:id/preview` — the email as subscribers will see it
- `GET /admin/meetings/:id/transcript` — transcript text in a browser, JSON from curl
- `GET /admin/stats`

Resend can stay unset while you check a transcript. The meeting lands on `AWAITING_APPROVAL` and the review email is skipped. Add `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL`, and `MAILING_ADDRESS`, then open the meeting again or re-run process to send the review.

## Public pages
`/` signup, the clips found on the archive, and meetings currently being transcribed · `/meetings/:id` one meeting's transcript and draft recap, before any email is sent · `/notes` newest published recaps, with search · `/notes/:id` one emailed recap · `/confirm/:token` · `/preferences/:token` (pick bodies) · `/unsubscribe/:token` (also RFC 8058 one-click). Light theme only. The home page lists a transcript as soon as it exists. `/notes` stays limited to recaps that were approved and emailed.

The archive check runs when the server starts, not only on the 3-hour schedule. Meetings that were found but not transcribed (a deploy resets the in-container queue) are queued again.

## Costs (rough, per 3-hour meeting)
AssemblyAI ≈ $0.45–1.10 depending on model · Claude Sonnet ≈ $0.30–0.60 (≈60–90k input tokens) · Resend free tier covers 3,000 emails/month.

## Things to know
- **Borough site:** the archive page embeds a Granicus publisher (`ViewPublisher.php`). Discovery follows that frame, stores each clip's MediaPlayer link, and downloads the meeting MP3 (not the multi-gigabyte MP4). Meetings older than `PROCESS_SINCE` are recorded as `SKIPPED` and are not transcribed. The Borough robots.txt blocks some automated fetchers; this checks the archive every 3 hours with an identifying user agent.
- **YouTube from Railway:** YouTube sometimes blocks datacenter IPs ("confirm you're not a bot"). Fix: export cookies from a throwaway Google account, `base64 -w0 cookies.txt`, set `YTDLP_COOKIES_B64`.
- **Accuracy:** Claude is told to use names only when clearly spoken, never print "Speaker A", and flag unclear votes. Every item links to its timestamp in the video. Keep approval on for the first several meetings.
- **Body categories** come from title keywords in `src/util.ts` (`BODIES`).
- **Signup abuse:** `/subscribe` sends a confirmation email to any address; add rate limiting (e.g. `@nestjs/throttler`) or Cloudflare Turnstile before promoting it widely.
