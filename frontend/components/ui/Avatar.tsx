import { cn } from '@/lib/format';

export function Avatar({ src, name, size = 36 }: { src: string | null; name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name} width={size} height={size} referrerPolicy="no-referrer" className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className={cn('inline-flex items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700')}
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
}
