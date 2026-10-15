import { DateTime } from 'luxon';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (cents: number | null | undefined) => usd.format((cents ?? 0) / 100);

/** "12.50" -> 1250. Returns null for empty or invalid input. */
export function parseMoney(input: string | number): number | null {
  const s = String(input).replace(/[$,\s]/g, '');
  if (s === '' || !/^-?\d*(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** Accepts ISO strings and Postgres text timestamps ("2026-10-15 03:08:00.12+00"). */
export function toDateTime(value: string, zone?: string): DateTime {
  const iso = DateTime.fromISO(value, { setZone: true });
  const dt = iso.isValid ? iso : DateTime.fromSQL(value, { setZone: true });
  return zone ? dt.setZone(zone) : dt.toLocal();
}

export const dateTime = (v: string, zone?: string) => toDateTime(v, zone).toFormat('LLL d, yyyy · h:mm a');
export const time = (v: string, zone?: string) => toDateTime(v, zone).toFormat('h:mm a');
export const shortDate = (v: string, zone?: string) => toDateTime(v, zone).toFormat('ccc, LLL d');
