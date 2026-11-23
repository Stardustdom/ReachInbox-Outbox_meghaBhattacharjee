# ReachInbox: Full-stack Email Job Scheduler

A production-style email scheduler with a dashboard:

- **Backend:** TypeScript, Express, BullMQ (Redis), PostgreSQL, Elasticsearch, Nodemailer with Ethereal SMTP, Bull Board, Slack OAuth
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Google OAuth login

There are **no cron jobs anywhere.** Every send is a BullMQ *delayed job*. Postgres is the source of truth, and Redis holds the timers.

```
reachinbox-scheduler/
├── docker-compose.yml        # Postgres 16, Redis 7 (AOF), Elasticsearch 8
├── sample-leads.csv
├── backend/
│   ├── migrations/001_init.sql
│   └── src/
│       ├── server.ts         # API process (migrate → senders → ES index → reconcile → listen)
│       ├── worker.ts         # BullMQ worker process (configurable concurrency)
│       ├── app.ts            # Express app + Bull Board at /admin/queues
│       ├── config.ts         # all limits come from env
│       ├── auth/session.ts   # JWT session cookie, requireAuth
│       ├── db/               # pg pool, migration runner, email repository
│       ├── queue/emailQueue.ts
│       ├── routes/           # auth, emails, slack
│       ├── services/         # scheduler, rateLimiter (Lua), mailer, search (ES), slack
│       └── workers/emailProcessor.ts
└── frontend/
    ├── app/                  # /login, /dashboard
    ├── components/ui/        # Button, RichTextEditor, Pagination, Toast, EmptyState, Avatar, Spinner, icons
    ├── components/           # Sidebar, SlackCard, EmailList, EmailDetail, ComposeView, SendLater
    ├── hooks/                # useAuth, useEmails, useDebounced
    └── lib/                  # typed API client, types, CSV lead parser, formatters
```

---

## 1. Running it locally

### Prerequisites
Node 20 or newer, Docker, a Google Cloud OAuth client, and (for Slack alerts) a Slack app.

### 1.1 Start the infrastructure
```bash
docker compose up -d          # postgres:5432, redis:6379, elasticsearch:9200
```

### 1.2 Backend
```bash
cd backend
cp .env.example .env          # fill in the values (see section 2)
npm install
npm run dev                   # API on :4000 (runs migrations automatically)
npm run dev:worker            # in a second terminal: BullMQ worker
```
For a single-process setup, set `RUN_WORKER_IN_PROCESS=true` and skip `dev:worker`.
For production, run `npm run build && npm start` plus `npm run start:worker`. You can run as many worker instances as you like.

### 1.3 Frontend
```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev                   # http://localhost:3000
```
Next.js proxies `/api/*` to the backend, so the browser only ever talks to `:3000`. This keeps the session cookie first-party.

### 1.4 Useful URLs
| What | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| Bull Board (live queue view, login required) | http://localhost:4000/admin/queues |
| Health | http://localhost:4000/api/health |

---

## 2. Environment and third-party setup

### Ethereal Email (fake SMTP)
- **Zero config:** leave `ETHEREAL_SENDERS` empty. On first boot the API creates `ETHEREAL_AUTO_CREATE_SENDERS` (default 2) accounts through Ethereal's API and **stores them in Postgres**, so restarts reuse the same mailboxes. Their credentials are printed in the API log, and you can log in at https://ethereal.email with them to see the delivered messages.
- **Manual:** create accounts at https://ethereal.email/create and set `ETHEREAL_SENDERS=user1@ethereal.email:pass1,user2@ethereal.email:pass2`.
- Every sent email has a **Preview** link in the Sent table (`nodemailer.getTestMessageUrl`).

### Google OAuth
1. Go to Google Cloud Console → APIs & Services → Credentials → *Create OAuth client ID* (Web application).
2. Set the Authorized redirect URI to `http://localhost:3000/api/auth/google/callback`.
3. Put the values into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Slack OAuth (rate-limit alerts)
1. Create an app at https://api.slack.com/apps (*From scratch*).
2. Under **OAuth & Permissions**, add the bot scope `incoming-webhook` and the redirect URL from `SLACK_REDIRECT_URI`.
3. Slack requires **HTTPS** redirect URLs. Run a tunnel such as `ngrok http 4000`, or `cloudflared tunnel --url http://localhost:4000`, and set `SLACK_REDIRECT_URI=https://<tunnel>/api/slack/callback`.
   The OAuth `state` is a signed JWT containing the user id, so the callback works even though the tunnel domain doesn't carry the session cookie.
4. Put the values into `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`.

### All limits are env-driven
| Variable | Default | Meaning |
|---|---|---|
| `WORKER_CONCURRENCY` | 5 | BullMQ worker concurrency per process |
| `MIN_DELAY_BETWEEN_SENDS_MS` | **2000** | Minimum gap between two sends **from the same sender** |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | 200 | Hard cap per sender per clock hour |
| `MAX_SEND_ATTEMPTS` | 3 | SMTP retries (exponential backoff, base 30 s) |
| `SENDING_LEASE_MS` | 600000 | How long a crashed in-flight send blocks reclaiming |
| `MAX_INLINE_THROTTLE_WAIT_MS` | 10000 | Short throttle waits are slept; longer ones re-delay the job |

---

## 3. Architecture

```
 Browser ──► Next.js (:3000) ──/api proxy──► Express API (:4000)
                                              │  POST /api/emails/schedule
                                              ▼
                               ┌──── Postgres (source of truth) ────┐
                               │ campaigns, emails (status, times)  │
                               └────────────────────────────────────┘
                                              │ addBulk(delayed jobs, jobId = email-<uuid>)
                                              ▼
                                   Redis / BullMQ "email-send"
                                              │ (delay expires)
                                              ▼
                     Worker(s) ── hourly slot (Redis Lua) ── per-sender throttle (Redis Lua)
                          │               │ limit hit → reschedule + Slack webhook
                          ▼
                  claim row (atomic UPDATE) ──► Ethereal SMTP ──► status=sent
                          │
                          └──► Elasticsearch index (search read model)
```

### 3.1 How scheduling works
1. `POST /api/emails/schedule` takes `{ subject, body, recipients[], startAt, delaySeconds, hourlyLimit }`.
2. Recipients are de-duplicated (lowercased) and assigned to sender mailboxes **round-robin**.
3. A send time is pre-computed for each email: `start + i × delay`. When the campaign's hourly limit for a clock hour is used up, the remaining emails roll into the next hour (`computeSendTimes`). The dashboard therefore shows realistic times.
4. In one transaction, a `campaigns` row and N `emails` rows are inserted with `unnest` bulk inserts.
5. After commit, one **BullMQ delayed job** is added per email (`delay = scheduled_at − now`), in batches of 500 with `addBulk`. The emails are also bulk-indexed into Elasticsearch.

### 3.2 Persistence across restarts
- **Delayed jobs live in Redis**, not in process memory. Redis runs with **AOF** (`appendonly yes`, `appendfsync everysec`) and `noeviction`. Stopping or restarting the API or worker doesn't touch the timers, and when a worker comes back BullMQ promotes any jobs that became due while it was down. Nothing restarts from scratch, because each job keeps its original timestamp.
- **Boot-time reconciler** (`reconcileQueue`): Postgres is authoritative. On startup, every `scheduled`/`delayed` email (or a `sending` email whose lease expired) is checked against BullMQ:
  - If the job exists and is still pending, it is left alone, so timing is preserved.
  - If the job is missing (Redis wiped, or a crash between DB commit and enqueue), it is recreated with the remaining delay.
  - If the job is completed or failed in Redis while the DB says pending, it is removed and recreated.
- **Graceful shutdown:** on SIGTERM, `worker.close()` waits for in-flight jobs to finish.

### 3.3 Idempotency (no double sends)
| Layer | Mechanism |
|---|---|
| API | `Idempotency-Key` header (the frontend generates one per compose session) with `UNIQUE(user_id, idempotency_key)`. Double-click or retry returns the original campaign. |
| Data | `UNIQUE(campaign_id, recipient)`: a lead listed twice in a CSV gets one email. |
| Queue | Deterministic `jobId = email-<uuid>`. BullMQ ignores re-adds, so the reconciler can run any number of times. |
| Worker | Terminal rows (`sent`/`failed`) are skipped. The row is **claimed atomically** (`UPDATE … SET status='sending' WHERE status IN ('scheduled','delayed') RETURNING id`), so only one worker can win even if a stalled job is re-run elsewhere. |
| SMTP | Deterministic `Message-ID: <email-uuid@…>` so a forced resend is recognisable as the same message. |

### 3.4 Concurrency
- `new Worker(..., { concurrency: WORKER_CONCURRENCY })`, and you can start any number of worker processes.
- All shared state (rate counters, throttle slots, Slack dedupe keys) lives in **Redis and is mutated only by Lua scripts**, so updates are atomic regardless of how many jobs run in parallel.
- Stalled-job recovery (`lockDuration` 60 s, `maxStalledCount` 2) plus the DB claim and lease prevents both lost jobs and double sends.

### 3.5 Delay between emails
There are two layers:
1. **Per-campaign delay** (user input in Compose): baked into each email's scheduled time.
2. **Provider throttle** (`MIN_DELAY_BETWEEN_SENDS_MS`, **default 2 s, per sender**): a Lua script keeps `throttle:sender:<id>` = *next free send time*. It reserves a slot atomically using **Redis server `TIME`**, so worker clock skew doesn't matter. A short wait is slept inside the job. A long wait (a big backlog) moves the job back to delayed with `job.moveToDelayed` + `DelayedError`, so it doesn't hold a concurrency slot.

I chose a custom Redis throttle over BullMQ's built-in `limiter` because the limiter is queue-wide and also throttles jobs that only need to be *rescheduled*. With 1,000 over-limit jobs, that would waste ~33 minutes re-delaying them at one per 2 s.

### 3.6 Emails-per-hour rate limiting
- Counters are **Redis keys per clock-hour window**: `rl:sender:<senderId>:<floor(now/1h)>` (cap `MAX_EMAILS_PER_HOUR_PER_SENDER`) and `rl:campaign:<campaignId>:<window>` (cap = the campaign's hourly limit from Compose). Both are checked and incremented in **one Lua script**, so the limit is exact across any number of workers and instances. Keys expire automatically.
- When the current window is full, the job is **never dropped or failed**. The worker searches forward for the first window with capacity and reserves a slot there. The job is moved to delayed at `windowStart + (position − 1) × spacing`. The row becomes `delayed` (shown as *Rate limited*) with its new time. The reserved window is stored in `job.data`, so the slot isn't counted twice when the job wakes up.
- **Order preservation:** jobs reach the limiter in scheduled order, so they reserve next-window positions in that order and are spaced inside the window by position.

### 3.7 Slack notification on a rate-limit hit
- **Connect Slack** → `/api/slack/connect` → Slack OAuth v2 (`incoming-webhook`) → `/api/slack/callback` exchanges the code and stores the webhook per user in `slack_connections`.
- The moment a sender's (or campaign's) hourly cap is hit, the worker posts to that user's webhook. A `SET NX` key per user + sender + hour makes this **exactly one message per window**, even when many parallel jobs hit the cap together.
- **Disconnect/reconnect:** the connection is read from Postgres at notification time. If it is not connected, the notification is silently skipped. Connecting later starts notifications immediately, with no redeploy. A revoked webhook (404/410) is auto-removed.

### 3.8 Behaviour under load (1000+ emails at the same time)
- **Ingest:** a single transaction with `unnest` bulk insert, then `addBulk` in batches of 500 and an ES bulk index. 1,000 rows take well under a second.
- **Planning:** `computeSendTimes` already spreads a campaign across hours by its own limit. For example, 1,000 emails at 200/hour become exactly 200 per clock hour for 5 hours, verified.
- **Contention:** if several campaigns share senders and the per-sender cap would be exceeded, the overflow jobs are rescheduled into later windows by the worker (section 3.6). Each overflow job costs a few Redis calls and no SMTP connection.
- **Throughput ceiling:** about `senders × min(3600 / gap_s, MAX_EMAILS_PER_HOUR_PER_SENDER)` per hour. With 2 senders, a 2 s gap and a cap of 200, that is 400 per hour.
- To see it in practice, set `MAX_EMAILS_PER_HOUR_PER_SENDER=2`, then schedule `sample-leads.csv` (5 leads over 2 senders). Overflow emails show *Rate limited* with a new time, and Slack gets one alert.

### 3.9 Search (Elasticsearch)
- Index `emails`, with `search_as_you_type` on recipient and subject, and `text` on body. Filters are `userId` and `status`.
- Documents are indexed on create and **re-indexed on every status change** (delayed, sent, failed).
- `GET /api/emails/search?q=…&type=scheduled|sent|all` powers the dashboard search box. If ES is down or not configured, search falls back to Postgres `ILIKE`. ES is a read model; Postgres stays the source of truth.

### 3.10 API reference
| Method | Path | Notes |
|---|---|---|
| GET | `/api/auth/google`, `/api/auth/google/callback` | Google OAuth |
| GET | `/api/auth/me` | user + Slack status |
| POST | `/api/auth/logout` | |
| POST | `/api/emails/schedule` | body described in 3.1, optional `Idempotency-Key` header |
| GET | `/api/emails?type=scheduled\|sent&page=&pageSize=` | paginated |
| GET | `/api/emails/search?q=&type=` | Elasticsearch |
| GET | `/api/slack/connect`, `/api/slack/callback` | Slack OAuth |
| DELETE | `/api/slack` | disconnect Slack |
| — | `/admin/queues` | Bull Board |

Example with curl (after logging in, copy the `ri_session` cookie):
```bash
curl -X POST http://localhost:3000/api/emails/schedule \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-1' \
  -b 'ri_session=<cookie>' \
  -d '{"subject":"Hi","body":"Hello!","recipients":["a@example.com","b@example.com"],
       "startAt":"2026-11-25T10:00:00Z","delaySeconds":2,"hourlyLimit":100}'
```

---

## 4. Features implemented

**Backend**
- [x] Schedule API storing campaigns and emails in PostgreSQL
- [x] BullMQ delayed jobs, no cron
- [x] Multiple Ethereal senders, round-robin, persisted
- [x] Persistence across restarts (Redis AOF + boot reconciler), no duplicates, nothing restarted from scratch
- [x] Idempotency at the API, DB, queue, worker and SMTP layers
- [x] Configurable worker concurrency, safe for parallel jobs
- [x] Minimum delay between sends (per sender, Redis-backed, default 2 s)
- [x] Hourly rate limit per sender and per campaign, Redis Lua counters, safe across instances, rescheduled into the next window with order preserved
- [x] Slack OAuth with a live notification on a rate-limit hit, deduplicated, plus disconnect/reconnect without redeploy
- [x] Elasticsearch indexing and search (with Postgres fallback)
- [x] Live Bull Board at `/admin/queues`

**Frontend**
- [x] Real Google OAuth login, with name, email and avatar in the header, and Logout
- [x] Dashboard with Scheduled and Sent tabs and a Compose button
- [x] Compose page (full screen, as in the design): recipients as chips (typed or uploaded from CSV/TXT, with detected-email count), subject, rich-text body, delay between emails, hourly limit, and a Send Later popover for the start time (empty = send now)
- [x] Scheduled / Sent lists with a scheduled-time or Sent/Failed badge per row; click a row to open the email
- [x] Scheduled table (email, subject, scheduled time, status) and Sent table (email, subject, sent time, sent/failed, Ethereal preview link)
- [x] Loading states, empty states, error toasts, auto-refresh every 5 s, pagination, ES-backed search
- [x] Slack connect / disconnect card
- [x] Reusable typed UI components and a typed API client

---

## 5. Demo script (≤ 5 min)
1. Log in with Google: the header shows your avatar, name and email.
2. Click **Connect Slack** and authorize the app (needs the HTTPS tunnel from section 2).
3. Compose: upload `sample-leads.csv` ("5 emails detected"), start in 1 minute, delay 5 s, hourly limit 3, then **Schedule**.
4. The Scheduled tab shows times 5 s apart. Leads 4–5 are planned for the next hour because of the limit of 3.
5. **Restart scenario:** schedule a second batch 2 minutes out, then `Ctrl+C` the API and the worker. Wait until the send time passes, start both again, and the emails go out with no duplicates. Show Bull Board and the reconcile log line.
6. **Rate limit:** set `MAX_EMAILS_PER_HOUR_PER_SENDER=2`, restart the worker, and schedule `sample-leads.csv` again. One sender goes over its cap, its rows turn *Rate limited*, and Slack gets the alert.
7. The Sent tab has Ethereal **Preview** links. Use search to find an email.

---

## 6. Assumptions, shortcuts and trade-offs
- **At-least-once at the SMTP boundary.** If a worker dies *after* SMTP accepted the message but *before* the DB update, the row is reclaimed after `SENDING_LEASE_MS` and resent. No system can make this exactly-once without an idempotency key from the provider. The deterministic Message-ID mitigates it.
- **Clock-hour windows** (fixed windows, not sliding). They are simpler and match how providers report quotas. A sliding window would need sorted sets.
- **One Redis instance** is assumed. The Lua scripts touch two keys and are not hash-tagged for Redis Cluster.
- **Senders are global** (shared by all users) and assigned round-robin. A real product would have per-tenant mailboxes, and the limiter keys already support that.
- **Reconciliation runs only on boot**, by design, to stay strictly cron-free.
- **Elasticsearch is best-effort.** Indexing failures are logged and never block sending.
- The dashboard **polls every 5 s** for live status updates. Websockets would be the next step.
- SMTP credentials are stored in plaintext in Postgres for this demo. Production would use a secrets manager or column encryption.
- The UI follows the Figma screenshots (login, list, email view, compose). Not built because the assignment doesn't need them: the Figma's email/password login (shown disabled; Google is the real login), the filter and star buttons, and attachments. The "From" field is informational: senders are rotated automatically.
- The compose editor stores HTML. It is sent as an HTML email with a plain-text fallback, and sanitized to basic formatting tags before it is displayed in the dashboard.
