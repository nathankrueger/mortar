import type { Seat } from '@mortar/shared';

const KEY = 'mortar.rejoin';
const MAX_AGE_MS = 35 * 60 * 1000; // matches server room TTL

export interface RejoinInfo {
  code: string;
  token: string;
  seat: Seat;
  nickname: string;
  ts: number;
}

export function saveRejoin(info: Omit<RejoinInfo, 'ts'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...info, ts: Date.now() }));
  } catch {
    /* private mode etc. — rejoin just won't survive reloads */
  }
}

export function loadRejoin(): RejoinInfo | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const info = JSON.parse(raw) as RejoinInfo;
    if (Date.now() - info.ts > MAX_AGE_MS) {
      clearRejoin();
      return null;
    }
    return info;
  } catch {
    return null;
  }
}

export function clearRejoin(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

const NICK_KEY = 'mortar.nickname';
export function savedNickname(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? '';
  } catch {
    return '';
  }
}
export function saveNickname(n: string): void {
  try {
    localStorage.setItem(NICK_KEY, n);
  } catch {
    /* ignore */
  }
}
