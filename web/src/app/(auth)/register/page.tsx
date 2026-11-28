'use client';

import { use, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import AuthFrame from '@/components/auth-frame';
import { MIN_PASSWORD, passwordProblem, referralCodeFrom, referralSourceFrom, registerAccount, sendSignUpCode, UsernameUnavailableError, validateNewRider, verifyPhoneCode, type ReferralSource } from '@ridentrack/shared';
import PhoneCodeForm, { HANDLED, PHONE_LOGIN_ENABLED, SignInMethodSwitch, type SignInMethod } from '@/components/phone-code-form';

export default function RegisterPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const query = use(searchParams);
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const linkedCode = referralCodeFrom(first(query.ref));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const usernameInput = useRef<HTMLInputElement>(null);
  const [usernameError, setUsernameError] = useState(false);
  const router = useRouter();
  // F17: a code from "Plan your own ride" or a shared recap link (?ref=…&src=…).
  const [inviteCode, setInviteCode] = useState(linkedCode ?? '');
  const [method, setMethod] = useState<SignInMethod>(PHONE_LOGIN_ENABLED && first(query.method) === 'phone' ? 'phone' : 'email');
  const [inviteSource, setInviteSource] = useState<ReferralSource>(() => (linkedCode ? referralSourceFrom(first(query.src)) : 'typed'));

  async function sendPhoneSignUp(phone: string) {
    setError('');
    setUsernameError(false);
    const fieldErrors = validateNewRider({ username, displayName });
    const firstError = fieldErrors.username ?? fieldErrors.displayName;
    if (firstError) {
      setError(firstError);
      if (fieldErrors.username) { setUsernameError(true); usernameInput.current?.focus(); }
      throw HANDLED;
    }
    try {
      return await sendSignUpCode(supabase, { phone, username, displayName, referralCode: referralCodeFrom(inviteCode), referralSource: inviteSource });
    } catch (cause) {
      if (cause instanceof UsernameUnavailableError) {
        setError(cause.message);
        setUsernameError(true);
        usernameInput.current?.focus();
        throw HANDLED;
      }
      throw cause;
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    // Phone sign-up runs from its own form below.
    if (loading || method === 'phone') return;
    setLoading(true);
    setError('');
    setSuccessMsg('');
    setUsernameError(false);
    const problem = passwordProblem(password);
    if (problem) { setError(problem); setLoading(false); return; }
    try {
      const data = await registerAccount(supabase, {
        email, password, username, displayName,
        referralCode: referralCodeFrom(inviteCode), referralSource: inviteSource,
        // Send the confirmation link back to this site (production or a preview),
        // where the login page finishes sign-in and moves on to the app.
        emailRedirectTo: window.location.origin + '/login',
      });
      if (data.session) {
        router.replace('/app');
      } else {
        setSuccessMsg('Check your email to confirm your account, then sign in.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Registration failed. Please try again.');
      if (cause instanceof UsernameUnavailableError) {
        setUsernameError(true);
        usernameInput.current?.focus();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame eyebrow="Join the pack" title={<>Create your <em>account</em></>}>

        {PHONE_LOGIN_ENABLED && <SignInMethodSwitch value={method} onChange={m => { setMethod(m); setError(''); setSuccessMsg(''); }} />}
        <form onSubmit={handleRegister} className="space-y-4">
          {error && (
            <div id="registration-error" role="alert" className="notice notice-error">
              {error}
            </div>
          )}
          {successMsg && (
            <div role="status" className="notice">
              {successMsg}
            </div>
          )}
          <input
            type="text"
            placeholder="Username"
            aria-label="Username"
            ref={usernameInput}
            aria-invalid={usernameError}
            aria-describedby={usernameError ? 'registration-error' : undefined}
            autoComplete="username"
            autoCapitalize="none"
            maxLength={64}
            value={username}
            onChange={(e) => { setUsername(e.target.value); if (usernameError) { setUsernameError(false); setError(''); } }}
            className="field"
            required
          />
          <input
            type="text"
            placeholder="Display Name"
            aria-label="Display name"
            autoComplete="nickname"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="field"
            required
          />
          {method === 'email' && <>
          <input
            type="email"
            placeholder="Email"
            aria-label="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
            required
          />
          <input
            type="password"
            placeholder={`Password (${MIN_PASSWORD}+ letters and numbers)`}
            aria-label="Password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={MIN_PASSWORD}
            className="field"
            required
          />
          </>}
          <input
            type="text"
            placeholder="Invite code (optional)"
            aria-label="Invite code, optional"
            autoCapitalize="characters"
            maxLength={12}
            value={inviteCode}
            onChange={(e) => { setInviteCode(e.target.value); setInviteSource('typed'); }}
            className="field font-mono tracking-widest uppercase"
          />
          {method === 'email' && (
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary w-full py-3"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
          )}
        </form>
        {method === 'phone' && (
          <div className="mt-4">
            <PhoneCodeForm
              mode="sign_up"
              idPrefix="register-phone"
              sendLabel="Text me a code"
              verifyLabel="Verify and create account"
              onSend={sendPhoneSignUp}
              onVerify={async (phone, code) => { await verifyPhoneCode(supabase, phone, code); router.replace('/app'); }}
              onProblem={p => setError(p.message)}
            />
          </div>
        )}

        <p className="mt-6 text-sm text-muted">
          Already have an account?{' '}
          <Link href="/login" className="text-accent underline-offset-4 hover:underline">Sign in</Link>
        </p>
    </AuthFrame>
  );
}
