CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id   TEXT UNIQUE NOT NULL,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS senders (
  id           SERIAL PRIMARY KEY,
  email        TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  smtp_host    TEXT NOT NULL,
  smtp_port    INT  NOT NULL,
  smtp_secure  BOOLEAN NOT NULL DEFAULT false,
  smtp_user    TEXT NOT NULL,
  smtp_pass    TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  start_at         TIMESTAMPTZ NOT NULL,
  delay_ms         INT NOT NULL,
  hourly_limit     INT NOT NULL,
  total            INT NOT NULL,
  idempotency_key  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS emails (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id     INT  NOT NULL REFERENCES senders(id),
  recipient     TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled', 'delayed', 'sending', 'sent', 'failed')),
  scheduled_at  TIMESTAMPTZ NOT NULL,
  sent_at       TIMESTAMPTZ,
  attempts      INT NOT NULL DEFAULT 0,
  error         TEXT,
  message_id    TEXT,
  preview_url   TEXT,
  locked_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- one email per recipient per campaign: duplicate leads in a CSV can never be sent twice
  UNIQUE (campaign_id, recipient)
);

CREATE INDEX IF NOT EXISTS emails_user_status_sched_idx ON emails (user_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS emails_user_sent_idx ON emails (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS emails_pending_idx ON emails (status) WHERE status IN ('scheduled', 'delayed', 'sending');

CREATE TABLE IF NOT EXISTS slack_connections (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  team_id      TEXT,
  team_name    TEXT,
  channel      TEXT,
  channel_id   TEXT,
  webhook_url  TEXT NOT NULL,
  access_token TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
