import { HOUR_MS, config } from '../config';
import { query, withTransaction } from '../db/pool';
import { EmailRow, getEmailsByIds, listPendingForReconcile, toDto } from '../db/emailRepo';
import { emailQueue, enqueueEmails, jobIdFor } from '../queue/emailQueue';
import { chunk, HttpError } from '../lib/http';
import { listSenders } from './mailer';
import { indexEmails } from './search';

export interface ScheduleInput {
  subject: string;
  body: string;
  recipients: string[];
  startAt: Date;
  delaySeconds: number;
  hourlyLimit: number;
}

/**
 * Pre-computes a send time for every recipient:
 *   t(i) = start + i * delay, pushed into the next clock-hour window whenever the
 *   campaign's hourly limit for the current window is used up.
 * Windows are clock-aligned (same buckets the worker's Redis counters use), so the
 * times shown in the dashboard match what the worker will actually do. The worker
 * still enforces limits independently (other campaigns share the same senders).
 */
export function computeSendTimes(count: number, startMs: number, delayMs: number, hourlyLimit: number): number[] {
  const times: number[] = [];
  let t = startMs;
  let window = Math.floor(t / HOUR_MS);
  let inWindow = 0;
  for (let i = 0; i < count; i++) {
    if (i > 0) t += delayMs;
    const w = Math.floor(t / HOUR_MS);
    if (w !== window) {
      window = w;
      inWindow = 0;
    }
    if (inWindow >= hourlyLimit) {
      window += 1;
      inWindow = 0;
      t = Math.max(t, window * HOUR_MS);
    }
    inWindow++;
    times.push(t);
  }
  return times;
}

export async function scheduleCampaign(userId: string, input: ScheduleInput, idempotencyKey?: string) {
  // Same Idempotency-Key => return the original campaign, never schedule twice.
  if (idempotencyKey) {
    const existing = await query<{ id: string; total: number }>(
      `SELECT id, total FROM campaigns WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey],
    );
    if (existing[0]) return { campaignId: existing[0].id, total: existing[0].total, duplicate: true };
  }

  const senders = await listSenders();
  if (senders.length === 0) throw new HttpError(503, 'No SMTP senders configured');

  const recipients = [...new Set(input.recipients.map((r) => r.trim().toLowerCase()))];
  const startMs = Math.max(input.startAt.getTime(), Date.now());
  const delayMs = input.delaySeconds * 1000;
  const times = computeSendTimes(recipients.length, startMs, delayMs, input.hourlyLimit);
  // Round-robin recipients across sender mailboxes.
  const senderIds = recipients.map((_, i) => senders[i % senders.length].id);

  let campaignId: string;
  try {
    campaignId = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO campaigns (user_id, subject, body, start_at, delay_ms, hourly_limit, total, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [userId, input.subject, input.body, new Date(startMs), delayMs, input.hourlyLimit, recipients.length, idempotencyKey ?? null],
      );
      const id = rows[0].id;
      for (const part of chunk(recipients.map((r, i) => ({ r, t: times[i], s: senderIds[i] })), 1000)) {
        await client.query(
          `INSERT INTO emails (campaign_id, user_id, sender_id, recipient, subject, body, scheduled_at)
           SELECT $1::uuid, $2::uuid, s, r, $3::text, $4::text, t
           FROM unnest($5::text[], $6::timestamptz[], $7::int[]) AS x(r, t, s)`,
          [id, userId, input.subject, input.body, part.map((p) => p.r), part.map((p) => new Date(p.t)), part.map((p) => p.s)],
        );
      }
      return id;
    });
  } catch (err: unknown) {
    // Lost a race with a concurrent request using the same idempotency key.
    if ((err as { code?: string }).code === '23505' && idempotencyKey) {
      return scheduleCampaign(userId, input, idempotencyKey);
    }
    throw err;
  }

  const rows = await query<EmailRow>(
    `SELECT e.*, s.email AS sender_email FROM emails e JOIN senders s ON s.id = e.sender_id
     WHERE e.campaign_id = $1 ORDER BY e.scheduled_at`,
    [campaignId],
  );

  // DB commit happened first; if Redis is briefly unavailable the rows are still
  // safe and the boot-time reconciler will enqueue them.
  try {
    await enqueueEmails(rows);
  } catch (err) {
    console.error('[scheduler] enqueue failed; rows will be picked up by reconcileQueue()', err);
  }
  await indexEmails(rows.map(toDto));

  return {
    campaignId,
    total: rows.length,
    firstAt: new Date(times[0]).toISOString(),
    lastAt: new Date(times[times.length - 1]).toISOString(),
    duplicate: false,
  };
}

/**
 * Runs on boot. Postgres is the source of truth: every email that is still pending
 * must have exactly one BullMQ job. Because job ids are deterministic, adding an
 * existing job is a no-op, so this is safe to run any number of times, and it
 * recovers from a wiped Redis too. Jobs already sitting in Redis keep their
 * original timestamps, so nothing restarts from scratch.
 */
export async function reconcileQueue(): Promise<void> {
  const pending = await listPendingForReconcile(config.queue.sendingLeaseMs);
  let restored = 0;
  for (const part of chunk(pending, 200)) {
    const jobs = await Promise.all(part.map((row) => emailQueue.getJob(jobIdFor(row.id))));
    const missing: typeof part = [];
    for (let i = 0; i < part.length; i++) {
      const job = jobs[i];
      if (!job) {
        missing.push(part[i]);
        continue;
      }
      const state = await job.getState();
      // Job finished in Redis but the DB still says pending (e.g. crash between steps).
      if (state === 'completed' || state === 'failed') {
        await job.remove();
        missing.push(part[i]);
      }
    }
    if (missing.length) {
      await enqueueEmails(missing);
      restored += missing.length;
    }
  }
  console.log(`[scheduler] reconcile: ${pending.length} pending emails, ${restored} jobs (re)created`);
}

export async function getCampaignEmails(ids: string[]) {
  return (await getEmailsByIds(ids)).map(toDto);
}
