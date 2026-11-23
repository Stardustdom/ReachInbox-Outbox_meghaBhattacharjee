'use client';
import { useEffect, useState } from 'react';
import type { Email, EmailTab } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import { useCounts, useDebounced, useEmails } from '@/hooks/useEmails';
import { Sidebar } from '@/components/Sidebar';
import { EmailList } from '@/components/EmailList';
import { EmailDetail } from '@/components/EmailDetail';
import { ComposeView } from '@/components/ComposeView';
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner';
import { Pagination } from '@/components/ui/Pagination';
import { MenuIcon, RefreshIcon, SearchIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';

const SLACK_MESSAGES: Record<string, ['success' | 'error' | 'info', string]> = {
  connected: ['success', 'Slack connected — you will be notified when a rate limit is hit'],
  denied: ['info', 'Slack connection cancelled'],
  error: ['error', 'Could not connect Slack, please try again'],
  invalid_state: ['error', 'Slack connection expired, please try again'],
  not_configured: ['error', 'Slack OAuth is not configured on the server'],
};

export default function DashboardPage() {
  const toast = useToast();
  const { user, slack, loading: authLoading, logout, refresh } = useAuth();
  const [tab, setTab] = useState<EmailTab>('scheduled');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [selected, setSelected] = useState<Email | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  const search = useDebounced(query.trim());
  const counts = useCounts(reloadKey);
  const { items, total, loading, error, reload } = useEmails(tab, page, search, reloadKey);

  // Feedback after returning from the Slack OAuth flow.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slackResult = params.get('slack');
    if (!slackResult) return;
    const [kind, message] = SLACK_MESSAGES[slackResult] ?? ['info', `Slack: ${slackResult}`];
    toast[kind](message);
    window.history.replaceState(null, '', '/dashboard');
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setPage(1), [tab, search]);

  if (authLoading || !user) return <FullPageSpinner />;

  // Full-screen views from the design: compose and email detail replace the layout.
  if (composing) {
    return (
      <ComposeView
        onClose={() => setComposing(false)}
        onScheduled={() => {
          setComposing(false);
          setTab('scheduled');
          setReloadKey((k) => k + 1);
        }}
      />
    );
  }
  if (selected) return <EmailDetail email={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <Sidebar
        user={user}
        slack={slack}
        tab={tab}
        counts={counts}
        onTabChange={setTab}
        onCompose={() => setComposing(true)}
        onLogout={logout}
        onSlackChange={refresh}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 px-4 py-4 sm:gap-3 sm:px-6">
          <button onClick={() => setMenuOpen(true)} aria-label="Open menu" className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 lg:hidden">
            <MenuIcon size={20} />
          </button>
          <div className="relative min-w-0 max-w-2xl flex-1">
            <SearchIcon size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search emails"
              className="h-10 w-full rounded-full bg-surface pl-10 pr-4 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          {loading && items.length > 0 && <Spinner size="sm" className="text-brand-500" />}
          <button onClick={() => void reload()} aria-label="Refresh" title="Refresh" className="rounded-full p-2 text-gray-500 hover:bg-gray-100">
            <RefreshIcon size={18} />
          </button>
        </header>

        <section className="flex-1 overflow-y-auto">
          {error && <div className="mx-4 mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6">{error}</div>}
          {search && (
            <p className="px-4 pb-2 text-xs text-gray-500 sm:px-6">
              {total} result{total === 1 ? '' : 's'} for “{search}”
            </p>
          )}
          <EmailList tab={tab} emails={items} loading={loading} searching={Boolean(search)} onOpen={setSelected} onCompose={() => setComposing(true)} />
          {!search && <Pagination page={page} pageSize={20} total={total} onChange={setPage} />}
        </section>
      </main>
    </div>
  );
}
