'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MARKETING_NAV } from '@/lib/site';

/** Site links. On phones they drop to their own row under the wordmark. */
export default function MarketingNav() {
  const path = usePathname();
  return (
    <nav aria-label="Site" className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto border-t border-line px-2 sm:order-none sm:mx-0 sm:w-auto sm:border-0 sm:px-0">
      <ul className="flex min-w-max items-center gap-1 text-sm">
        {MARKETING_NAV.map(l => {
          const current = path === l.href;
          return (
            <li key={l.href}>
              <Link href={l.href} aria-current={current ? 'page' : undefined} className={'inline-block rounded px-2 py-3 sm:px-3 sm:py-2 ' + (current ? 'text-fg' : 'text-muted hover:text-fg')}>
                {l.label}
                {current && <span aria-hidden className="mt-1 block h-px bg-accent" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
