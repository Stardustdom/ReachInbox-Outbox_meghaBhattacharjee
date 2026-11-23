import IORedis, { Redis } from 'ioredis';
import { config } from '../config';

/** BullMQ requires maxRetriesPerRequest: null on its connections. */
export function createRedis(): Redis {
  return new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
}

/** Shared connection for rate-limit counters, throttles and dedupe keys. */
export const redis = createRedis();
