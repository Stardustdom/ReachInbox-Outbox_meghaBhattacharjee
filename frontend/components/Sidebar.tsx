'use client';
import { useState, type ReactNode } from 'react';
import type { EmailTab, SlackStatus, User } from '@/lib/types';
import { cn } from '@/lib/format';
import { Avatar } from './ui/Avatar';
import { Button } from './ui/Button';
import { ChevronDownIcon, ClockIcon, CloseIcon, SendIcon } from './ui/icons';
import { SlackCard } from './SlackCard';

interface SidebarProps {
  user: User;
  slack: SlackStatus | null;
  tab: EmailTab;
  counts: { scheduled?: number; sent?: number };
  onTabChange: (tab: EmailTab) => void;
  onCompose: () => void;
  onLogout: () => void;
  onSlackChange: () => void;
  /** Mobile drawer state (sidebar is always visible from `lg` up). */
  open?: boolean;
  onClose?: () => void;
}

const BULL_BOARD_URL = process.env.NEXT_PUBLIC_BULL_BOARD_URL || 'http://localhost:4000/admin/queues';

export function Sidebar({ user, slack, tab, counts, onTabChange, onCompose, onLogout, onSlackChange, open = false, onClose }: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const nav: { id: EmailTab; label: string; icon: ReactNode; count?: number }[] = [
    { id: 'scheduled', label: 'Scheduled', icon: <ClockIcon size={16} />, count: counts.scheduled },
    { id: 'sent', label: 'Sent', icon: <SendIcon size={16} />, count: counts.sent },
  ];

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        className={cn(
          'flex w-64 max-w-[85vw] shrink-0 flex-col overflow-y-auto bg-white px-4 py-5 lg:w-60',
          'fixed inset-y-0 left-0 z-40 transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-5 flex items-center justify-between">
          <span className="font-mono text-3xl font-black tracking-widest">ONB</span>
          <button onClick={onClose} aria-label="Close menu" className="rounded-full p-1 text-gray-400 hover:bg-gray-100 lg:hidden">
            <CloseIcon size={18} />
          </button>
        </div>

        {/* user card with logout menu */}
        <div className="relative mb-3">
          <button onClick={() => setMenuOpen((o) => !o)} className="flex w-full items-center gap-2.5 rounded-lg bg-surface p-2 text-left" aria-haspopup="menu" aria-expanded={menuOpen}>
            <Avatar src={user.avatarUrl} name={user.name} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block truncate text-[11px] text-gray-500">{user.email}</span>
            </span>
            <ChevronDownIcon size={16} className="shrink-0 text-gray-400" />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute inset-x-0 top-full z-10 mt-1 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
              <button role="menuitem" onClick={onLogout} className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">
                Logout
              </button>
            </div>
          )}
        </div>

        <Button
          variant="outline"
          onClick={() => {
            onCompose();
            onClose?.();
          }}
          className="mb-5 w-full"
        >
          Compose
        </Button>

        <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Core</p>
        <nav className="flex flex-col gap-0.5">
          {nav.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onTabChange(item.id);
                onClose?.();
              }}
              className={cn(
                'flex items-center justify-between rounded-md px-2.5 py-2 text-sm transition-colors',
                tab === item.id ? 'bg-brand-50 font-semibold text-gray-900' : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              <span className="flex items-center gap-2.5">
                {item.icon}
                {item.label}
              </span>
              {item.count !== undefined && <span className="text-xs font-normal text-gray-500">{item.count}</span>}
            </button>
          ))}
        </nav>

        <div className="mt-auto space-y-3 pt-6">
          <SlackCard slack={slack} onChange={onSlackChange} />
          <a href={BULL_BOARD_URL} target="_blank" rel="noreferrer" className="block rounded-lg px-2.5 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50">
            ↗ Live queue dashboard
          </a>
        </div>
      </aside>
    </>
  );
}
