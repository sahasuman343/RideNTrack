import Link from 'next/link';
import Wordmark from '@/components/wordmark';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent">Skip to content</a>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <Wordmark />
        <nav aria-label="Site" className="flex items-center gap-1 text-sm sm:gap-3">
          <Link href="/download" className="hidden rounded px-3 py-2 text-muted hover:text-fg sm:inline-block">Get the app</Link>
          <Link href="/login" className="rounded px-3 py-2 text-muted hover:text-fg">Sign in</Link>
          <Link href="/register" className="btn btn-primary">Create account</Link>
        </nav>
      </header>
      <div id="content">{children}</div>
      <footer className="mt-24 border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:px-8">
          <Wordmark className="text-lg" />
          <p>Made for riders in India.</p>
        </div>
      </footer>
    </>
  );
}
