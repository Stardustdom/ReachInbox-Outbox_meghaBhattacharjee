import { Worker } from 'bullmq';
import { config } from './config';
import { migrate } from './db/migrate';
import { pool } from './db/pool';
import { createRedis, redis } from './lib/redis';
import { EmailJobData } from './queue/emailQueue';
import { processEmailJob } from './workers/emailProcessor';
import { closeTransports } from './services/mailer';

export function startWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(config.queue.name, processEmailJob, {
    connection: createRedis(),
    concurrency: config.queue.concurrency,
    // Locks are renewed automatically; if a worker dies, the job becomes "stalled"
    // and is picked up by another worker (DB claim + lease prevents double sends).
    lockDuration: 60_000,
    maxStalledCount: 2,
  });

  worker.on('ready', () =>
    console.log(
      `[worker] ready (concurrency=${config.queue.concurrency}, ` +
        `minGap=${config.queue.minDelayBetweenSendsMs}ms/sender, ` +
        `limit=${config.queue.maxEmailsPerHourPerSender}/h/sender)`,
    ),
  );
  worker.on('completed', (job, result) => console.log(`[worker] ${job.id} done`, result));
  worker.on('failed', (job, err) =>
    console.warn(`[worker] ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`),
  );
  worker.on('error', (err) => console.error('[worker] error', err));
  return worker;
}

async function main() {
  await migrate();
  const worker = startWorker();

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, finishing active jobs...`);
    await worker.close(); // waits for in-flight jobs; delayed jobs stay safely in Redis
    await closeTransports();
    await redis.quit();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[worker] fatal', err);
    process.exit(1);
  });
}
