'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WAITLIST_OFFER } from '@/lib/site';

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

type State = 'loading' | 'ready' | 'checking' | 'early' | 'confirmed' | 'expired' | 'invalid' | 'error';

/**
 * Opens the link from the confirmation email. Loading the page changes nothing:
 * email scanners open links on their own, so the place is confirmed only when
 * the person presses the button.
 */
export default function ConfirmWaitlist() {
  const [state, setState] = useState<State>('loading');
  const [token, setToken] = useState('');

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') ?? '';
    // A malformed token never reaches the server.
    void Promise.resolve().then(() => {
      setToken(t);
      setState(/^[0-9a-f]{64}$/.test(t) ? 'ready' : 'invalid');
    });
  }, []);

  function confirm() {
    setState('checking');
    fetch(`${URL_BASE}/rest/v1/rpc/confirm_waitlist`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token }),
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((r: { status?: string; early?: boolean }) => {
        if (r.status === 'confirmed') setState(r.early ? 'early' : 'confirmed');
        else setState(r.status === 'expired' ? 'expired' : 'invalid');
      })
      .catch(() => setState('error'));
  }

  if (state === 'loading') return <div className="h-24 animate-pulse rounded bg-surface" />;
  if (state === 'ready' || state === 'checking') {
    return (
      <div className="space-y-4">
        <p>Press the button to confirm your email and your place on the waitlist.</p>
        <button type="button" className="btn btn-primary" onClick={confirm} disabled={state === 'checking'} aria-busy={state === 'checking'}>
          {state === 'checking' ? 'Confirming…' : 'Confirm my email'}
        </button>
      </div>
    );
  }
  if (state === 'early') return <p role="status" className="notice"><strong className="text-accent">You’re one of the first {WAITLIST_OFFER.places}.</strong> Your email is confirmed, and Pro is yours free for {WAITLIST_OFFER.months} months when the app launches.</p>;
  if (state === 'confirmed') return <p role="status" className="notice"><strong className="text-fg">You’re on the list.</strong> Your email is confirmed. We’ll write when the app launches.</p>;
  return (
    <div className="space-y-4">
      <p role="alert" className="notice notice-error">
        {state === 'expired' && 'This link has expired. Join again and we’ll send a new one.'}
        {state === 'invalid' && 'This link doesn’t work. It may have been replaced by a newer email.'}
        {state === 'error' && 'Couldn’t confirm just now. Reload the page and try again.'}
      </p>
      {state !== 'error' && <Link href="/waitlist" className="btn btn-primary">Join the waitlist</Link>}
    </div>
  );
}
