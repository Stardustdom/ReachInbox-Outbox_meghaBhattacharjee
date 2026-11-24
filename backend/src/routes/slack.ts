import { Router } from 'express';
import { config } from '../config';
import { requireAuth, requireAuthPage } from '../auth/session';
import { asyncHandler } from '../lib/http';
import {
  completeSlackOAuth,
  disconnectSlack,
  getSlackConnection,
  postToSlack,
  slackAuthorizeUrl,
  slackConfigured,
  verifySlackState,
} from '../services/slack';

const router = Router();

/** Browser navigates here from the "Connect Slack" button. */
router.get('/connect', requireAuthPage, (req, res) => {
  if (!slackConfigured()) {
    res.redirect(`${config.frontendUrl}/dashboard?slack=not_configured`);
    return;
  }
  res.redirect(slackAuthorizeUrl(req.user!.id));
});

/** Slack redirects here after the user approves (may arrive via an HTTPS tunnel). */
router.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    const back = (status: string) => res.redirect(`${config.frontendUrl}/dashboard?slack=${status}`);
    if (error) return back('denied');
    if (!code || !state) return back('error');
    let userId: string;
    try {
      userId = verifySlackState(state);
    } catch {
      return back('invalid_state');
    }
    try {
      await completeSlackOAuth(userId, code);
      return back('connected');
    } catch (err) {
      console.error('[slack] oauth callback failed', err);
      return back('error');
    }
  }),
);

router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const conn = await getSlackConnection(req.user!.id);
    res.json({ available: slackConfigured(), connected: Boolean(conn), teamName: conn?.team_name ?? null, channel: conn?.channel ?? null });
  }),
);

router.post(
  '/test',
  requireAuth,
  asyncHandler(async (req, res) => {
    const conn = await getSlackConnection(req.user!.id);
    if (!conn) {
      res.status(400).json({ error: 'Slack is not connected' });
      return;
    }
    const ok = await postToSlack(conn, { text: ':white_check_mark: ReachInbox test alert: Slack is connected.' });
    if (!ok) {
      res.status(502).json({ error: 'Slack rejected the test message' });
      return;
    }
    res.json({ ok: true });
  }),
);

router.delete(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    await disconnectSlack(req.user!.id);
    res.json({ ok: true });
  }),
);

export default router;
