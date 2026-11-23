'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Spinner } from '@/components/ui/Spinner';

const ERRORS: Record<string, string> = {
  invalid_state: 'Login session expired, please try again.',
  token_exchange_failed: 'Google sign-in failed, please try again.',
  google_not_configured: 'Google OAuth is not configured on the server (see README).',
  access_denied: 'You cancelled the Google sign-in.',
};

const field = 'h-12 w-full rounded-lg bg-surface px-4 text-sm placeholder:text-gray-500 disabled:cursor-not-allowed';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error');
    if (code) setError(ERRORS[code] ?? `Sign-in failed (${code})`);
    // Already logged in? go straight to the dashboard.
    api.me().then(() => window.location.replace('/dashboard')).catch(() => undefined);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4 py-10">
      <div className="w-full max-w-[410px] rounded-xl border border-gray-200 px-6 py-10 sm:px-11">
        <h1 className="text-center text-3xl font-bold">Login</h1>

        <button
          onClick={() => {
            setRedirecting(true);
            window.location.href = api.googleLoginUrl;
          }}
          disabled={redirecting}
          className="mt-7 flex h-12 w-full items-center justify-center gap-2.5 rounded-lg bg-brand-50 text-sm font-medium text-gray-900 hover:bg-brand-100 disabled:opacity-70"
        >
          {redirecting ? <Spinner size="sm" className="text-brand-600" /> : <GoogleIcon />}
          Login with Google
        </button>

        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}

        <div className="my-5 flex items-center gap-3 text-xs text-gray-400">
          <span className="h-px flex-1 bg-gray-200" />
          or sign up through email
          <span className="h-px flex-1 bg-gray-200" />
        </div>

        {/* Shown as in the design; the assignment only requires Google sign-in. */}
        <div className="space-y-3" title="Email login isn't available — please use Google">
          <input type="email" disabled placeholder="Email ID" aria-label="Email ID" className={field} />
          <input type="password" disabled placeholder="Password" aria-label="Password" className={field} />
        </div>
        <button disabled className="mt-6 h-12 w-full cursor-not-allowed rounded-lg bg-brand-500 text-sm font-medium text-white opacity-60">
          Login
        </button>
        <p className="mt-3 text-center text-xs text-gray-400">Email login isn&apos;t available yet. Please use Google.</p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
