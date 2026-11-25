import { useEffect, useRef, useState } from 'react';

/**
 * Returns `value`, updated at most once per `intervalMs`. The HUD uses this so
 * a burst of GPS ticks never re-renders the speed and distance more than once
 * a second on a low-end phone. The latest value always lands after the window.
 */
export function useThrottledValue<T>(value: T, intervalMs = 1000): T {
  const [throttled, setThrottled] = useState(value);
  const lastEmit = useRef(0);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    const elapsed = Date.now() - lastEmit.current;
    if (elapsed >= intervalMs) {
      lastEmit.current = Date.now();
      setThrottled(value);
      return;
    }
    const timer = setTimeout(() => {
      lastEmit.current = Date.now();
      setThrottled(latest.current);
    }, intervalMs - elapsed);
    return () => clearTimeout(timer);
  }, [value, intervalMs]);

  return throttled;
}
