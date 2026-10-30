import { randomInt } from 'crypto';
import { config } from './config';
import type { PrismaService } from './prisma.service';

// No 0/o, 1/l/i: codes get read aloud and typed from a phone.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const REF_PATTERN = /^[a-z2-9]{7}$/;
export const SHARE_CHANNELS = ['sms', 'email', 'facebook', 'copy', 'share'] as const;

/** The first readers to confirm keep a Founding Reader badge. */
export const FOUNDING_READERS = 100;
/** Ketchikan Gateway Borough, 2020 census. */
export const BOROUGH_POPULATION = 13_948;

export interface Badge {
  at: number;
  name: string;
  line: string;
}

/** Earned by neighbors who confirm through your link. Honors only: nothing to buy, nothing to redeem. */
export const BADGES: Badge[] = [
  { at: 1, name: 'Good Neighbor', line: 'Brought one neighbor to the table' },
  { at: 3, name: 'Town Crier', line: 'Three readers who heard it from you' },
  { at: 5, name: 'Harbormaster', line: 'Five neighbors keeping watch' },
  { at: 10, name: 'First City Champion', line: 'Ten readers across the Borough' },
  { at: 25, name: 'Borough Legend', line: 'Twenty-five neighbors informed' },
];

export function badgeFor(count: number): Badge | null {
  return [...BADGES].reverse().find((b) => count >= b.at) ?? null;
}

export function nextBadge(count: number): Badge | null {
  return BADGES.find((b) => count < b.at) ?? null;
}

/** The next round number above today's readers, so the bar always has somewhere to go. */
export function communityGoal(readers: number): number {
  const steps = [100, 250, 500, 1000, 1500, 2000, 3000, 5000, 7500, 10_000];
  return steps.find((s) => readers < s) ?? Math.ceil((readers + 1) / 5000) * 5000;
}

export function newRefCode(): string {
  let s = '';
  for (let i = 0; i < 7; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export function inviteUrl(code: string, path = '/'): string {
  return `${config.publicBaseUrl}${path}${path.includes('?') ? '&' : '?'}r=${code}`;
}

export async function ensureRefCode(prisma: PrismaService, sub: { id: string; refCode: string | null }): Promise<string> {
  if (sub.refCode) return sub.refCode;
  for (let tries = 0; tries < 5; tries++) {
    const code = newRefCode();
    if (await prisma.subscriber.findFirst({ where: { refCode: code }, select: { id: true } })) continue;
    await prisma.subscriber.update({ where: { id: sub.id }, data: { refCode: code } });
    return code;
  }
  throw new Error('Could not pick an unused invite code');
}

/** Neighbors who confirmed through this reader's link. Leaving later doesn't take a badge back. */
export function referralCount(prisma: PrismaService, subscriberId: string): Promise<number> {
  return prisma.subscriber.count({ where: { referredById: subscriberId, confirmedAt: { not: null } } });
}

/** Everyone who has ever confirmed, so a reader number never changes. */
export function readerNumber(prisma: PrismaService, confirmedAt: Date): Promise<number> {
  return prisma.subscriber.count({ where: { confirmedAt: { lte: confirmedAt } } });
}

export function confirmedReaders(prisma: PrismaService): Promise<number> {
  return prisma.subscriber.count({ where: { status: 'CONFIRMED' } });
}
