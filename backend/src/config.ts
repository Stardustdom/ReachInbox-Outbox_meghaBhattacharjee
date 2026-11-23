import 'dotenv/config';

function str(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required env variable: ${key}`);
  }
  return value;
}

function optional(key: string): string {
  return process.env[key] ?? '';
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Env variable ${key} must be a non-negative integer (got "${raw}")`);
  }
  return value;
}

export const config = {
  port: int('PORT', 4000),
  frontendUrl: str('FRONTEND_URL', 'http://localhost:3000'),
  jwtSecret: str('JWT_SECRET'),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  runWorkerInProcess: process.env.RUN_WORKER_IN_PROCESS === 'true',

  databaseUrl: str('DATABASE_URL'),
  redisUrl: str('REDIS_URL', 'redis://localhost:6379'),
  elasticsearch: {
    url: optional('ELASTICSEARCH_URL'),
    index: process.env.ELASTICSEARCH_INDEX || 'emails',
  },

  google: {
    clientId: optional('GOOGLE_CLIENT_ID'),
    clientSecret: optional('GOOGLE_CLIENT_SECRET'),
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback',
  },
  slack: {
    clientId: optional('SLACK_CLIENT_ID'),
    clientSecret: optional('SLACK_CLIENT_SECRET'),
    redirectUri: optional('SLACK_REDIRECT_URI'),
  },

  ethereal: {
    senders: optional('ETHEREAL_SENDERS'),
    autoCreate: int('ETHEREAL_AUTO_CREATE_SENDERS', 2),
  },

  queue: {
    name: 'email-send',
    concurrency: Math.max(1, int('WORKER_CONCURRENCY', 5)),
    minDelayBetweenSendsMs: int('MIN_DELAY_BETWEEN_SENDS_MS', 2000),
    maxEmailsPerHourPerSender: Math.max(1, int('MAX_EMAILS_PER_HOUR_PER_SENDER', 200)),
    maxAttempts: Math.max(1, int('MAX_SEND_ATTEMPTS', 3)),
    sendingLeaseMs: int('SENDING_LEASE_MS', 10 * 60 * 1000),
    maxInlineThrottleWaitMs: int('MAX_INLINE_THROTTLE_WAIT_MS', 10_000),
  },
} as const;

export const HOUR_MS = 60 * 60 * 1000;
