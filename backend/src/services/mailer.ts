import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { query } from '../db/pool';

export interface Sender {
  id: number;
  email: string;
  name: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
}

const ETHEREAL_HOST = 'smtp.ethereal.email';
const ETHEREAL_PORT = 587;

async function upsertSender(user: string, pass: string, name: string) {
  await query(
    `INSERT INTO senders (email, name, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass)
     VALUES ($1, $2, $3, $4, false, $1, $5)
     ON CONFLICT (email) DO UPDATE SET smtp_pass = EXCLUDED.smtp_pass, active = true`,
    [user, name, ETHEREAL_HOST, ETHEREAL_PORT, pass],
  );
}

/**
 * Makes sure we have at least one Ethereal mailbox to send from.
 *  1. ETHEREAL_SENDERS="user:pass,user:pass" are upserted.
 *  2. Otherwise, if the table is empty, N throwaway accounts are created through
 *     the Ethereal API and persisted, so restarts reuse the same senders.
 */
export async function ensureSenders(): Promise<void> {
  const pairs = config.ethereal.senders
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  for (const [i, pair] of pairs.entries()) {
    const idx = pair.indexOf(':');
    if (idx < 1) throw new Error(`ETHEREAL_SENDERS entry #${i + 1} must be "user:pass"`);
    await upsertSender(pair.slice(0, idx), pair.slice(idx + 1), `Sender ${i + 1}`);
  }

  const [{ n }] = await query<{ n: string }>(`SELECT count(*) AS n FROM senders WHERE active`);
  if (Number(n) > 0) return;

  for (let i = 0; i < config.ethereal.autoCreate; i++) {
    const account = await nodemailer.createTestAccount();
    await upsertSender(account.user, account.pass, `Ethereal Sender ${i + 1}`);
    console.log(`[mailer] created Ethereal sender ${account.user} (password: ${account.pass})`);
  }
}

export async function listSenders(): Promise<Sender[]> {
  return query<Sender>(`SELECT * FROM senders WHERE active ORDER BY id`);
}

const senderCache = new Map<number, Sender>();
const transports = new Map<number, Transporter>();

export async function getSender(id: number): Promise<Sender> {
  const cached = senderCache.get(id);
  if (cached) return cached;
  const [row] = await query<Sender>(`SELECT * FROM senders WHERE id = $1`, [id]);
  if (!row) throw new Error(`Sender ${id} not found`);
  senderCache.set(id, row);
  return row;
}

function transportFor(sender: Sender): Transporter {
  let t = transports.get(sender.id);
  if (!t) {
    t = nodemailer.createTransport({
      host: sender.smtp_host,
      port: sender.smtp_port,
      secure: sender.smtp_secure,
      auth: { user: sender.smtp_user, pass: sender.smtp_pass },
      pool: true,
      maxConnections: 2,
    });
    transports.set(sender.id, t);
  }
  return t;
}

/** The dashboard's editor sends HTML; older/plain bodies are still accepted. */
const looksLikeHtml = (s: string) => /<[a-z][^>]*>/i.test(s);

function htmlToText(s: string): string {
  if (!looksLikeHtml(s)) return s;
  return s
    .replace(/<(br|\/p|\/div|\/li|\/blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

export async function sendEmail(
  sender: Sender,
  mail: { emailId: string; to: string; subject: string; body: string },
) {
  const info = await transportFor(sender).sendMail({
    from: { name: sender.name, address: sender.email },
    to: mail.to,
    subject: mail.subject,
    text: htmlToText(mail.body),
    html: looksLikeHtml(mail.body) ? mail.body : mail.body.replace(/\n/g, '<br/>'),
    // Deterministic Message-ID: if a crash forces a resend, mail providers that
    // de-duplicate on Message-ID will treat it as the same message.
    messageId: `<${mail.emailId}@reachinbox-scheduler.local>`,
  });
  const preview = nodemailer.getTestMessageUrl(info);
  return { messageId: info.messageId ?? null, previewUrl: preview || null };
}

export async function closeTransports() {
  for (const t of transports.values()) t.close();
  transports.clear();
}
