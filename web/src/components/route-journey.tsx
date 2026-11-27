'use client';
import { useEffect, useRef, useState } from 'react';

export interface JourneyStop {
  id: string;
  marker: string;
  title: string;
  body: React.ReactNode;
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The home page's route: one road segment per stop, drawn in as the reader
 * scrolls. Without JavaScript, or with reduced motion, the whole road is drawn.
 */
export default function RouteJourney({ stops, label }: { stops: JourneyStop[]; label: string }) {
  const ref = useRef<HTMLOListElement>(null);
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (reduce.matches) { setProgress(1); return; }
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // The pen sits two thirds of the way down the screen.
      setProgress(clamp((vh * 0.66 - r.top) / r.height));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    frame = requestAnimationFrame(measure);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    reduce.addEventListener('change', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      reduce.removeEventListener('change', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const n = stops.length;
  return (
    <ol ref={ref} aria-label={label} className="journey">
      {stops.map((s, i) => {
        const local = clamp(progress * n - i);
        const side = i % 2 === 0 ? 1 : -1;
        // Each segment leaves the stop, swings out to one side and comes back.
        const d = `M50 0 C 50 22, ${50 + 38 * side} 30, ${50 + 38 * side} 50 S 50 78, 50 100`;
        return (
          <li key={s.id} className={'journey-stop ' + (i % 2 ? 'journey-right' : 'journey-left') + (local > 0 ? ' is-reached' : '')}>
            <div className="journey-track" aria-hidden>
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="journey-svg">
                <path d={d} className="journey-road" vectorEffect="non-scaling-stroke" />
                <path d={d} pathLength={1} className="journey-ink" vectorEffect="non-scaling-stroke" style={{ strokeDashoffset: 1 - local }} />
              </svg>
              <span className="journey-dot"><span>{s.marker}</span></span>
            </div>
            <div className="journey-body">
              <h3 className="font-display text-2xl font-semibold sm:text-3xl">{s.title}</h3>
              <div className="mt-3 space-y-3 text-muted">{s.body}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
