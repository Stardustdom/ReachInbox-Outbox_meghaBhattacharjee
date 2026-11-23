import { Queue } from 'bullmq';
import { config } from '../config';
import { createRedis } from '../lib/redis';
import { chunk } from '../lib/http';

export interface EmailJobData {
  emailId: string;
  /** Hour window (floor(ms / 1h)) in which this job already holds a rate-limit slot. */
  reservedWindow?: number;
  /** Epoch ms of the per-sender throttle slot this job already holds. */
  sendSlot?: number;
}

export const emailQueue = new Queue<EmailJobData>(config.queue.name, {
  connection: createRedis(),
  defaultJobOptions: {
    attempts: config.queue.maxAttempts,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

/**
 * Deterministic job id = idempotency at the queue level. BullMQ ignores an add()
 * whose jobId already exists, so re-enqueueing (on reconcile / retries / double
 * submits) can never create a second job for the same email.
 * (Custom ids must not contain ':' in BullMQ.)
 */
export const jobIdFor = (emailId: string) => `email-${emailId}`;

export async function enqueueEmails(rows: { id: string; scheduled_at: Date }[]): Promise<void> {
  const now = Date.now();
  for (const part of chunk(rows, 500)) {
    await emailQueue.addBulk(
      part.map((row) => ({
        name: 'send',
        data: { emailId: row.id },
        opts: {
          jobId: jobIdFor(row.id),
          delay: Math.max(0, new Date(row.scheduled_at).getTime() - now),
        },
      })),
    );
  }
}
