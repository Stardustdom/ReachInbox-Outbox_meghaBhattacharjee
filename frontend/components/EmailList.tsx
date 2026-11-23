'use client';
import type { Email, EmailTab } from '@/lib/types';
import { formatBadgeTime } from '@/lib/format';
import { htmlToText } from '@/lib/html';
import { EmptyState } from './ui/EmptyState';
import { Spinner } from './ui/Spinner';
import { Button } from './ui/Button';
import { ClockIcon } from './ui/icons';

/** The pill between recipient and subject: scheduled time, or sent/failed. */
export function StatusPill({ email }: { email: Email }) {
  if (email.status === 'sent') return <span className="shrink-0 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Sent</span>;
  if (email.status === 'failed')
    return (
      <span className="shrink-0 rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600" title={email.error ?? undefined}>
        Failed
      </span>
    );
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-600"
      title={email.status === 'delayed' ? 'Rescheduled by the hourly rate limit' : undefined}
    >
      <ClockIcon size={12} />
      {formatBadgeTime(email.scheduledAt)}
    </span>
  );
}

interface Props {
  tab: EmailTab;
  emails: Email[];
  loading: boolean;
  searching: boolean;
  onOpen: (email: Email) => void;
  onCompose: () => void;
}

export function EmailList({ tab, emails, loading, searching, onOpen, onCompose }: Props) {
  if (loading && emails.length === 0) {
    return (
      <div className="flex items-center justify-center py-24 text-brand-500">
        <Spinner size="lg" />
      </div>
    );
  }

  if (emails.length === 0) {
    if (searching) return <EmptyState icon="🔍" title="No matching emails" description="Try a different recipient, subject or keyword." />;
    return tab === 'scheduled' ? (
      <EmptyState
        icon="🕒"
        title="No scheduled emails"
        description="Emails you schedule will show up here until they are sent."
        action={<Button onClick={onCompose}>Compose new email</Button>}
      />
    ) : (
      <EmptyState icon="📤" title="No sent emails yet" description="Once scheduled emails go out, they appear here with their delivery status." />
    );
  }

  return (
    <ul className="divide-y divide-gray-100 border-y border-gray-100">
      {emails.map((e) => (
        <li key={e.id}>
          <button
            onClick={() => onOpen(e)}
            className="flex w-full flex-col items-start gap-1.5 px-4 py-3 text-left text-sm hover:bg-gray-50 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
          >
            <span className="flex w-full shrink-0 items-center justify-between gap-2 sm:w-52 sm:justify-start">
              <span className="truncate font-medium text-gray-900">To: {e.recipient}</span>
              <span className="sm:hidden">
                <StatusPill email={e} />
              </span>
            </span>
            <span className="hidden sm:block">
              <StatusPill email={e} />
            </span>
            <span className="w-full min-w-0 flex-1 truncate">
              <span className="font-medium text-gray-900">{e.subject}</span>
              <span className="text-gray-400"> - {htmlToText(e.body)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
