import type {
  Email,
  EmailTab,
  MeResponse,
  Paginated,
  ScheduleRequest,
  ScheduleResponse,
} from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => request<MeResponse>('/auth/me'),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  listEmails: (type: EmailTab, page = 1, pageSize = 20) =>
    request<Paginated<Email>>(`/emails?type=${type}&page=${page}&pageSize=${pageSize}`),
  searchEmails: (q: string, type: EmailTab) =>
    request<Paginated<Email>>(`/emails/search?q=${encodeURIComponent(q)}&type=${type}`),
  schedule: (body: ScheduleRequest, idempotencyKey: string) =>
    request<ScheduleResponse>('/emails/schedule', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  slackDisconnect: () => request<{ ok: boolean }>('/slack', { method: 'DELETE' }),
  slackConnectUrl: '/api/slack/connect',
  googleLoginUrl: '/api/auth/google',
};
