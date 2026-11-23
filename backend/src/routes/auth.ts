import crypto from 'crypto';
import { Router } from 'express';
import { config } from '../config';
import { query } from '../db/pool';
import { asyncHandler } from '../lib/http';
import { AuthUser, clearSessionCookie, requireAuth, setSessionCookie } from '../auth/session';
import { getSlackConnection, slackConfigured } from '../services/slack';

const router = Router();
const STATE_COOKIE = 'ri_oauth_state';

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

router.get('/google', (_req, res) => {
  if (!config.google.clientId || !config.google.clientSecret) {
    res.redirect(`${config.frontendUrl}/login?error=google_not_configured`);
    return;
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: 10 * 60 * 1000,
    path: '/',
  });
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    const fail = (reason: string) => res.redirect(`${config.frontendUrl}/login?error=${encodeURIComponent(reason)}`);

    if (error) return fail(error);
    if (!code || !state || state !== req.cookies?.[STATE_COOKIE]) return fail('invalid_state');
    res.clearCookie(STATE_COOKIE, { path: '/' });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: config.google.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      console.error('[auth] token exchange failed', await tokenRes.text());
      return fail('token_exchange_failed');
    }
    const tokens = (await tokenRes.json()) as { access_token: string };

    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoRes.ok) return fail('userinfo_failed');
    const info = (await infoRes.json()) as GoogleUserInfo;
    if (info.email_verified === false) return fail('email_not_verified');

    const [row] = await query<{ id: string; email: string; name: string; avatar_url: string | null }>(
      `INSERT INTO users (google_id, email, name, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_id) DO UPDATE
         SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url, updated_at = now()
       RETURNING id, email, name, avatar_url`,
      [info.sub, info.email, info.name ?? info.email, info.picture ?? null],
    );

    const user: AuthUser = { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url };
    setSessionCookie(res, user);
    res.redirect(`${config.frontendUrl}/dashboard`);
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const slack = await getSlackConnection(req.user!.id);
    res.json({
      user: req.user,
      slack: {
        available: slackConfigured(),
        connected: Boolean(slack),
        teamName: slack?.team_name ?? null,
        channel: slack?.channel ?? null,
      },
    });
  }),
);

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
