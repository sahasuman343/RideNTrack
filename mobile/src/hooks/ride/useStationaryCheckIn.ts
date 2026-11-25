import { useCallback, useEffect, useRef, useState } from 'react';
import { distanceMeters, evaluateStationaryOffRouteCheckIn, type LocationUpdate } from '@ridentrack/shared';

const CHECK_IN_SECONDS = 120;
const COOLDOWN_MS = 10 * 60 * 1000;

interface Waypoint { latitude: number; longitude: number; waypoint_type?: string | null }

/**
 * Asks a rider who has stopped off-route whether they are OK, and raises a
 * group alert if nobody answers within two minutes.
 */
export function useStationaryCheckIn(params: {
  active: boolean;
  position: LocationUpdate | null;
  now: number;
  waypoints: Waypoint[];
  routeCoordinates?: number[][] | null;
  onUnanswered: () => void;
}) {
  const { active, position, now, waypoints, routeCoordinates } = params;
  const [stationaryCountdown, setStationaryCountdown] = useState<number | null>(null);
  const stationarySinceRef = useRef<number | null>(null);
  const stationaryAnchorRef = useRef<{ lat: number; lng: number } | null>(null);
  const stationaryCooldownUntilRef = useRef<number>(0);
  const onUnansweredRef = useRef(params.onUnanswered);
  onUnansweredRef.current = params.onUnanswered;

  useEffect(() => {
    if (!active || !position) {
      stationarySinceRef.current = null;
      stationaryAnchorRef.current = null;
      setStationaryCountdown(null);
      return;
    }
    const nowMs = Date.now();
    const speedKmh = (position.speed || 0) * 3.6;
    const anchor = stationaryAnchorRef.current;
    const moved = anchor ? distanceMeters(anchor, { lat: position.lat, lng: position.lng }) >= 25 : true;
    if (speedKmh >= 2 || moved) {
      stationaryAnchorRef.current = { lat: position.lat, lng: position.lng };
      stationarySinceRef.current = nowMs;
      setStationaryCountdown(c => (c !== null ? null : c));
      return;
    }
    if (!stationarySinceRef.current) {
      stationarySinceRef.current = nowMs;
      return;
    }
    if (nowMs < stationaryCooldownUntilRef.current) return;
    const check = evaluateStationaryOffRouteCheckIn({
      stationaryDurationMs: nowMs - stationarySinceRef.current,
      currentLat: position.lat,
      currentLng: position.lng,
      waypoints,
      routeCoordinates,
    });
    if (check.shouldPrompt) setStationaryCountdown(c => (c === null ? CHECK_IN_SECONDS : c));
  }, [active, position?.lat, position?.lng, position?.speed, position?.timestamp, now, waypoints, routeCoordinates]);

  useEffect(() => {
    if (stationaryCountdown === null) return;
    if (stationaryCountdown <= 0) {
      setStationaryCountdown(null);
      stationaryCooldownUntilRef.current = Date.now() + COOLDOWN_MS;
      onUnansweredRef.current();
      return;
    }
    const t = setTimeout(() => setStationaryCountdown(c => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [stationaryCountdown]);

  const confirmOk = useCallback(() => {
    setStationaryCountdown(null);
    stationaryCooldownUntilRef.current = Date.now() + COOLDOWN_MS;
  }, []);

  return { stationaryCountdown, confirmOk };
}
