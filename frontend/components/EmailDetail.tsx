'use client';
import { useMemo } from 'react';
import type { Email } from '@/lib/types';
import { formatLongDate } from '@/lib/format';
import { sanitizeHtml } from '@/lib/html';
import { ArrowLeftIcon } from './ui/icons';
import { StatusPill } from './EmailList';

export function EmailDetail({ email, onBack }: { email: Email; onBack: () => void }) {
  const body = useMemo(() => sanitizeHtml(email.body), [email.body]);
  const when = email.sentAt ?? email.scheduledAt;
  const initial = (email.senderEmail[0] ?? '?').toUpperCase();

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 py-5 sm:px-8">
      <div className="flex items-center gap-3">
        <button onClick={onBack} aria-label="Back" className="rounded-full p-2 text-gray-600 hover:bg-gray-100">
          <ArrowLeftIcon size={20} />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold sm:text-xl">{email.subject}</h1>
        <StatusPill email={email} />
      </div>

      <div className="mt-6 flex items-start gap-3 sm:pl-12">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-semibold text-white">{initial}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <p className="truncate text-sm">
              <span className="font-semibold">{email.senderEmail}</span>
            </p>
            <p className="text-xs text-gray-500">{email.sentAt ? 'Sent ' : 'Scheduled '}{formatLongDate(when)}</p>
          </div>
          <p className="truncate text-xs text-gray-500">to {email.recipient}</p>

          <div className="mt-6 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800 [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6" dangerouslySetInnerHTML={{ __html: body }} />

          {email.status === 'failed' && email.error && <p className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{email.error}</p>}
          {email.previewUrl && (
            <a href={email.previewUrl} target="_blank" rel="noreferrer" className="mt-6 inline-block text-sm font-medium text-brand-600 hover:underline">
              Open Ethereal preview ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
