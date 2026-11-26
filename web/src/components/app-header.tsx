'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const NAV = [
  { href: '/dashboard', label: 'Rides', match: (p: string) => p.startsWith('/dashboard') },
  { href: '/trips', label: 'Trips', match: (p: string) => p.startsWith('/trips') || p.startsWith('/trip') },
];

export default function AppHeader({ name }: { name?: string | null }) {
  const pathname = usePathname() || '';
  const router = useRouter();
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (!error) router.replace('/login');
  }
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e5e9e2] bg-white px-4 py-4 sm:px-6">
      <div className="flex items-center gap-6">
        <Link href="/dashboard" className="text-2xl font-extrabold tracking-tight text-[#203c43]">ride<span className="text-[#d66029]">n</span>track.</Link>
        <nav aria-label="Main" className="flex gap-1">
          {NAV.map(item => (
            <Link key={item.href} href={item.href} aria-current={item.match(pathname) ? 'page' : undefined}
              className={'rounded-full px-3 py-1.5 text-sm font-medium ' + (item.match(pathname) ? 'bg-[#203c43] text-white' : 'text-[#203c43] hover:bg-[#eef2ea]')}>
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-5">
        {name && <span className="hidden text-sm text-[#718084] sm:inline">{name}</span>}
        <button className="text-sm font-medium text-[#203c43] hover:text-[#d66029]" onClick={() => void signOut()}>Sign out</button>
      </div>
    </header>
  );
}
