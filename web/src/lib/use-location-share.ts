'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { locationRowFor, shouldSendFix, type BrowserFix } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';

export type ShareState =
  | { kind: 'off' }
  | { kind: 'asking' }
  | { kind: 'sharing'; lastSentAt: number | null; pending: number }
  | { kind: 'denied' }
  | { kind: 'unavailable'; reason: string };

const MAX_PENDING = 100; // one RPC batch

/**
 * Shares this browser's position with the ride while the page is open. Nothing
 * is read until the rider turns it on, and it stops when they turn it off,
 * leave the page, or the ride stops being active.
 */
export function useLocationShare(rideId: string | null, userId: string | null, rideActive: boolean) {
  const [state, setState] = useState<ShareState>({ kind: 'off' });
  const watchId = useRef<number | null>(null);
  const last = useRef<BrowserFix | null>(null);
  const pending = useRef<ReturnType<typeof locationRowFor>[]>([]);
  const sending = useRef(false);

  const stop = useCallback(() => {
    if (watchId.current != null && typeof navigator !== 'undefined') navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = null; last.current = null; pending.current = [];
    setState({ kind: 'off' });
  }, []);

  const flush = useCallback(async () => {
    if (sending.current || pending.current.length === 0) return;
    sending.current = true;
    const batch = pending.current.slice(0, MAX_PENDING);
    const { error } = await supabase.rpc('bulk_insert_location_updates', { updates: batch });
    sending.current = false;
    if (watchId.current == null) return; // turned off meanwhile
    if (!error) pending.current = pending.current.slice(batch.length);
    else if (/Invalid or unauthorized/i.test(error.message || '')) {
      // Not (or no longer) a rider on this trip: sharing cannot work, so stop.
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null; pending.current = [];
      setState({ kind: 'unavailable', reason: 'You are not an active rider on this ride, so your location was not shared.' });
      return;
    }
    const left = pending.current.length;
    setState(s => ({ kind: 'sharing', lastSentAt: error ? (s.kind === 'sharing' ? s.lastSentAt : null) : Date.now(), pending: left }));
  }, []);

  const start = useCallback(() => {
    if (!rideId || !userId || watchId.current != null) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setState({ kind: 'unavailable', reason: 'This browser cannot share location.' }); return; }
    if (!window.isSecureContext) { setState({ kind: 'unavailable', reason: 'Location sharing needs a secure (https) page.' }); return; }
    last.current = null; pending.current = [];
    setState({ kind: 'asking' });
    watchId.current = navigator.geolocation.watchPosition(pos => {
      const fix: BrowserFix = {
        lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null,
        speed: pos.coords.speed ?? null, heading: pos.coords.heading ?? null, timestamp: pos.timestamp || Date.now(),
      };
      setState(s => s.kind === 'asking' ? { kind: 'sharing', lastSentAt: null, pending: 0 } : s);
      if (!shouldSendFix(last.current, fix)) return;
      last.current = fix;
      pending.current = [...pending.current, locationRowFor(fix, rideId, userId, crypto.randomUUID())].slice(-MAX_PENDING);
      void flush();
    }, err => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      if (err.code === err.PERMISSION_DENIED) setState({ kind: 'denied' });
      else setState({ kind: 'unavailable', reason: err.code === err.TIMEOUT ? 'Your position took too long to arrive. Try again outdoors or near a window.' : 'Your position is not available right now.' });
    }, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 });
  }, [rideId, userId, flush]);

  // Stop when the ride ends or the page goes away.
  useEffect(() => { if (!rideActive && watchId.current != null) stop(); }, [rideActive, stop]);
  useEffect(() => () => { if (watchId.current != null) navigator.geolocation?.clearWatch(watchId.current); }, []);

  return { state, start, stop };
}
