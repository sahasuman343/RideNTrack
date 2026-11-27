'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WAITLIST_OFFER } from '@/lib/site';

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

type State = 'checking' | 'early' | 'confirmed' | 'expired' | 'invalid' | 'error';

/** Opens the link from the confirmation email: confirms the place and says whether it is in the first places. */
export default function ConfirmWaitlist() {
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    let live = true;
    // A malformed token never reaches the server.
    const ask: Promise<{ status?: string; early?: boolean }> = /^[0-9a-f]{64}$/.test(token)
      ? fetch(`${URL_BASE}/rest/v1/rpc/confirm_waitlist`, {
          method: 'POST',
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_token: token }),
        }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      : Promise.resolve({ status: 'invalid' });
    ask
      .then((r: { status?: string; early?: boolean }) => {
        if (!live) return;
        if (r.status === 'confirmed') setState(r.early ? 'early' : 'confirmed');
        else setState(r.status === 'expired' ? 'expired' : 'invalid');
      })
      .catch(() => { if (live) setState('error'); });
    return () => { live = false; };
  }, []);

  if (state === 'checking') return <div role="status" aria-label="Confirming your email" className="h-24 animate-pulse rounded bg-surface" />;
  if (state === 'early') return <p role="status" className="notice"><strong className="text-accent">You’re one of the first {WAITLIST_OFFER.places}.</strong> Your email is confirmed, and Pro is yours free for {WAITLIST_OFFER.months} months when the app launches.</p>;
  if (state === 'confirmed') return <p role="status" className="notice"><strong className="text-fg">You’re on the list.</strong> Your email is confirmed. We’ll write when the app launches.</p>;
  return (
    <div className="space-y-4">
      <p role="alert" className="notice notice-error">
        {state === 'expired' && 'This link has expired. Join again and we’ll send a new one.'}
        {state === 'invalid' && 'This link doesn’t work. It may have been replaced by a newer email.'}
        {state === 'error' && 'Couldn’t confirm just now. Reload the page to try again.'}
      </p>
      {state !== 'error' && <Link href="/waitlist" className="btn btn-primary">Join the waitlist</Link>}
    </div>
  );
}
