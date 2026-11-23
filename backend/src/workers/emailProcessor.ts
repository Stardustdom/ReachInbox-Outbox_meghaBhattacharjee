import { DelayedError, Job } from 'bullmq';
import { config, HOUR_MS } from '../config';
import { claimEmail, getEmailForJob, markAttemptFailed, markDelayed, markSent } from '../db/emailRepo';
import { EmailJobData } from '../queue/emailQueue';
import { sleep } from '../lib/http';
import { getSender, sendEmail } from '../services/mailer';
import { hourWindow, reserveHourlySlot, reserveSendSlot, windowStart } from '../services/rateLimiter';
import { reindexEmail } from '../services/search';
import { notifyRateLimitHit } from '../services/slack';

const q = config.queue;

async function delayJob(job: Job<EmailJobData>, token: string | undefined, until: number, patch: Partial<EmailJobData>) {
  await job.updateData({ ...job.data, ...patch });
  await job.moveToDelayed(until, token);
  // Tells BullMQ the job was moved (not failed); does not consume an attempt.
  throw new DelayedError();
}

/**
 * Pipeline for one email:
 *   1. load row; skip if already terminal          (idempotency)
 *   2. reserve an hourly slot (sender + campaign)   (rate limit, Redis, cross-worker)
 *        -> full? reschedule into next free window + Slack notification
 *   3. reserve a per-sender send slot               (min delay between sends)
 *   4. atomically claim row -> 'sending'            (only one worker can win)
 *   5. SMTP send -> 'sent'  | error -> retry / 'failed'
 */
export async function processEmailJob(job: Job<EmailJobData>, token?: string) {
  const email = await getEmailForJob(job.data.emailId, q.sendingLeaseMs);
  if (!email) return { skipped: 'not_found' };
  if (email.status === 'sent' || email.status === 'failed') return { skipped: email.status };

  // Another worker is mid-send for this row (shouldn't happen thanks to unique job
  // ids, but be defensive): look again after its lease would expire.
  if (email.status === 'sending' && email.lease_active) {
    const until = new Date(email.locked_at!).getTime() + q.sendingLeaseMs + 1000;
    return delayJob(job, token, until, {});
  }

  // ---- 2. hourly limit ----------------------------------------------------
  const nowWindow = hourWindow(Date.now());
  if (job.data.reservedWindow !== nowWindow) {
    const reservation = await reserveHourlySlot({
      senderId: email.sender_id,
      campaignId: email.campaign_id,
      campaignLimit: email.hourly_limit,
      fromWindow: nowWindow,
    });

    if (reservation.window > nowWindow) {
      // Spread rescheduled emails inside the target window in reservation order,
      // which follows the original scheduled order => order is preserved.
      const spacing = Math.max(email.delay_ms, q.minDelayBetweenSendsMs);
      const offset = Math.min((reservation.position - 1) * spacing, HOUR_MS - 1000);
      const until = windowStart(reservation.window) + offset;

      await markDelayed(email.id, new Date(until));
      await reindexEmail(email.id);
      void notifyRateLimitHit({
        userId: email.user_id,
        senderId: email.sender_id,
        senderEmail: email.sender_email,
        limitType: reservation.blockedBy ?? 'sender',
        limit: reservation.blockedBy === 'campaign' ? email.hourly_limit : q.maxEmailsPerHourPerSender,
        window: nowWindow,
        resumesAt: new Date(windowStart(nowWindow + 1)),
      });
      return delayJob(job, token, until, { reservedWindow: reservation.window, sendSlot: undefined });
    }
    await job.updateData({ ...job.data, reservedWindow: nowWindow });
  }

  // ---- 3. min delay between sends (per sender) ----------------------------
  const heldSlot = job.data.sendSlot;
  if (!(heldSlot && Date.now() >= heldSlot - 250)) {
    const { slot, now } = await reserveSendSlot(email.sender_id);
    const wait = slot - now;
    if (wait > q.maxInlineThrottleWaitMs) {
      // Long queue for this sender: don't hog a concurrency slot, come back later.
      return delayJob(job, token, Date.now() + wait, { sendSlot: Date.now() + wait });
    }
    if (wait > 0) await sleep(wait);
  }

  // ---- 4. claim -------------------------------------------------------------
  const claimed = await claimEmail(email.id, q.sendingLeaseMs);
  if (!claimed) return { skipped: 'already_claimed' };

  // ---- 5. send ---------------------------------------------------------------
  try {
    const sender = await getSender(email.sender_id);
    const result = await sendEmail(sender, {
      emailId: email.id,
      to: email.recipient,
      subject: email.subject,
      body: email.body,
    });
    await markSent(email.id, result.messageId, result.previewUrl);
    await reindexEmail(email.id);
    return { sent: true, previewUrl: result.previewUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await markAttemptFailed(email.id, message, final);
    await reindexEmail(email.id);
    throw err; // BullMQ applies exponential backoff until attempts are exhausted
  }
}
