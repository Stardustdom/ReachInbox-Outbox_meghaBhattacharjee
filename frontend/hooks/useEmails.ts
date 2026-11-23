'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { Email, EmailTab } from '@/lib/types';

const POLL_MS = 5000;

/**
 * Lists emails for a tab (or searches them through Elasticsearch when a query is
 * set) and refreshes silently every few seconds so statuses update live.
 */
export function useEmails(tab: EmailTab, page: number, search: string, reloadKey: number) {
  const [items, setItems] = useState<Email[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (silent: boolean) => {
      const id = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const res = search ? await api.searchEmails(search, tab) : await api.listEmails(tab, page);
        if (id !== requestId.current) return; // a newer request superseded this one
        setItems(res.items);
        setTotal(res.total);
        setError(null);
      } catch (err) {
        if (id === requestId.current) setError(err instanceof Error ? err.message : 'Failed to load emails');
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [tab, page, search],
  );

  useEffect(() => {
    setItems([]);
    void load(false);
    const timer = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [load, reloadKey]);

  return { items, total, loading, error, reload: () => load(false) };
}

/** Totals for the sidebar badges (Scheduled / Sent), refreshed like the list. */
export function useCounts(reloadKey: number) {
  const [counts, setCounts] = useState<{ scheduled?: number; sent?: number }>({});
  useEffect(() => {
    const load = () =>
      Promise.all([api.listEmails('scheduled', 1, 1), api.listEmails('sent', 1, 1)])
        .then(([a, b]) => setCounts({ scheduled: a.total, sent: b.total }))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [reloadKey]);
  return counts;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
