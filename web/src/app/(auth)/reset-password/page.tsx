'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MIN_PASSWORD } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';
import AuthFrame from '@/components/auth-frame';

/**
 * Landing page for the emailed reset link. Supabase turns the link into a
 * short recovery session; with it the rider can set a new password once.
 */
export default function ResetPasswordPage() {
  const [ready, setReady] = useState<'checking' | 'ok' | 'expired' | 'saved'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let settled = false;
    const done = (ok: boolean) => { if (!settled) { settled = true; setReady(ok ? 'ok' : 'expired'); } };
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (session && event === 'SIGNED_IN')) done(true);
    });
    // The link may carry ?code= (PKCE) or a #access_token fragment; also accept a session that is already set.
    const code = new URLSearchParams(window.location.search).get('code');
    const exchange = code ? supabase.auth.exchangeCodeForSession(code).then(({ error: e }) => { if (!e) done(true); }) : Promise.resolve();
    void exchange.then(() => supabase.auth.getSession()).then(({ data }) => { if (data.session) done(true); });
    const timer = setTimeout(() => done(false), 6000);
    return () => { sub.subscription.unsubscribe(); clearTimeout(timer); };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length < MIN_PASSWORD) { setError(`Use at least ${MIN_PASSWORD} characters.`); return; }
    if (password !== confirm) { setError('The two passwords don’t match.'); return; }
    setBusy(true); setError('');
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.code === 'same_password' || /same|different from the old/i.test(updateError.message) ? 'Choose a password you haven’t used for this account.' : updateError.message || 'Could not save the password. Try again.');
      return;
    }
    setReady('saved');
  }

  return (
    <AuthFrame eyebrow="Account help" title={<>Choose a new <em>password</em></>}>
      {ready === 'checking' && <div role="status" aria-label="Checking your reset link" className="h-40 animate-pulse rounded bg-surface" />}
      {ready === 'expired' && (
        <div className="space-y-4">
          <p role="alert" className="notice notice-error">This reset link has expired or was already used. Links also only work in the browser you asked for them from.</p>
          <Link href="/forgot-password" className="btn btn-primary w-full py-3">Send a new link</Link>
        </div>
      )}
      {ready === 'saved' && (
        <div className="space-y-4">
          <p role="status" className="notice">Password saved. Use it next time you sign in, in the app or on the web.</p>
          <Link href="/app" className="btn btn-primary w-full py-3">Go to your rides</Link>
        </div>
      )}
      {ready === 'ok' && (
        <form onSubmit={save} className="space-y-4" noValidate>
          {error && <div role="alert" className="notice notice-error">{error}</div>}
          <div>
            <label htmlFor="new-password" className="field-label">New password</label>
            <input id="new-password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} value={password} onChange={e => setPassword(e.target.value)} className="field" required aria-describedby="new-password-hint" />
            <p id="new-password-hint" className="mt-1.5 text-xs text-muted">At least {MIN_PASSWORD} characters. It works in the app and on the web.</p>
          </div>
          <div>
            <label htmlFor="confirm-password" className="field-label">Type it again</label>
            <input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} className="field" required />
          </div>
          <button type="submit" disabled={busy} className="btn btn-primary w-full py-3">{busy ? 'Saving…' : 'Save new password'}</button>
        </form>
      )}
    </AuthFrame>
  );
}
