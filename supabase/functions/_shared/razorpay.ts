/*
 * F16 paid registration through Razorpay payment links. Registration fees pay
 * for real-world services (stay, fuel, support vehicle), so Razorpay is allowed
 * here; the club plan itself is digital and goes through the stores.
 * Pure helpers, shared by the Edge Functions and the Node tests.
 */

export interface PaymentLinkRequest {
  amount: number;
  currency: 'INR';
  accept_partial: false;
  reference_id: string;
  description: string;
  expire_by: number;
  reminder_enable: boolean;
  notify: { sms: boolean; email: boolean };
  notes: Record<string, string>;
  callback_url?: string;
  callback_method?: 'get';
}

/** Payment link body for one registration. Links expire after 2 days or at the ride start, whichever is first. */
export function paymentLinkRequest(input: {
  registrationId: string;
  rideId: string;
  rideName: string;
  amountPaise: number;
  rideStartIso?: string | null;
  callbackUrl?: string | null;
  nowMs?: number;
}): PaymentLinkRequest {
  const now = input.nowMs ?? Date.now();
  const twoDays = now + 2 * 86400_000;
  const start = input.rideStartIso ? Date.parse(input.rideStartIso) : NaN;
  const expireMs = Number.isFinite(start) && start > now + 20 * 60_000 ? Math.min(twoDays, start) : twoDays;
  const body: PaymentLinkRequest = {
    amount: input.amountPaise,
    currency: 'INR',
    accept_partial: false,
    reference_id: input.registrationId,
    description: `Registration: ${input.rideName}`.slice(0, 2048),
    expire_by: Math.floor(expireMs / 1000),
    reminder_enable: false,
    notify: { sms: false, email: false },
    notes: { registration_id: input.registrationId, ride_id: input.rideId },
  };
  if (input.callbackUrl) {
    body.callback_url = input.callbackUrl;
    body.callback_method = 'get';
  }
  return body;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** X-Razorpay-Signature is the hex HMAC-SHA256 of the raw body with the webhook secret. */
export async function verifyRazorpaySignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  return timingSafeEqual(toHex(mac), signature.trim().toLowerCase());
}

export interface RazorpayWebhook {
  event: string;
  payload?: {
    payment_link?: { entity?: { id?: string; reference_id?: string; status?: string; amount_paid?: number; notes?: Record<string, string> } };
    payment?: { entity?: { id?: string; amount?: number; status?: string; notes?: Record<string, string> } };
    refund?: { entity?: { id?: string; payment_id?: string; amount?: number; notes?: Record<string, string> } };
  };
}

export type RegistrationAction =
  | { kind: 'apply'; registrationId: string; status: 'paid' | 'cancelled' | 'refunded' | 'failed'; paymentId: string | null; amountPaise: number | null }
  | { kind: 'ignore'; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a webhook means for a registration. The registration id travels as the link's reference id and in notes. */
export function registrationActionFor(hook: RazorpayWebhook): RegistrationAction {
  const link = hook.payload?.payment_link?.entity;
  const payment = hook.payload?.payment?.entity;
  const refund = hook.payload?.refund?.entity;
  const regId = link?.reference_id ?? link?.notes?.registration_id ?? payment?.notes?.registration_id ?? refund?.notes?.registration_id ?? '';
  if (!UUID.test(regId)) return { kind: 'ignore', reason: 'no_registration' };
  switch (hook.event) {
    case 'payment_link.paid':
      return { kind: 'apply', registrationId: regId, status: 'paid', paymentId: payment?.id ?? null, amountPaise: link?.amount_paid ?? payment?.amount ?? null };
    case 'payment_link.cancelled':
    case 'payment_link.expired':
      return { kind: 'apply', registrationId: regId, status: 'cancelled', paymentId: null, amountPaise: null };
    case 'payment.failed':
      return { kind: 'apply', registrationId: regId, status: 'failed', paymentId: payment?.id ?? null, amountPaise: null };
    case 'refund.processed':
      return { kind: 'apply', registrationId: regId, status: 'refunded', paymentId: refund?.payment_id ?? null, amountPaise: null };
    default:
      return { kind: 'ignore', reason: `event_${hook.event}` };
  }
}

/** Razorpay sends this header once per event; retries reuse it. */
export function webhookEventId(headers: { get(name: string): string | null }, hook: RazorpayWebhook): string {
  return headers.get('x-razorpay-event-id') || `${hook.event}:${hook.payload?.payment?.entity?.id ?? hook.payload?.refund?.entity?.id ?? hook.payload?.payment_link?.entity?.id ?? ''}`;
}
