import Wordmark from '@/components/wordmark';

/** Split layout for sign in and register: form on the left, a quiet road log on the right. */
export default function AuthFrame({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <Wordmark />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <p className="eyebrow-label">{eyebrow}</p>
          <h1 className="display mt-3 text-4xl">{title}</h1>
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <aside aria-hidden className="relative hidden overflow-hidden border-l border-line bg-map lg:block">
        <svg viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
          <defs>
            <pattern id="auth-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#1a1a1d" strokeWidth="1" /></pattern>
          </defs>
          <rect width="600" height="800" fill="url(#auth-grid)" />
          <path d="M-20 640 C 90 600, 120 520, 210 500 S 330 520, 360 430 S 330 300, 420 250 S 560 210, 640 120" fill="none" stroke="#060607" strokeWidth="12" strokeLinecap="round" />
          <path d="M-20 640 C 90 600, 120 520, 210 500 S 330 520, 360 430 S 330 300, 420 250 S 560 210, 640 120" fill="none" stroke="#ff8a2a" strokeWidth="3" strokeLinecap="round" />
          <circle cx="210" cy="500" r="7" fill="#edebe6" stroke="#060607" strokeWidth="3" />
          <circle cx="360" cy="430" r="6" fill="#ff8a2a" stroke="#060607" strokeWidth="3" />
          <circle cx="420" cy="250" r="7" fill="#edebe6" stroke="#060607" strokeWidth="3" />
        </svg>
        <p className="absolute bottom-8 left-8 right-8 max-w-sm font-display text-2xl leading-snug text-fg">Plan the route on a big screen. Ride it together. Let home follow along.</p>
      </aside>
    </main>
  );
}
