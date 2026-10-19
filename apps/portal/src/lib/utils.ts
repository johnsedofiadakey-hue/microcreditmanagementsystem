import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Short, readable form of a UUID for tables: "3f2504e0…". */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

const dateTime = new Intl.DateTimeFormat('en-GH', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTime.format(date);
}

/** Today's date in Accra (GMT, no DST) as yyyy-mm-dd — the key used by dashboard read models. */
export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Mask a Ghana Card number for any screen that is not the authorised member profile. */
export function maskGhanaCard(value: string): string {
  const match = /^GHA-\d{9}-(\d)$/.exec(value);
  return match ? `GHA-•••••••••-${match[1]}` : '•••';
}
