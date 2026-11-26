import Link from 'next/link';

export default function Wordmark({ href = '/', className = '' }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={'font-display text-[22px] font-semibold tracking-tight text-fg ' + className} aria-label="rideNtrack home">
      ride<span className="italic text-accent">n</span>track.
    </Link>
  );
}
