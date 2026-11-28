'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { safeNextPath } from '@/lib/next-path';
import AuthFrame from '@/components/auth-frame';
import PhoneCodeForm, { PHONE_LOGIN_ENABLED, SignInMethodSwitch, type SignInMethod } from '@/components/phone-code-form';
import { sendSignInCode, verifyPhoneCode } from '@ridentrack/shared';

export default function LoginPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const query = use(searchParams);
  const next = safeNextPath(Array.isArray(query.next) ? query.next[0] : query.next);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [method, setMethod] = useState<SignInMethod>('email');
  const [needsAccount, setNeedsAccount] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // A cookie can outlive its session. Only leave this page for a session that
    // really works, and clear a dead one so the app gate stops sending us back.
    supabase.auth.getUser().then(({ data, error: userError }) => {
      if (data.user) router.replace(next);
      else if (userError) void supabase.auth.signOut({ scope: 'local' });
    });
  }, [router, next]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message === 'Invalid login credentials' ? 'That email and password do not match an account.' : signInError.message);
      setLoading(false);
    } else {
      router.replace(next);
    }
  }

  return (
    <AuthFrame eyebrow="Welcome back" title={<>Sign <em>in</em></>}>
      {PHONE_LOGIN_ENABLED && <SignInMethodSwitch value={method} onChange={m => { setMethod(m); setError(''); setNeedsAccount(false); }} />}
      {method === 'phone' ? (
        <>
          {error && (
            <div role="alert" className="notice notice-error mb-4">
              {error}
              {needsAccount && <> <Link href="/register?method=phone" className="underline">Create an account with your phone</Link></>}
            </div>
          )}
          <PhoneCodeForm
            mode="sign_in"
            onSend={phone => { setError(''); setNeedsAccount(false); return sendSignInCode(supabase, phone); }}
            onVerify={async (phone, code) => { await verifyPhoneCode(supabase, phone, code); router.replace(next); }}
            onProblem={p => { setError(p.message); setNeedsAccount(p.next === 'go_register'); }}
          />
        </>
      ) : (
      <form onSubmit={handleLogin} className="space-y-4" noValidate={false}>
        {error && <div id="login-error" role="alert" className="notice notice-error">{error}</div>}
        <div>
          <label htmlFor="login-email" className="field-label">Email</label>
          <input id="login-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="field" required />
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="login-password" className="field-label">Password</label>
            <Link href="/forgot-password" className="mb-1.5 text-xs text-muted underline-offset-4 hover:text-fg hover:underline">Forgot password?</Link>
          </div>
          <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="field" required />
        </div>
        <button type="submit" disabled={loading} className="btn btn-primary w-full py-3">{loading ? 'Signing in…' : 'Sign in'}</button>
      </form>
      )}
      <p className="mt-6 text-sm text-muted">
        New to rideNtrack? <Link href="/register" className="text-accent underline-offset-4 hover:underline">Create an account</Link>
      </p>
    </AuthFrame>
  );
}
