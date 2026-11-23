const locale = undefined; // use the browser's locale

/** "Tue 9:15:12 AM" — the scheduled-time badge in the list. */
export function formatBadgeTime(iso: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(iso));
}

/** "Nov 3, 10:23 AM" — the date in the email detail view. */
export function formatLongDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** Value for <input type="datetime-local"> in the user's local timezone. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');
