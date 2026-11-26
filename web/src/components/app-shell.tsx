'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Wordmark from '@/components/wordmark';

const NAV = [
  { href: '/app', label: 'Rides', match: (p: string) => p === '/app' || p.startsWith('/app/rides') },
  { href: '/app/trips', label: 'Trips', match: (p: string) => p.startsWith('/app/trips') },
  { href: '/app/join', label: 'Join', match: (p: string) => p.startsWith('/app/join') },
];

/** Signed-in frame: a quiet sidebar on desktop, a top bar on phones. */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      const id = data.session?.user.id;
      if (!id) return;
      const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', id).single();
      if (!cancelled) setName((profile as { display_name?: string } | null)?.display_name ?? null);
    });
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync); window.addEventListener('offline', sync);
    return () => { cancelled = true; window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
  }, []);

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (!error) router.replace('/login');
  }

  const nav = NAV.map(item => {
    const active = item.match(pathname);
    return (
      <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
        className={'whitespace-nowrap rounded px-2.5 py-2 text-sm font-medium transition-colors sm:px-3 ' + (active ? 'bg-raise text-fg shadow-[inset_0_-2px_0_var(--color-accent)] lg:shadow-[inset_2px_0_0_var(--color-accent)]' : 'text-muted hover:text-fg')}>
        {item.label}
      </Link>
    );
  });

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b sm:gap-4 border-line bg-bg/95 px-4 py-3 backdrop-blur-sm lg:h-screen lg:flex-col lg:items-stretch lg:justify-start lg:border-b-0 lg:border-r lg:bg-transparent lg:px-5 lg:py-6">
        <Wordmark href="/app" />
        <nav aria-label="App" className="flex gap-1 lg:mt-10 lg:flex-col">{nav}</nav>
        <div className="hidden lg:mt-auto lg:block">
          <p className="eyebrow-label">Signed in</p>
          <p className="mt-1 truncate text-sm">{name ?? ' '}</p>
          <button className="mt-3 text-sm text-muted hover:text-fg" onClick={() => void signOut()}>Sign out</button>
        </div>
        <button className="whitespace-nowrap text-sm text-muted hover:text-fg lg:hidden" onClick={() => void signOut()}>Sign out</button>
      </aside>
      <div className="min-w-0">
        {!online && <p role="status" className="border-b border-line bg-raise px-6 py-2 text-sm text-muted">You are offline. Showing what was last loaded; changes will not save until you reconnect.</p>}
        {children}
      </div>
    </div>
  );
}
