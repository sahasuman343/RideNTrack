'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isValidClubSlug, slugifyClubName } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';
import { useRequiredSession } from '@/lib/planner';

/** Start a club. The link is made from the name and can be edited. */
export default function NewClubPage() {
  useRequiredSession();
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [city, setCity] = useState('');
  const [description, setDescription] = useState('');
  const [byCode, setByCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finalSlug = slugEdited ? slug : slugifyClubName(name);
  const slugBad = finalSlug.length > 0 && !isValidClubSlug(finalSlug);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (name.trim().length < 3) { setError('Give the club a name of at least 3 characters.'); return; }
    if (!isValidClubSlug(finalSlug)) { setError('Fix the club link first.'); return; }
    setBusy(true); setError(null);
    const { error: rpcError } = await supabase.rpc('create_club', {
      p_name: name.trim(), p_slug: finalSlug, p_city: city.trim(), p_description: description.trim(), p_join_policy: byCode ? 'code' : 'open',
    });
    if (rpcError) { setBusy(false); setError(rpcError.message || 'Could not create the club. Try again.'); return; }
    router.replace(`/app/clubs/${finalSlug}`);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-8 lg:py-12">
      <Link href="/app/clubs" className="text-sm text-muted hover:text-fg">← Clubs</Link>
      <p className="eyebrow-label mt-6">New club</p>
      <h1 className="display mt-2 text-4xl sm:text-5xl">Give your crew a <em>home</em></h1>
      <p className="mt-3 text-sm text-muted">A roster, regular rides you plan in one step, and a page you can share.</p>
      <form onSubmit={save} className="panel mt-8 space-y-5 p-5 sm:p-6" noValidate>
        <div><label htmlFor="c-name" className="field-label">Name</label><input id="c-name" className="field" maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="Deccan Dawn Riders" /></div>
        <div>
          <label htmlFor="c-slug" className="field-label">Club link</label>
          <div className="flex items-center rounded border border-line2 bg-bg pl-3 focus-within:outline focus-within:outline-2 focus-within:outline-accent">
            <span className="shrink-0 text-sm text-faint">ridentrack.app/club/</span>
            <input id="c-slug" className="min-w-0 flex-1 bg-transparent py-2.5 pr-3 font-mono text-sm outline-none" maxLength={40} autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={finalSlug} aria-invalid={slugBad} aria-describedby="c-slug-hint"
              onChange={e => { setSlugEdited(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }} />
          </div>
          <p id="c-slug-hint" className={'mt-1 text-xs ' + (slugBad ? 'text-danger' : 'text-faint')}>3 to 40 letters or numbers, single dashes between words.</p>
        </div>
        <div><label htmlFor="c-city" className="field-label">City</label><input id="c-city" className="field" maxLength={60} value={city} onChange={e => setCity(e.target.value)} placeholder="Where you usually start" /></div>
        <div><label htmlFor="c-about" className="field-label">About</label><textarea id="c-about" className="field min-h-24" maxLength={600} value={description} onChange={e => setDescription(e.target.value)} placeholder="What and how you ride, who should join" /></div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--color-accent)]" checked={byCode} onChange={e => setByCode(e.target.checked)} />
          <span>Join by code only<span className="mt-0.5 block text-xs text-muted">Off: anyone with the link can join. On: they also need the code you share.</span></span>
        </label>
        {error && <p role="alert" className="notice notice-error">{error}</p>}
        <button type="submit" disabled={busy} className="btn btn-primary">{busy ? 'Creating…' : 'Create club'}</button>
      </form>
    </main>
  );
}
