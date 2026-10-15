import { DateTime } from 'luxon';
import { toDateTime } from '@/lib/format';

export type BookingStatus = 'booked' | 'completed' | 'cancelled' | 'no_show';

export interface Booking {
  id: string;
  reference: string;
  storeId: string;
  staffId: string;
  staffName: string;
  staffColor: string;
  variantId: string;
  serviceName: string;
  durationMin: number;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  source: 'online' | 'staff';
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  note: string;
  quotedPriceCents: number;
  saleId: string | null;
  createdAt: string;
}

export interface HoursRange {
  weekday: number;
  startMin: number;
  endMin: number;
}

export interface TeamSchedule {
  id: string;
  name: string;
  color: string;
  role: string;
  hours: HoursRange[];
  productIds: string[];
}

export interface Availability {
  date: string;
  timezone: string;
  durationMin: number;
  staff: { id: string; name: string; color: string; slots: string[] }[];
}

export const statusLabel: Record<BookingStatus, string> = {
  booked: 'Booked',
  completed: 'Paid',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

/** 540 -> "9:00 AM" */
export const minutesLabel = (m: number) => DateTime.fromObject({ hour: Math.floor(m / 60) % 24, minute: m % 60 }).toFormat(m % 60 ? 'h:mm a' : 'h a');

/** "9 AM – 5 PM" (several ranges joined with commas) */
export const hoursLabel = (ranges: HoursRange[]) => ranges.map((r) => `${minutesLabel(r.startMin)} – ${minutesLabel(r.endMin)}`).join(', ');

export const slotLabel = (iso: string, zone: string) => toDateTime(iso, zone).toFormat('h:mm a');

/** Union of every person's free starts, sorted; used for "anyone available". */
export const mergedSlots = (a: Availability) => [...new Set(a.staff.flatMap((s) => s.slots))].sort();
