import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/session';
import { DONE_STATUSES, listEmails, PENDING_STATUSES } from '../db/emailRepo';
import { asyncHandler } from '../lib/http';
import { scheduleCampaign } from '../services/scheduler';
import { searchEmails } from '../services/search';

const router = Router();
router.use(requireAuth);

const scheduleSchema = z.object({
  subject: z.string().trim().min(1).max(255),
  body: z.string().min(1).max(50_000),
  recipients: z.array(z.string().trim().email()).min(1).max(20_000),
  startAt: z.coerce.date(),
  delaySeconds: z.number().int().min(0).max(24 * 3600),
  hourlyLimit: z.number().int().min(1).max(100_000),
});

/** POST /api/emails/schedule  — accepts a campaign (one subject/body, many leads). */
router.post(
  '/schedule',
  asyncHandler(async (req, res) => {
    const input = scheduleSchema.parse(req.body);
    const key = req.header('Idempotency-Key')?.slice(0, 200) || undefined;
    const result = await scheduleCampaign(req.user!.id, input, key);
    res.status(result.duplicate ? 200 : 201).json(result);
  }),
);

const listSchema = z.object({
  type: z.enum(['scheduled', 'sent']).default('scheduled'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { type, page, pageSize } = listSchema.parse(req.query);
    const statuses = type === 'scheduled' ? PENDING_STATUSES : DONE_STATUSES;
    res.json(await listEmails(req.user!.id, statuses, page, pageSize));
  }),
);

const searchSchema = z.object({
  q: z.string().trim().max(200).default(''),
  type: z.enum(['scheduled', 'sent', 'all']).default('all'),
});

/** GET /api/emails/search?q=...&type=scheduled|sent|all — backed by Elasticsearch. */
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const { q, type } = searchSchema.parse(req.query);
    const statuses =
      type === 'scheduled' ? PENDING_STATUSES : type === 'sent' ? DONE_STATUSES : [...PENDING_STATUSES, ...DONE_STATUSES];
    const items = await searchEmails(req.user!.id, q, statuses);
    res.json({ items, total: items.length, page: 1, pageSize: items.length });
  }),
);

export default router;
