'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import AuthFrame from '@/components/auth-frame';

/**
 * Sends a password reset link. The answer is the same whether or not the
 * address has an account, so this page can't be used to find out who signed up.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (state === 'sending') return;
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setError('Enter the email address you signed up with.'); setState('error'); return; }
    setState('sending'); setError('');
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: `${window.location.origin}/reset-password` });
    // Rate limits and network failures are worth showing; "no such user" is not reported by Supabase.
    if (sendError && (sendError.status === 429 || /rate|network|fetch/i.test(sendError.message))) {
      setError(sendError.status === 429 ? 'Too many requests. Wait a minute and try again.' : 'Could not reach the server. Check your connection and try again.');
      setState('error');
      return;
    }
    setState('sent');
  }

  return (
    <AuthFrame eyebrow="Account help" title={<>Reset your <em>password</em></>}>
      {state === 'sent' ? (
        <div className="space-y-4">
          <p role="status" className="notice">If <strong>{email.trim()}</strong> has a rideNtrack account, a reset link is on its way. It works once and expires after an hour.</p>
          <p className="text-sm text-muted">Nothing after a few minutes? Check spam, or <button type="button" className="text-accent underline underline-offset-4" onClick={() => setState('idle')}>try again</button>.</p>
        </div>
      ) : (
        <form onSubmit={send} className="space-y-4" noValidate>
          <p className="text-sm text-muted">Enter the email you use for rideNtrack, in the app or on the web. We’ll send a link to choose a new password.</p>
          {state === 'error' && <div role="alert" className="notice notice-error">{error}</div>}
          <div>
            <label htmlFor="reset-email" className="field-label">Email</label>
            <input id="reset-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="field" required />
          </div>
          <button type="submit" disabled={state === 'sending'} className="btn btn-primary w-full py-3">{state === 'sending' ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
      <p className="mt-6 text-sm text-muted">Remembered it? <Link href="/login" className="text-accent underline-offset-4 hover:underline">Sign in</Link></p>
    </AuthFrame>
  );
}
