import { DateTime } from 'luxon';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (cents: number | null | undefined) => usd.format((cents ?? 0) / 100);

/** "12.50" -> 1250. Returns null for empty or invalid input. */
export function parseMoney(input: string | number): number | null {
  const s = String(input).replace(/[$,\s]/g, '');
  if (s === '' || !/^-?\d*(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export const dateTime = (iso: string, zone?: string) => DateTime.fromISO(iso, { zone }).toFormat('LLL d, yyyy · h:mm a');
export const time = (iso: string, zone?: string) => DateTime.fromISO(iso, { zone }).toFormat('h:mm a');
export const shortDate = (iso: string, zone?: string) => DateTime.fromISO(iso, { zone }).toFormat('ccc, LLL d');
