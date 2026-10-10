import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { type LocationUpdate } from '@ridentrack/shared';
export function useAnimatedLocations(points: LocationUpdate[]) {
  const [animated, setAnimated] = useState(points);
  const current = useRef(points);
  const reduced = useRef(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { reduced.current = value; });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { reduced.current = value; });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const before = new Map(current.current.map(p => [p.user_id, p]));
    let frame = 0, start = 0, last = 0;
    const tick = (time: number) => {
      start ||= time;
      const t = reduced.current ? 1 : Math.min((time - start) / 900, 1);
      if (time - last >= 32 || t === 1) {
        last = time; const eased = t * (2 - t);
        const next = points.map(p => {
          const old = before.get(p.user_id);
          if (!old || !Number.isFinite(old.lat) || !Number.isFinite(old.lng) || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return p;
          const delta = ((p.lng - old.lng + 540) % 360) - 180;
          const lat = old.lat + (p.lat - old.lat) * eased;
          const lng = ((old.lng + delta * eased + 540) % 360) - 180;
          return {
            ...p,
            lat: Number.isFinite(lat) ? lat : p.lat,
            lng: Number.isFinite(lng) ? lng : p.lng,
          };
        });
        current.current = next; setAnimated(next);
      }
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [points]);
  return animated;
}
