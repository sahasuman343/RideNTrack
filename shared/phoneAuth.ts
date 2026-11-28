/*
 * Phone number sign-in: riders can sign in (or sign up) with a one-time code
 * sent by SMS, as well as with email and password.
 *
 * Supabase Auth sends the code through the Send SMS hook
 * (supabase/functions/auth-send-sms), which has its own caps so sign-in codes
 * never use the server SMS budget kept for SOS and family texts.
 */
import { normaliseFamilyPhone } from './family';
import { normaliseReferralCode, type ReferralSource } from './referrals';
import { UsernameUnavailableError } from './registration';
import type { AuthProblem } from './authErrors';

export const OTP_LENGTH = 6;
/** Supabase allows one code per number every 60 seconds. */
export const OTP_RESEND_SECONDS = 60;

/** E.164 for a rider's own number. Ten-digit Indian mobiles get +91. */
export function normaliseLoginPhone(raw: string | null | undefined): string | null {
  return normaliseFamilyPhone(raw);
}

/** What is wrong with a typed number, or null when it can receive a code. */
export function phoneProblem(raw: string): string | null {
  if (!raw.trim()) return 'Enter your mobile number.';
  return normaliseLoginPhone(raw) ? null : 'Enter a 10-digit Indian mobile number, or +country code and number.';
}

/** Keeps only digits, so a pasted "123 456" or SMS text still fills the box. */
export function cleanOtp(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, OTP_LENGTH);
}

export function otpProblem(code: string): string | null {
  const clean = cleanOtp(code);
  if (!clean) return 'Enter the code we texted you.';
  return clean.length === OTP_LENGTH ? null : `The code has ${OTP_LENGTH} digits.`;
}

/** "+91 98765 43210", or the number as given for other countries. */
export function formatLoginPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const withPlus = e164.startsWith('+') ? e164 : '+' + e164;
  if (/^\+91[6-9]\d{9}$/.test(withPlus)) return `+91 ${withPlus.slice(3, 8)} ${withPlus.slice(8)}`;
  return withPlus;
}

/** Supabase stores auth phones without the plus; compare in one form. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (v: string | null | undefined) => (v ?? '').replace(/[^0-9]/g, '');
  return Boolean(n(a)) && n(a) === n(b);
}

type OtpError = { message: string; code?: string; status?: number } | null;
interface PhoneAuthClient<T> {
  rpc(name: string, args: { requested_username: string }): PromiseLike<{ data: unknown; error: unknown }>;
  auth: {
    signInWithOtp(payload: { phone: string; options?: { shouldCreateUser?: boolean; data?: Record<string, string> } }): Promise<{ error: OtpError }>;
    verifyOtp(payload: { phone: string; token: string; type: 'sms' | 'phone_change' }): Promise<{ data: T; error: OtpError }>;
  };
}

function raise(error: NonNullable<OtpError>): never {
  throw Object.assign(new Error(error.message), { code: error.code, status: error.status });
}

/**
 * Texts a sign-in code to an existing account's number. New numbers are
 * refused here (Supabase answers otp_disabled) so a typo never creates an
 * account; sign-up uses sendSignUpCode instead.
 */
export async function sendSignInCode<T>(client: PhoneAuthClient<T>, raw: string): Promise<string> {
  const phone = normaliseLoginPhone(raw);
  if (!phone) throw Object.assign(new Error(phoneProblem(raw) ?? 'Check your number.'), { code: 'phone_invalid' });
  const { error } = await client.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
  if (error) raise(error);
  return phone;
}

/** Checks the username, then texts a code that creates the account once verified. */
export async function sendSignUpCode<T>(client: PhoneAuthClient<T>, input: {
  phone: string; username: string; displayName: string;
  referralCode?: string | null; referralSource?: ReferralSource | null;
}): Promise<string> {
  const phone = normaliseLoginPhone(input.phone);
  if (!phone) throw Object.assign(new Error(phoneProblem(input.phone) ?? 'Check your number.'), { code: 'phone_invalid' });
  const username = input.username.trim();
  const displayName = input.displayName.trim();
  if (!username || username.length > 64) throw new Error('Choose a username between 1 and 64 characters.');
  if (!displayName) throw new Error('Enter your display name.');
  const { data, error: rpcError } = await client.rpc('is_username_available', { requested_username: username });
  if (rpcError || typeof data !== 'boolean') throw new Error('Could not check your username. Check your connection and try again.');
  if (!data) throw new UsernameUnavailableError();

  const referral = normaliseReferralCode(input.referralCode);
  const meta: Record<string, string> = referral
    ? { username, display_name: displayName, referral_code: referral, referral_source: input.referralSource ?? 'typed' }
    : { username, display_name: displayName };
  // An existing number simply signs in: the metadata only applies to new accounts.
  const { error } = await client.auth.signInWithOtp({ phone, options: { shouldCreateUser: true, data: meta } });
  if (error) raise(error);
  return phone;
}

/** Checks the code. 'sms' signs in; 'phone_change' confirms a number added in Profile. */
export async function verifyPhoneCode<T>(client: PhoneAuthClient<T>, phone: string, code: string, type: 'sms' | 'phone_change' = 'sms'): Promise<T> {
  const token = cleanOtp(code);
  const problem = otpProblem(token);
  if (problem) throw Object.assign(new Error(problem), { code: 'otp_incomplete' });
  const { data, error } = await client.auth.verifyOtp({ phone, token, type });
  if (error) raise(error);
  return data;
}

/**
 * Plain words for what went wrong with a code, or null when the error is not
 * phone-specific (authProblem handles those).
 */
export function phoneAuthProblem(error: { message?: string; code?: string; status?: number } | null | undefined): AuthProblem | null {
  const code = (error?.code ?? '').toLowerCase();
  const msg = (error?.message ?? '').toLowerCase();
  const has = (s: string) => msg.includes(s);
  if (code === 'phone_invalid' || (code === 'validation_failed' && has('phone')) || has('invalid phone')) {
    return { title: 'Check your number', message: error?.message && (code === 'phone_invalid' || has('(+91)')) ? error.message.replace(/^invalid phone number:\s*/i, '').replace(/^./, c => c.toUpperCase()) : 'That mobile number does not look right.', field: 'phone', kind: 'error' };
  }
  if (code === 'otp_incomplete') return { title: 'Check the code', message: error?.message ?? 'Enter the code we texted you.', field: 'code', kind: 'error' };
  if (code === 'otp_disabled' || has('signups not allowed for otp')) {
    return {
      title: 'No account with this number',
      message: 'Sign in with your email, then add this number in Profile. New here? Create an account with your phone.',
      field: 'phone',
      next: 'go_register',
      kind: 'info',
    };
  }
  if (code === 'otp_expired' || has('token has expired') || has('token is invalid') || has('otp has expired')) {
    return { title: 'That code did not work', message: 'It is wrong or has expired. Check the SMS, or send a new code.', field: 'code', next: 'retry', kind: 'error' };
  }
  if (code === 'phone_exists' || has('phone number already') || (has('already registered') && has('phone'))) {
    return { title: 'Number already in use', message: 'Another account signs in with this number. Sign in with it instead, or use a different number.', field: 'phone', kind: 'info' };
  }
  if (code === 'over_sms_send_rate_limit' || has('sign-in codes today')) {
    return { title: 'Too many codes', message: 'We have sent this number several codes already. Wait a while, or sign in with your email.', next: 'retry', kind: 'wait' };
  }
  if (code === 'phone_provider_disabled' || code === 'sms_send_failed' || has('sms sign-in is not set up') || has('sign-in codes are paused') || (has('error sending') && has('sms'))) {
    return { title: 'Could not send the code', message: 'Texting codes is not working right now. Sign in with your email, or try again later.', kind: 'setup' };
  }
  return null;
}
