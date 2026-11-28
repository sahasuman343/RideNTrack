/**
 * Sign in and sign up: plain words for what went wrong, and what to do next.
 * Supabase returns English sentences that change between versions, so match
 * on the error code first and the message only as a fallback.
 */

import { phoneAuthProblem } from './phoneAuth';

export type AuthField = 'email' | 'password' | 'username' | 'displayName' | 'inviteCode' | 'phone' | 'code';

export type AuthNextStep = 'resend_confirmation' | 'go_sign_in' | 'go_register' | 'retry';

export interface AuthProblem {
  title: string;
  message: string;
  /** The field to highlight, when the problem belongs to one. */
  field?: AuthField;
  next?: AuthNextStep;
  /** Drives the dialog's icon and colour. */
  kind: AuthProblemKind;
}

export type AuthProblemKind = 'error' | 'info' | 'offline' | 'wait' | 'setup';

export interface AuthErrorLike {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const USERNAME_RE = /^[a-z0-9_.]{3,30}$/i;
/** Matches Supabase Auth: minimum length 8, letters and digits required. */
export const MIN_PASSWORD = 8;
export const PASSWORD_RULE = `At least ${MIN_PASSWORD} characters, with letters and numbers.`;

/** What is wrong with a new password, or null when it meets the rule. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Use both letters and numbers.';
  return null;
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/** Field errors shown under the inputs before anything is sent. */
export function validateSignIn(input: { email: string; password: string }): Partial<Record<AuthField, string>> {
  const errors: Partial<Record<AuthField, string>> = {};
  if (!input.email.trim()) errors.email = 'Enter your email.';
  else if (!isValidEmail(input.email)) errors.email = 'That email looks incomplete.';
  if (!input.password) errors.password = 'Enter your password.';
  return errors;
}

/** Username and display name: the part of sign-up shared by email and phone. */
export function validateNewRider(input: { username: string; displayName: string }): Partial<Record<AuthField, string>> {
  const errors: Partial<Record<AuthField, string>> = {};
  const username = input.username.trim();
  if (!username) errors.username = 'Pick a username riders will see.';
  else if (!USERNAME_RE.test(username)) errors.username = '3 to 30 letters, numbers, dots or underscores.';
  if (!input.displayName.trim()) errors.displayName = 'Enter the name your pack knows you by.';
  return errors;
}

export function validateSignUp(input: {
  email: string; password: string; username: string; displayName: string;
}): Partial<Record<AuthField, string>> {
  const errors = validateNewRider(input);
  if (!input.email.trim()) errors.email = 'Enter your email.';
  else if (!isValidEmail(input.email)) errors.email = 'That email looks incomplete.';
  if (!input.password) errors.password = 'Choose a password.';
  else {
    const problem = passwordProblem(input.password);
    if (problem) errors.password = problem;
  }
  return errors;
}

export function authProblem(error: AuthErrorLike | null | undefined, mode: 'sign_in' | 'sign_up'): AuthProblem {
  const code = (error?.code ?? '').toLowerCase();
  const msg = (error?.message ?? '').toLowerCase();
  const has = (s: string) => msg.includes(s);

  if (error?.name === 'UsernameUnavailableError' || code === 'username_taken') {
    return { title: 'Username taken', message: 'Someone already rides as that name. Try another one.', field: 'username', kind: 'error' };
  }
  const phone = phoneAuthProblem(error);
  if (phone) return phone;
  if (code === 'invalid_credentials' || has('invalid login credentials')) {
    return {
      title: "That didn't match",
      message: 'The email or password is wrong. Check both and try again.',
      field: 'password',
      next: 'retry',
      kind: 'error',
    };
  }
  if (code === 'email_not_confirmed' || has('email not confirmed')) {
    return {
      title: 'Confirm your email first',
      message: 'We sent you a link when you signed up. Open it, then sign in here. No email? We can send it again.',
      field: 'email',
      next: 'resend_confirmation',
      kind: 'info',
    };
  }
  if (code === 'user_already_exists' || code === 'email_exists' || has('already registered')) {
    return {
      title: 'You already have an account',
      message: 'This email is already signed up. Sign in instead.',
      field: 'email',
      next: 'go_sign_in',
      kind: 'info',
    };
  }
  if (code === 'weak_password' || has('password should')) {
    return { title: 'Choose a stronger password', message: `Use at least ${MIN_PASSWORD} characters, mixing letters and numbers.`, field: 'password', kind: 'error' };
  }
  if (code === 'email_address_invalid' || has('invalid format') || has('unable to validate email')) {
    return { title: 'Check your email', message: 'That email address does not look right.', field: 'email', kind: 'error' };
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || (error?.status === 429) || has('rate limit')) {
    return { title: 'Too many tries', message: 'Please wait a minute, then try again.', next: 'retry', kind: 'wait' };
  }
  if (code === 'signup_disabled' || has('signups not allowed')) {
    return { title: 'Sign-ups are paused', message: 'New accounts are closed for now. Please try again later.', kind: 'wait' };
  }
  if (has('network request failed') || has('failed to fetch') || has('network') || has('timeout')) {
    return { title: 'No connection', message: 'We could not reach RideNTrack. Check your internet and try again.', next: 'retry', kind: 'offline' };
  }
  if (has('invalid api key') || has('no api key')) {
    return { title: 'App setup problem', message: 'This build cannot reach our servers. Please update the app or tell the team.', kind: 'setup' };
  }
  if (has('could not check your username')) {
    return { title: 'No connection', message: 'We could not check your username. Check your internet and try again.', next: 'retry', kind: 'offline' };
  }
  return mode === 'sign_in'
    ? { title: 'Could not sign you in', message: error?.message || 'Something went wrong. Please try again.', next: 'retry', kind: 'error' }
    : { title: 'Could not create your account', message: error?.message || 'Something went wrong. Please try again.', next: 'retry', kind: 'error' };
}
