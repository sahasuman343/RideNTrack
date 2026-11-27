import Link from 'next/link';
import Wordmark from '@/components/wordmark';
import MarketingNav from '@/components/marketing-nav';
import { FOOTER_LINKS } from '@/lib/site';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent">Skip to content</a>
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 px-4 pt-4 sm:flex-nowrap sm:px-8 sm:py-5">
        <Wordmark />
        <MarketingNav />
        <div className="flex items-center gap-1 py-2 text-sm sm:py-0">
          <Link href="/login" className="rounded px-3 py-2 text-muted hover:text-fg">Sign in</Link>
          <Link href="/register" className="btn btn-primary">Create account</Link>
        </div>
      </header>
      <div id="content" tabIndex={-1} className="outline-none">{children}</div>
      <footer className="mt-24 border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm text-muted sm:grid-cols-[1fr_auto] sm:px-8">
          <div>
            <Wordmark className="text-lg" />
            <p className="mt-2 max-w-xs">Group motorcycle rides, planned together and tracked live. Made for riders in India.</p>
          </div>
          <nav aria-label="Footer">
            <ul className="grid grid-cols-2 gap-x-8 gap-y-1">
              {FOOTER_LINKS.map(l => <li key={l.href}><Link href={l.href} className="inline-block py-1.5 hover:text-fg">{l.label}</Link></li>)}
            </ul>
          </nav>
        </div>
      </footer>
    </>
  );
}
