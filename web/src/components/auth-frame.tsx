import Wordmark from '@/components/wordmark';
import HeroScene from '@/components/hero-scene';

/** Split layout for sign in, register and password help: form on the left, the route terrain on the right. */
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
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2"><HeroScene /></div>
        <p className="absolute bottom-8 left-8 right-8 max-w-sm font-display text-2xl leading-snug text-fg">Plan the route on a big screen. Ride it together. Let home follow along.</p>
      </aside>
    </main>
  );
}
