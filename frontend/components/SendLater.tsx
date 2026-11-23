'use client';
import { useEffect, useRef, useState } from 'react';
import { toLocalInputValue } from '@/lib/format';
import { Button } from './ui/Button';
import { ClockIcon } from './ui/icons';

/** Local datetime string for tomorrow at the given hour. */
function tomorrowAt(hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return toLocalInputValue(d);
}

const label = (value: string) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));

const OPTIONS = [
  { text: 'Tomorrow', hour: 9 },
  { text: 'Tomorrow, 10:00 AM', hour: 10 },
  { text: 'Tomorrow, 11:00 AM', hour: 11 },
  { text: 'Tomorrow, 3:00 PM', hour: 15 },
];

/** Clock button + "Send Later" popover. `value` is '' for "send now". */
export function SendLater({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setOpen((o) => !o);
        }}
        aria-label="Send later"
        title={value ? `Scheduled for ${label(value)}` : 'Send later'}
        className={`rounded-full p-2 hover:bg-gray-100 ${value ? 'text-brand-600' : 'text-gray-600'}`}
      >
        <ClockIcon size={20} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
          <p className="text-sm font-semibold">Send Later</p>
          <input
            type="datetime-local"
            value={draft}
            min={toLocalInputValue(new Date())}
            onChange={(e) => setDraft(e.target.value)}
            className="mt-3 h-9 w-full rounded-md border border-gray-200 px-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <ul className="mt-3 space-y-0.5 text-sm">
            {OPTIONS.map((o) => (
              <li key={o.text}>
                <button type="button" onClick={() => setDraft(tomorrowAt(o.hour))} className="w-full rounded px-1 py-1.5 text-left text-gray-700 hover:bg-gray-50">
                  {o.text}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              {value ? 'Clear' : 'Cancel'}
            </button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!draft}
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
