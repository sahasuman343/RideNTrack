import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { type LocationUpdate } from '@ridentrack/shared';

const ANIMATION_DURATION_MS = 900;
// Ten visual updates per second are sufficient for moving map markers and
// reduce JS work substantially on entry-level Android devices.
const FRAME_INTERVAL_MS = 100;

export function useAnimatedLocations(points: LocationUpdate[]) {
  const [animated, setAnimated] = useState(points);
  const current = useRef(points);
  const reduced = useRef(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted) reduced.current = value;
    }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      reduced.current = value;
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    const before = new Map(current.current.map(point => [point.user_id, point]));
    const changed = points.filter(point => {
      const old = before.get(point.user_id);
      return !old || old.lat !== point.lat || old.lng !== point.lng;
    });

    if (reduced.current || changed.length === 0) {
      current.current = points;
      setAnimated(previous => previous === points ? previous : points);
      return;
    }

    const startedAt = Date.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const progress = Math.min((Date.now() - startedAt) / ANIMATION_DURATION_MS, 1);
      const eased = progress * (2 - progress);
      const changedById = new Map(changed.map(point => [point.user_id, point]));
      const next = points.map(point => {
        const target = changedById.get(point.user_id);
        const old = before.get(point.user_id);
        if (!target || !old
          || !Number.isFinite(old.lat) || !Number.isFinite(old.lng)
          || !Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return point;

        const deltaLng = ((target.lng - old.lng + 540) % 360) - 180;
        const lat = old.lat + (target.lat - old.lat) * eased;
        const lng = ((old.lng + deltaLng * eased + 540) % 360) - 180;
        return {
          ...point,
          lat: Number.isFinite(lat) ? lat : target.lat,
          lng: Number.isFinite(lng) ? lng : target.lng,
        };
      });
      current.current = progress === 1 ? points : next;
      setAnimated(next);

      if (progress < 1) timeout = setTimeout(tick, FRAME_INTERVAL_MS);
    };

    tick();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [points]);

  return animated;
}
