import { config } from './config';
import { createApp } from './app';
import { migrate } from './db/migrate';
import { pool } from './db/pool';
import { redis } from './lib/redis';
import { emailQueue } from './queue/emailQueue';
import { ensureSenders } from './services/mailer';
import { ensureIndex } from './services/search';
import { reconcileQueue } from './services/scheduler';
import { startWorker } from './worker';

async function main() {
  await migrate();
  await ensureSenders();
  await ensureIndex();
  // Postgres -> BullMQ consistency check; idempotent thanks to deterministic job ids.
  await reconcileQueue();

  const worker = config.runWorkerInProcess ? startWorker() : null;

  const server = createApp().listen(config.port, () => {
    console.log(`[api] listening on http://localhost:${config.port} (pid=${process.pid}, worker in-process=${!!worker})`);
    console.log(`[api] Bull Board: http://localhost:${config.port}/admin/queues`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close();
    if (worker) await worker.close();
    await emailQueue.close();
    await redis.quit();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[api] fatal', err);
  process.exit(1);
});
