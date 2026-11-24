/**
 * Schedules N emails at the same moment to demonstrate behaviour under load.
 *   npm run load-test -- --email you@gmail.com --count 1000 --hourly 50
 */
import { query, pool } from '../src/db/pool';
import { ensureSenders } from '../src/services/mailer';
import { computeSendTimes, scheduleCampaign } from '../src/services/scheduler';
import { emailQueue } from '../src/queue/emailQueue';
import { redis } from '../src/lib/redis';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const email = arg('email', '');
  const count = Number(arg('count', '1000'));
  const hourly = Number(arg('hourly', '1000'));
  const delay = Number(arg('delay', '0'));
  if (!email) throw new Error('--email <your login email> is required');

  const [user] = await query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  if (!user) throw new Error(`No user ${email}; log in through the dashboard first`);
  await ensureSenders();

  const startAt = new Date(Date.now() + 10_000);
  const recipients = Array.from({ length: count }, (_, i) => `lead${i + 1}+${Date.now()}@example.com`);
  const plan = computeSendTimes(count, startAt.getTime(), delay * 1000, hourly);
  console.log(`Campaign plan: first=${new Date(plan[0]).toISOString()} last=${new Date(plan[plan.length - 1]).toISOString()}`);

  const t0 = Date.now();
  const result = await scheduleCampaign(user.id, {
    subject: `Load test ${new Date().toISOString()}`,
    body: 'Hello from the scheduler load test.',
    recipients,
    startAt,
    delaySeconds: delay,
    hourlyLimit: hourly,
  });
  console.log(`Scheduled ${result.total} emails in ${Date.now() - t0}ms`);
  console.log('Queue counts:', await emailQueue.getJobCounts('delayed', 'waiting', 'active', 'completed', 'failed'));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await emailQueue.close();
    await redis.quit();
    await pool.end();
  });
