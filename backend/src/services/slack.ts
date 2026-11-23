import jwt from 'jsonwebtoken';
import { config } from '../config';
import { query } from '../db/pool';
import { redis } from '../lib/redis';

export interface SlackConnection {
  user_id: string;
  team_id: string | null;
  team_name: string | null;
  channel: string | null;
  channel_id: string | null;
  webhook_url: string;
}

export const slackConfigured = () =>
  Boolean(config.slack.clientId && config.slack.clientSecret && config.slack.redirectUri);

/**
 * The OAuth `state` is a short-lived signed token carrying the user id. This means
 * the callback works even when it arrives on a different host (e.g. an HTTPS
 * tunnel) where the session cookie isn't present, and it prevents CSRF.
 */
export function slackAuthorizeUrl(userId: string): string {
  const state = jwt.sign({ uid: userId, purpose: 'slack_oauth' }, config.jwtSecret, { expiresIn: '10m' });
  const params = new URLSearchParams({
    client_id: config.slack.clientId,
    scope: 'incoming-webhook',
    redirect_uri: config.slack.redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

export function verifySlackState(state: string): string {
  const payload = jwt.verify(state, config.jwtSecret) as { uid: string; purpose: string };
  if (payload.purpose !== 'slack_oauth') throw new Error('bad state');
  return payload.uid;
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  team?: { id: string; name: string };
  incoming_webhook?: { url: string; channel: string; channel_id: string };
}

export async function completeSlackOAuth(userId: string, code: string): Promise<void> {
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.slack.clientId,
      client_secret: config.slack.clientSecret,
      redirect_uri: config.slack.redirectUri,
    }),
  });
  const data = (await res.json()) as SlackOAuthResponse;
  if (!data.ok || !data.incoming_webhook?.url) {
    throw new Error(`Slack OAuth failed: ${data.error ?? 'no incoming webhook returned'}`);
  }
  await query(
    `INSERT INTO slack_connections (user_id, team_id, team_name, channel, channel_id, webhook_url, access_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE SET
       team_id = EXCLUDED.team_id, team_name = EXCLUDED.team_name, channel = EXCLUDED.channel,
       channel_id = EXCLUDED.channel_id, webhook_url = EXCLUDED.webhook_url,
       access_token = EXCLUDED.access_token, updated_at = now()`,
    [
      userId,
      data.team?.id ?? null,
      data.team?.name ?? null,
      data.incoming_webhook.channel,
      data.incoming_webhook.channel_id,
      data.incoming_webhook.url,
      data.access_token ?? null,
    ],
  );
}

/** Read fresh from the DB every time, so connect/disconnect takes effect without a redeploy. */
export async function getSlackConnection(userId: string): Promise<SlackConnection | null> {
  const rows = await query<SlackConnection>(`SELECT * FROM slack_connections WHERE user_id = $1`, [userId]);
  return rows[0] ?? null;
}

export async function disconnectSlack(userId: string): Promise<void> {
  await query(`DELETE FROM slack_connections WHERE user_id = $1`, [userId]);
}

export async function postToSlack(conn: SlackConnection, payload: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(conn.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[slack] webhook responded ${res.status}: ${text}`);
    // Webhook was revoked / channel deleted on Slack's side: forget it.
    if (res.status === 404 || res.status === 410 || /no_service|channel_not_found|invalid_token/.test(text)) {
      await disconnectSlack(conn.user_id);
    }
    return false;
  }
  return true;
}

/**
 * Fired the moment a sender (or campaign) hits its hourly cap. Deduplicated with
 * SET NX so N parallel jobs hitting the cap together produce exactly one message
 * per user + sender + hour window. Never throws: Slack must not break sending.
 */
export async function notifyRateLimitHit(args: {
  userId: string;
  senderId: number;
  senderEmail: string;
  limitType: 'sender' | 'campaign';
  limit: number;
  window: number;
  resumesAt: Date;
}): Promise<void> {
  try {
    const conn = await getSlackConnection(args.userId);
    if (!conn) return; // not connected => silently skip

    const dedupeKey = `slack:ratelimit:${args.userId}:${args.limitType}:${args.senderId}:${args.window}`;
    const first = await redis.set(dedupeKey, '1', 'EX', 2 * 3600, 'NX');
    if (first !== 'OK') return;

    const what =
      args.limitType === 'sender'
        ? `Sender *${args.senderEmail}* reached its hourly limit of *${args.limit}* emails.`
        : `Your campaign reached its hourly limit of *${args.limit}* emails (sender ${args.senderEmail}).`;

    const ok = await postToSlack(conn, {
      text: `⏳ Hourly rate limit reached for ${args.senderEmail}`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `:hourglass_flowing_sand: *Rate limit reached*\n${what}` } },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Remaining emails were rescheduled, not dropped. Sending resumes at ${args.resumesAt.toISOString()}.`,
            },
          ],
        },
      ],
    });
    if (!ok) await redis.del(dedupeKey);
  } catch (err) {
    console.error('[slack] rate-limit notification failed', err);
  }
}
