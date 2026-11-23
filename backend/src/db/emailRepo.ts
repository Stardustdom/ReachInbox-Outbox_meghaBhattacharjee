import { query } from './pool';

export type EmailStatus = 'scheduled' | 'delayed' | 'sending' | 'sent' | 'failed';

export const PENDING_STATUSES: EmailStatus[] = ['scheduled', 'delayed', 'sending'];
export const DONE_STATUSES: EmailStatus[] = ['sent', 'failed'];

export interface EmailRow {
  id: string;
  campaign_id: string;
  user_id: string;
  sender_id: number;
  sender_email: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduled_at: Date;
  sent_at: Date | null;
  attempts: number;
  error: string | null;
  message_id: string | null;
  preview_url: string | null;
  locked_at: Date | null;
}

export interface EmailForJob extends EmailRow {
  delay_ms: number;
  hourly_limit: number;
  lease_active: boolean;
}

/** Shape returned by the API and stored in Elasticsearch. */
export interface EmailDto {
  id: string;
  userId: string;
  campaignId: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  senderEmail: string;
  scheduledAt: string;
  sentAt: string | null;
  attempts: number;
  error: string | null;
  previewUrl: string | null;
}

export function toDto(row: EmailRow): EmailDto {
  return {
    id: row.id,
    userId: row.user_id,
    campaignId: row.campaign_id,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    status: row.status,
    senderEmail: row.sender_email,
    scheduledAt: new Date(row.scheduled_at).toISOString(),
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    attempts: row.attempts,
    error: row.error,
    previewUrl: row.preview_url,
  };
}

const SELECT_EMAIL = `
  SELECT e.*, s.email AS sender_email
  FROM emails e JOIN senders s ON s.id = e.sender_id`;

export async function getEmailsByIds(ids: string[]): Promise<EmailRow[]> {
  if (ids.length === 0) return [];
  return query<EmailRow>(`${SELECT_EMAIL} WHERE e.id = ANY($1::uuid[])`, [ids]);
}

export async function getEmailForJob(id: string, leaseMs: number): Promise<EmailForJob | null> {
  const rows = await query<EmailForJob>(
    `SELECT e.*, s.email AS sender_email, c.delay_ms, c.hourly_limit,
            (e.locked_at IS NOT NULL AND e.locked_at > now() - ($2::int * interval '1 millisecond')) AS lease_active
     FROM emails e
     JOIN senders s ON s.id = e.sender_id
     JOIN campaigns c ON c.id = e.campaign_id
     WHERE e.id = $1`,
    [id, leaseMs],
  );
  return rows[0] ?? null;
}

/**
 * Atomic claim. Only one worker can move a row into 'sending'; a stale 'sending'
 * row (worker crashed mid-send) can be reclaimed once its lease expires.
 */
export async function claimEmail(id: string, leaseMs: number): Promise<boolean> {
  const rows = await query(
    `UPDATE emails
        SET status = 'sending', locked_at = now(), attempts = attempts + 1, updated_at = now()
      WHERE id = $1
        AND (status IN ('scheduled', 'delayed')
             OR (status = 'sending' AND locked_at < now() - ($2::int * interval '1 millisecond')))
      RETURNING id`,
    [id, leaseMs],
  );
  return rows.length === 1;
}

export async function markSent(id: string, messageId: string | null, previewUrl: string | null) {
  await query(
    `UPDATE emails
        SET status = 'sent', sent_at = now(), message_id = $2, preview_url = $3,
            error = NULL, locked_at = NULL, updated_at = now()
      WHERE id = $1 AND status = 'sending'`,
    [id, messageId, previewUrl],
  );
}

export async function markAttemptFailed(id: string, error: string, final: boolean) {
  await query(
    `UPDATE emails
        SET status = CASE WHEN $3 THEN 'failed' ELSE 'scheduled' END,
            sent_at = CASE WHEN $3 THEN now() ELSE sent_at END,
            error = $2, locked_at = NULL, updated_at = now()
      WHERE id = $1 AND status = 'sending'`,
    [id, error.slice(0, 1000), final],
  );
}

export async function markDelayed(id: string, until: Date) {
  await query(
    `UPDATE emails SET status = 'delayed', scheduled_at = $2, updated_at = now()
      WHERE id = $1 AND status IN ('scheduled', 'delayed')`,
    [id, until],
  );
}

export async function listEmails(userId: string, statuses: EmailStatus[], page: number, pageSize: number) {
  const sentView = statuses.every((s) => DONE_STATUSES.includes(s));
  const order = sentView ? 'e.sent_at DESC NULLS LAST' : 'e.scheduled_at ASC';
  const [items, count] = await Promise.all([
    query<EmailRow>(
      `${SELECT_EMAIL} WHERE e.user_id = $1 AND e.status = ANY($2::text[])
       ORDER BY ${order}, e.id LIMIT $3 OFFSET $4`,
      [userId, statuses, pageSize, (page - 1) * pageSize],
    ),
    query<{ total: string }>(
      `SELECT count(*) AS total FROM emails WHERE user_id = $1 AND status = ANY($2::text[])`,
      [userId, statuses],
    ),
  ]);
  return { items: items.map(toDto), total: Number(count[0]?.total ?? 0), page, pageSize };
}

export async function searchEmailsDb(userId: string, q: string, statuses: EmailStatus[], limit: number) {
  const rows = await query<EmailRow>(
    `${SELECT_EMAIL}
     WHERE e.user_id = $1 AND e.status = ANY($2::text[])
       AND (e.recipient ILIKE $3 OR e.subject ILIKE $3 OR e.body ILIKE $3)
     ORDER BY e.scheduled_at DESC LIMIT $4`,
    [userId, statuses, `%${q}%`, limit],
  );
  return rows.map(toDto);
}

/** Rows that should have a live BullMQ job (used by the boot-time reconciler). */
export async function listPendingForReconcile(leaseMs: number) {
  return query<{ id: string; scheduled_at: Date }>(
    `SELECT id, scheduled_at FROM emails
      WHERE status IN ('scheduled', 'delayed')
         OR (status = 'sending' AND locked_at < now() - ($1::int * interval '1 millisecond'))
      ORDER BY scheduled_at`,
    [leaseMs],
  );
}
