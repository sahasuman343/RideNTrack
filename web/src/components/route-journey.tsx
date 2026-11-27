'use client';
import { useEffect, useRef, useState } from 'react';

export interface JourneyStop {
  id: string;
  marker: string;
  title: string;
  body: React.ReactNode;
  tags?: string[];
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The home page's route: one road segment per stop, drawn in as the reader
 * scrolls. Without JavaScript, or with reduced motion, the whole road is drawn.
 */
export default function RouteJourney({ stops, label }: { stops: JourneyStop[]; label: string }) {
  const ref = useRef<HTMLOListElement>(null);
  const [progress, setProgress] = useState(1);
  // Each segment's size in CSS pixels, so the SVG is drawn unscaled and its dash maths is exact.
  const [sizes, setSizes] = useState<{ w: number; h: number }[] | null>(null);

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
    const resize = () => {
      const next = [...el.querySelectorAll<SVGSVGElement>('.journey-svg')].map(t => { const r = t.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
      setSizes(prev => prev && prev.length === next.length && prev.every((p, i) => p.w === next[i].w && p.h === next[i].h) ? prev : next);
      onScroll();
    };
    frame = requestAnimationFrame(() => { resize(); measure(); });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', resize);
    reduce.addEventListener('change', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', resize);
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
        const size = sizes?.[i];
        const w = size?.w || 100, h = size?.h || 100, cx = w / 2, sx = cx + 0.38 * w * side;
        // Each segment leaves the stop, swings out to one side and comes back.
        const d = `M${cx} 0 C ${cx} ${h * 0.22}, ${sx} ${h * 0.3}, ${sx} ${h * 0.5} S ${cx} ${h * 0.78}, ${cx} ${h}`;
        return (
          <li key={s.id} className={'journey-stop ' + (i % 2 ? 'journey-right' : 'journey-left') + (local > 0 ? ' is-reached' : '')}>
            <div className="journey-track" aria-hidden>
              <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="journey-svg">
                <path d={d} className="journey-road" vectorEffect="non-scaling-stroke" />
                {/* Until the segment is measured (or with no JavaScript) the ink is drawn whole. */}
                <path d={d} pathLength={1} className={size ? 'journey-ink' : 'journey-ink journey-ink-whole'} vectorEffect={size ? undefined : 'non-scaling-stroke'} style={size ? { strokeDashoffset: 1 - local } : undefined} />
              </svg>
              <span className="journey-dot"><span>{s.marker}</span></span>
            </div>
            <span className="journey-ghost" aria-hidden>{s.marker}</span>
            <div className="journey-body">
              <h3 className="font-display text-2xl font-semibold sm:text-3xl">{s.title}</h3>
              <div className="mt-3 space-y-3 text-muted">{s.body}</div>
              {s.tags && <ul className={'mt-4 flex flex-wrap gap-2 ' + (i % 2 ? '' : 'md:justify-end')} aria-label={s.title + ': highlights'}>{s.tags.map(t => <li key={t} className="chip">{t}</li>)}</ul>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
