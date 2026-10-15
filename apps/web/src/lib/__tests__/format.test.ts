import { describe, expect, it } from 'vitest';
import { dateTime, parseMoney, money } from '@/lib/format';

describe('format', () => {
  it('formats ISO and Postgres timestamps in the store time zone', () => {
    expect(dateTime('2026-10-15T03:08:00.000Z', 'America/New_York')).toBe('Oct 14, 2026 · 11:08 PM');
    expect(dateTime('2026-10-15 03:08:00.123+00', 'America/New_York')).toBe('Oct 14, 2026 · 11:08 PM');
  });

  it('parses money input to integer cents', () => {
    expect(parseMoney('12.5')).toBe(1250);
    expect(parseMoney('$1,234.56')).toBe(123456);
    expect(parseMoney('0.1')).toBe(10);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1.234')).toBeNull();
    expect(money(123456)).toBe('$1,234.56');
  });
});
