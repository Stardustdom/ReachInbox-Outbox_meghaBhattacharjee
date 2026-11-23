import { config, HOUR_MS } from '../config';
import { redis } from '../lib/redis';

/**
 * All limiter state lives in Redis, so it is shared by every worker process and
 * every instance. Each operation is a single Lua script => atomic, no races
 * between concurrent jobs.
 */

// KEYS[1] = sender counter for window, KEYS[2] = campaign counter for window
// ARGV[1] = sender limit, ARGV[2] = campaign limit (0 = none), ARGV[3] = ttl seconds
// Returns position (1-based) inside the window, -1 if sender is full, -2 if campaign is full.
const RESERVE_HOURLY_LUA = `
local s = tonumber(redis.call('GET', KEYS[1]) or '0')
local c = tonumber(redis.call('GET', KEYS[2]) or '0')
local sl = tonumber(ARGV[1])
local cl = tonumber(ARGV[2])
if s >= sl then return -1 end
if cl > 0 and c >= cl then return -2 end
local pos = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
return pos
`;

// KEYS[1] = per-sender "next free send time" key; ARGV[1] = gap ms.
// Uses Redis server TIME so every worker agrees on "now" (no clock-skew issues).
// Returns { slotMs, nowMs }.
const RESERVE_SEND_SLOT_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local gap = tonumber(ARGV[1])
local nxt = tonumber(redis.call('GET', KEYS[1]) or '0')
local slot = math.max(now, nxt)
redis.call('SET', KEYS[1], slot + gap, 'PX', (slot - now) + gap + 60000)
return { slot, now }
`;

redis.defineCommand('reserveHourly', { numberOfKeys: 2, lua: RESERVE_HOURLY_LUA });
redis.defineCommand('reserveSendSlot', { numberOfKeys: 1, lua: RESERVE_SEND_SLOT_LUA });

type LimiterRedis = typeof redis & {
  reserveHourly(k1: string, k2: string, senderLimit: number, campaignLimit: number, ttl: number): Promise<number>;
  reserveSendSlot(k1: string, gapMs: number): Promise<[number, number]>;
};
const r = redis as LimiterRedis;

/** Search horizon for the next free hour window (30 days). */
const MAX_LOOKAHEAD_WINDOWS = 24 * 30;

export const hourWindow = (ms: number) => Math.floor(ms / HOUR_MS);
export const windowStart = (window: number) => window * HOUR_MS;

export interface HourlyReservation {
  window: number;
  position: number;
  /** Which limit was hit in the first window we tried (null = got a slot immediately). */
  blockedBy: 'sender' | 'campaign' | null;
}

export async function reserveHourlySlot(opts: {
  senderId: number;
  campaignId: string;
  campaignLimit: number;
  fromWindow: number;
}): Promise<HourlyReservation> {
  const senderLimit = config.queue.maxEmailsPerHourPerSender;
  let blockedBy: HourlyReservation['blockedBy'] = null;

  for (let w = opts.fromWindow; w < opts.fromWindow + MAX_LOOKAHEAD_WINDOWS; w++) {
    const ttlSeconds = Math.ceil((windowStart(w + 1) - Date.now()) / 1000) + 3600;
    const result = await r.reserveHourly(
      `rl:sender:${opts.senderId}:${w}`,
      `rl:campaign:${opts.campaignId}:${w}`,
      senderLimit,
      opts.campaignLimit,
      Math.max(ttlSeconds, 60),
    );
    if (result > 0) return { window: w, position: result, blockedBy };
    if (blockedBy === null) blockedBy = result === -1 ? 'sender' : 'campaign';
  }
  throw new Error('No rate-limit capacity found in the next 30 days');
}

export async function reserveSendSlot(senderId: number): Promise<{ slot: number; now: number }> {
  const [slot, now] = await r.reserveSendSlot(`throttle:sender:${senderId}`, config.queue.minDelayBetweenSendsMs);
  return { slot: Number(slot), now: Number(now) };
}
