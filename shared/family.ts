/*
 * F2 Family auto-updates: phone normalising for the contact form and the
 * plain sentences the rider sees about what their family was sent.
 * Mirrors supabase/functions/_shared/outbound.ts normalisePhone (Deno cannot
 * import from shared/ when deployed).
 */

export const MAX_FAMILY_CONTACTS = 2;

export interface FamilyContact {
  id: string;
  name: string;
  phone: string;
  relation: string | null;
  paused: boolean;
  /** F13: the language their texts are in. */
  language?: 'en' | 'hi';
}

export function normaliseFamilyPhone(raw: string | null | undefined, defaultCountry = '91'): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0' ? '+' + digits : null;
  if (digits.startsWith('00')) return normaliseFamilyPhone('+' + digits.slice(2));
  if (defaultCountry === '91') {
    if (digits.length === 10 && /^[6-9]/.test(digits)) return '+91' + digits;
    if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) return '+91' + digits.slice(1);
    if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) return '+' + digits;
  }
  return null;
}

/** "+91 98765 43210" for display. */
export function formatPhoneForDisplay(e164: string): string {
  if (/^\+91[6-9]\d{9}$/.test(e164)) return `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`;
  return e164;
}

export const FAMILY_TEMPLATE_LABELS: Record<string, string> = {
  family_ride_started: 'Ride started',
  family_reached_stay: 'Reached the stay',
  family_check_in_missed: 'Missed check-in',
};

export interface OutboundStatusRow {
  template: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | string;
  recipient_label: string | null;
  created_at: string;
}

/**
 * One line for the ride screen, e.g. "Family told: Ride started · Sent by SMS to Amma, Appa".
 * Uses the shared status words: Sent by SMS, Waiting for signal, Failed.
 */
export function familyUpdateSummary(rows: OutboundStatusRow[], contacts: FamilyContact[]): { headline: string; detail: string; tone: 'ok' | 'pending' | 'failed' | 'none' } {
  if (!contacts.length) return { headline: 'No family contacts', detail: 'Add up to two people who get a text when you start and reach the stay.', tone: 'none' };
  if (contacts.every(c => c.paused)) return { headline: 'Family updates paused', detail: 'Nobody is texted until you resume.', tone: 'none' };
  const family = rows.filter(r => r.template in FAMILY_TEMPLATE_LABELS).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (!family.length) {
    const names = contacts.filter(c => !c.paused).map(c => c.name).join(' and ');
    return { headline: 'Family updates on', detail: `${names} will get a text when the ride starts.`, tone: 'ok' };
  }
  const latest = family[0];
  const batch = family.filter(r => r.template === latest.template && Math.abs(Date.parse(r.created_at) - Date.parse(latest.created_at)) < 120_000);
  const names = batch.map(r => r.recipient_label).filter(Boolean).join(', ');
  const failed = batch.some(r => r.status === 'failed');
  const pending = batch.some(r => r.status === 'queued' || r.status === 'sending');
  const label = FAMILY_TEMPLATE_LABELS[latest.template];
  if (failed) return { headline: `${label}: not delivered`, detail: `Could not text ${names || 'your family'}. Share the family link instead.`, tone: 'failed' };
  if (pending) return { headline: `${label}: sending`, detail: `Text to ${names || 'your family'} is queued on the server.`, tone: 'pending' };
  return { headline: `${label}: Sent by SMS`, detail: `Texted ${names || 'your family'} with your live link.`, tone: 'ok' };
}
