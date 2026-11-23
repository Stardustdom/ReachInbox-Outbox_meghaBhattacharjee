export type EmailStatus = 'scheduled' | 'delayed' | 'sending' | 'sent' | 'failed';
export type EmailTab = 'scheduled' | 'sent';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface SlackStatus {
  available: boolean;
  connected: boolean;
  teamName: string | null;
  channel: string | null;
}

export interface MeResponse {
  user: User;
  slack: SlackStatus;
}

export interface Email {
  id: string;
  campaignId: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  senderEmail: string;
  scheduledAt: string;
  sentAt: string | null;
  attempts: number;
  error: string | null;
  previewUrl: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ScheduleRequest {
  subject: string;
  body: string;
  recipients: string[];
  startAt: string;
  delaySeconds: number;
  hourlyLimit: number;
}

export interface ScheduleResponse {
  campaignId: string;
  total: number;
  firstAt?: string;
  lastAt?: string;
  duplicate: boolean;
}
