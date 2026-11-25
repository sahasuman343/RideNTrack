/** F16 paid registration: money formatting and the words riders and captains see. */

export type RegistrationStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';

export interface RegistrationSummary {
  fee_paise: number | null;
  capacity: number | null;
  note: string | null;
  paid_count: number;
  my_status: RegistrationStatus | null;
  /** Captains only. */
  collected_paise?: number | null;
  paid_user_ids?: string[] | null;
}

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** 150000 -> "₹1,500"; 150050 -> "₹1,500.5". */
export function formatInr(paise: number | null | undefined): string {
  if (paise == null || !Number.isFinite(paise)) return '';
  return `₹${inr.format(paise / 100)}`;
}

/** Fee typed by a captain ("1,500", "₹ 1500.50") to rupees, or null when blank / invalid. */
export function parseFeeInr(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value >= 1 && value <= 500000 ? value : null;
}

export function spotsLeft(s: Pick<RegistrationSummary, 'capacity' | 'paid_count'>): number | null {
  return s.capacity == null ? null : Math.max(0, s.capacity - s.paid_count);
}

/** The rider's button and the line under it. */
export function riderRegistrationState(s: RegistrationSummary): { action: string | null; detail: string; tone: 'ok' | 'pending' | 'none' | 'full' } {
  const fee = formatInr(s.fee_paise);
  const left = spotsLeft(s);
  if (s.my_status === 'paid') return { action: null, detail: `Registered. ${fee} paid.`, tone: 'ok' };
  if (s.my_status === 'refunded') return { action: null, detail: `Your ${fee} was refunded.`, tone: 'none' };
  if (left === 0) return { action: null, detail: 'This ride is full.', tone: 'full' };
  const spots = left == null ? '' : ` ${left} spot${left === 1 ? '' : 's'} left.`;
  if (s.my_status === 'pending') return { action: `Finish paying ${fee}`, detail: `Your payment has not come through yet.${spots}`, tone: 'pending' };
  return { action: `Register · ${fee}`, detail: `${s.note ? `${s.note}. ` : ''}Paid securely through Razorpay.${spots}`, tone: 'none' };
}

export function captainRegistrationLine(s: RegistrationSummary): string {
  const of = s.capacity != null ? ` of ${s.capacity}` : '';
  return `${s.paid_count}${of} paid · ${formatInr(s.collected_paise ?? 0)} collected`;
}
