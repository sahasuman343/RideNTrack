import { useCallback, useRef, useState } from 'react';
import { isStale, validCoordinates, type AlertType, type LocationUpdate } from '@ridentrack/shared';
import { supabase } from '../../lib/supabase';
import { enqueueAlert, newQueueId } from '../../lib/offlineQueue';
import { track } from '../../services/analytics';

/** An SOS-type alert must never wait for GPS; the last fix (or none) goes with it. */
const NO_FIX_ALERT_TYPES = new Set<AlertType>(['emergency', 'check_in_missed', 'possible_crash', 'crash_cancelled', 'crash_detected']);

export type AlertOutcome = 'sent' | 'queued' | 'failed';

/**
 * Sending group alerts and announcements, with the offline queue as the
 * fallback. Outcome words map onto the shared status vocabulary:
 * sent → "Sent", queued → "Waiting for signal", failed → "Failed".
 */
export function useRideAlerts(params: {
  rideId: string;
  userId: string | undefined;
  position: LocationUpdate | null;
  isOnline: boolean;
  refresh: () => Promise<void> | void;
  updateCounts: () => Promise<void>;
  setMessage: (m: string | null) => void;
}) {
  const { rideId, userId, position, isOnline } = params;
  const [busy, setBusy] = useState(false);
  const [acknowledgedAlertIds, setAcknowledgedAlertIds] = useState<string[]>([]);
  const [acknowledgementMap, setAcknowledgementMap] = useState<Record<string, { count: number; riders: string[] }>>({});
  const latest = useRef(params);
  latest.current = params;

  const sendAlert = useCallback(async (type: AlertType, customMessage?: string, alertId?: string): Promise<'sent' | 'queued' | 'failed'> => {
    const { setMessage, refresh, updateCounts } = latest.current;
    if (!userId) return 'failed';
    const hasFreshFix = Boolean(position && !isStale(position.timestamp));
    // An SOS must never be blocked by GPS: in a tunnel, a valley, or right
    // after unlocking a phone that only had foreground permission, the last
    // known position (with its age) is far better than nothing.
    if (!hasFreshFix && !NO_FIX_ALERT_TYPES.has(type)) {
      setMessage('Wait for a fresh GPS fix before sending an alert.');
      return 'failed';
    }
    const fix = position && validCoordinates(position.lat, position.lng) ? position : null;
    setBusy(true);
    try {
      const alert = {
        id: alertId ?? await newQueueId(), ride_id: rideId, user_id: userId, type, message: customMessage,
        lat: fix ? fix.lat : null, lng: fix ? fix.lng : null,
        location_recorded_at: fix ? fix.timestamp : null,
        created_at: new Date().toISOString(),
      };
      if (isOnline) {
        const { error, status } = await supabase.from('alerts').upsert(alert, { onConflict: 'id', ignoreDuplicates: true });
        if (!error) {
          void refresh();
          track('alert_sent', { type, state: 'sent' });
          return 'sent';
        }
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          setMessage(error.message);
          track('alert_sent', { type, state: 'failed' });
          return 'failed';
        }
      }
      await enqueueAlert(alert);
      void updateCounts().catch(() => {});
      setMessage('Alert saved. Waiting for signal to send.');
      track('alert_sent', { type, state: 'waiting_for_signal' });
      return 'queued';
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save alert.');
      return 'failed';
    } finally {
      setBusy(false);
    }
  }, [rideId, userId, position, isOnline]);

  const acknowledgeAnnouncement = useCallback(async (alertId: string) => {
    if (!alertId) return;
    try {
      const { error: ackErr } = await supabase.rpc('acknowledge_alert', { p_alert_id: alertId });
      if (ackErr) throw ackErr;
      setAcknowledgedAlertIds(prev => (prev.includes(alertId) ? prev : [...prev, alertId]));
    } catch (e: unknown) {
      latest.current.setMessage(e instanceof Error ? e.message : 'Could not acknowledge announcement. Tap to retry.');
    }
  }, []);

  const fetchAcknowledgements = useCallback(async (alertId: string) => {
    try {
      const { data, error } = await supabase.rpc('get_alert_acknowledgements', { p_alert_id: alertId });
      if (!error && Array.isArray(data)) {
        setAcknowledgementMap(prev => ({
          ...prev,
          [alertId]: { count: data.length, riders: data.map((d: { display_name?: string }) => d.display_name || 'Rider') },
        }));
      }
    } catch {
      // Offline: the dashboard shows "Checking..." until the next open.
    }
  }, []);

  return { busy, setBusy, sendAlert, acknowledgedAlertIds, acknowledgeAnnouncement, acknowledgementMap, fetchAcknowledgements };
}
