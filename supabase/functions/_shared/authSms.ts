/*
 * Sign-in codes by SMS, sent by the Supabase Auth "Send SMS" hook.
 *
 * Pure TypeScript (no Deno or Node APIs) so the Node unit tests cover it.
 * These texts never go through outbound_messages: they have their own caps
 * (public.claim_auth_sms) and never use the budget kept for SOS texts.
 */
import { normalisePhone, type ProviderEnv, type SendRequest, type TemplateSpec } from './outbound.ts';

/** Register this exact text as a DLT "Service Implicit" (OTP) template. */
export const AUTH_OTP_TEMPLATE: TemplateSpec = {
  vars: ['otp'],
  text: '{#otp#} is your RideNTrack sign-in code. Do not share it with anyone. - RideNTrack',
  dltEnv: 'DLT_TEMPLATE_AUTH_OTP',
  maxVarLength: 10,
};

export interface SendSmsHookPayload {
  user?: { id?: string; phone?: string | null; phone_change?: string | null } | null;
  sms?: { otp?: string | null; sms_type?: string | null } | null;
}

/** The number the code goes to: the new number while confirming a phone change. */
export function hookRecipient(payload: SendSmsHookPayload): string | null {
  const user = payload.user ?? {};
  const raw = payload.sms?.sms_type === 'phone_change' && user.phone_change ? user.phone_change : user.phone || user.phone_change;
  if (!raw) return null;
  // Supabase stores numbers without the plus.
  return normalisePhone(String(raw).startsWith('+') ? String(raw) : '+' + String(raw));
}

export function hookOtp(payload: SendSmsHookPayload): string | null {
  const otp = String(payload.sms?.otp ?? '').trim();
  return /^\d{4,10}$/.test(otp) ? otp : null;
}

export function buildAuthOtpRequest(to: string, otp: string, env: ProviderEnv): SendRequest {
  return {
    to,
    template: 'auth_otp',
    vars: [otp],
    text: AUTH_OTP_TEMPLATE.text.replace('{#otp#}', otp),
    dltTemplateId: env[AUTH_OTP_TEMPLATE.dltEnv] || null,
  };
}

/**
 * What the rider reads when a code is refused. Supabase shows the hook's
 * message to the app, which matches on these words (shared/phoneAuth.ts).
 */
export function capReasonResponse(reason: string): { http_code: number; message: string } {
  switch (reason) {
    case 'phone_hourly_cap':
    case 'phone_daily_cap':
      return { http_code: 429, message: 'This number has had too many sign-in codes today. Wait a while, or sign in with your email.' };
    case 'global_daily_cap':
      return { http_code: 429, message: 'Sign-in codes are paused for today. Sign in with your email.' };
    case 'country_not_allowed':
      return { http_code: 400, message: 'Invalid phone number: sign-in codes go to Indian (+91) mobile numbers only.' };
    case 'invalid_phone':
      return { http_code: 400, message: 'Invalid phone number.' };
    case 'disabled':
      return { http_code: 503, message: 'SMS sign-in is not set up yet. Sign in with your email.' };
    default:
      return { http_code: 502, message: 'Error sending the SMS code. Try again, or sign in with your email.' };
  }
}
