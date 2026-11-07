# Email Scheduler (BullMQ + Redis + Ethereal)

Production-style email scheduler service with a dashboard.

- Accepts email send requests via a REST API
- Schedules each one for a specific time as a **BullMQ delayed job** (no cron, no `setTimeout`)
- Sends through **Ethereal Email** (fake SMTP); each sent mail gets a preview URL
- **Survives restarts**: jobs live in Redis, not in process memory
- Dashboard at `/` to schedule, filter, cancel and retry emails

## Quick start

```bash
docker compose up -d        # Redis with AOF persistence
cp .env.example .env
npm install
npm run dev                 # http://localhost:3000
```

Production: `npm run build && npm start`.

## API

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/emails` | `{ to, subject, body, sendAt?, html? }`. `sendAt` is ISO-8601 (omit to send now) |
| POST | `/api/emails/bulk` | `{ emails: [ ... ] }` up to 1000 |
| GET | `/api/emails?status=` | `scheduled \| queued \| sending \| sent \| failed` |
| GET | `/api/emails/:id` | One email, incl. `previewUrl` once sent |
| DELETE | `/api/emails/:id` | Cancel a scheduled/queued/failed email |
| POST | `/api/emails/:id/retry` | Retry a failed email |
| GET | `/api/stats` | Counts per status |
| GET | `/health` | Redis health |

```bash
curl -X POST localhost:3000/api/emails -H 'content-type: application/json' \
  -d '{"to":"lead@example.com","subject":"Hi","body":"Hello!","sendAt":"2026-11-07T12:00:00Z"}'
```

## How restart-survival works

1. `scheduleEmail` adds a BullMQ job with `delay = sendAt - now`; Redis stores it in a sorted set.
2. On boot the worker reconnects to the same queue; BullMQ promotes due delayed jobs, including
   ones that came due while the server was down, and re-queues stalled `active` jobs from a crash.
3. Redis runs with AOF (`appendonly yes`) so jobs also survive a Redis restart.
4. The Ethereal account credentials are cached in Redis so restarts reuse the same inbox.
5. SIGINT/SIGTERM close the worker gracefully (in-flight sends finish first).

## Config (`.env`)

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` | 3000 | HTTP port |
| `REDIS_URL` | redis://127.0.0.1:6379 | Redis |
| `WORKER_CONCURRENCY` | 5 | Parallel sends |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | 0 (off) / 3600000 | Global rate limit, e.g. 100 per hour |
| `MAX_RETRIES` | 3 | Attempts with exponential backoff |
| `SMTP_URL` | unset | Override Ethereal (testing), e.g. `smtp://localhost:2525` |

## Testing without internet

```bash
npx tsx scripts/smtp-sink.ts                      # local SMTP sink
SMTP_URL=smtp://localhost:2525 npm run dev
npm run test:e2e                                  # schedules 3 mails; kill -9 the server mid-wait to prove persistence
```

## Layout

```
src/config.ts   env config          src/queue.ts   BullMQ queue + scheduleEmail
src/mailer.ts   Ethereal/nodemailer src/worker.ts  BullMQ worker (concurrency, limiter, retries)
src/routes.ts   REST API            src/server.ts  bootstrap + graceful shutdown
public/index.html  dashboard
```
