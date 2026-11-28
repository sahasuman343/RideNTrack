'use client';
import { useEffect, useRef } from 'react';

/** Leans the hero terrain a few degrees toward a mouse pointer. Touch and reduced motion leave it still. */
export default function SceneTilt({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)').matches) return;
    let frame = 0, x = 0, y = 0;
    const apply = () => { frame = 0; el.style.setProperty('--pz', `${x * 6}deg`); el.style.setProperty('--px', `${-y * 5}deg`); };
    const move = (e: PointerEvent) => {
      x = e.clientX / window.innerWidth - 0.5;
      y = e.clientY / window.innerHeight - 0.5;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => { window.removeEventListener('pointermove', move); if (frame) cancelAnimationFrame(frame); };
  }, []);
  return <div ref={ref} className="scene-tilt">{children}</div>;
}
