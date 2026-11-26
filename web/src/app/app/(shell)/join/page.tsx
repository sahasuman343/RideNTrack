'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { APP_DOWNLOAD_URL } from '@/lib/links';

const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

export default function JoinPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const query = use(searchParams);
  const linked = clean((Array.isArray(query.code) ? query.code[0] : query.code) ?? '');
  const [code, setCode] = useState(linked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (code.length < 4) { setError('Enter the invite code the leader shared with you.'); return; }
    setBusy(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc('join_ride_by_code', { p_code: code });
    if (rpcError || !data) {
      setBusy(false);
      const msg = rpcError?.message || '';
      setError(/invalid ride code|has ended/i.test(msg) ? 'No open trip uses that code. Check it with the leader.' : msg || 'Could not join. Try again.');
      return;
    }
    router.replace('/app/trips/' + data);
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8 sm:px-8 lg:py-12">
      <p className="eyebrow-label">Join a trip</p>
      <h1 className="display mt-2 text-4xl sm:text-5xl">Got an <em>invite?</em></h1>
      <p className="mt-3 text-sm text-muted">Enter the code from the trip leader. You will see the plan, the route and who is going.</p>
      <form onSubmit={join} className="panel mt-8 space-y-4 p-5">
        <div>
          <label htmlFor="join-code" className="field-label">Invite code</label>
          <input id="join-code" className="field font-mono text-lg uppercase tracking-[0.3em]" value={code} autoComplete="off" autoCapitalize="characters" spellCheck={false}
            onChange={e => { setCode(clean(e.target.value)); setError(null); }} placeholder="ABC123" aria-describedby={error ? 'join-error' : undefined} />
        </div>
        {error && <p id="join-error" role="alert" className="notice notice-error">{error}</p>}
        <button type="submit" disabled={busy} className="btn btn-primary w-full py-3">{busy ? 'Joining…' : 'Join trip'}</button>
      </form>
      <p className="mt-6 text-sm text-muted">Riding today? Live location sharing runs in the <Link href={APP_DOWNLOAD_URL} className="text-accent hover:underline">phone app</Link>.</p>
    </main>
  );
}
