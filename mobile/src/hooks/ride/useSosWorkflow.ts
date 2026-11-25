import { useCallback, useRef, useState } from 'react';
import { Linking, Platform, Share } from 'react-native';
import { formatEmergencySms, isStale, type LocationUpdate, type Profile, type Ride } from '@ridentrack/shared';
import type { AlertOutcome } from './useRideAlerts';
import { track } from '../../services/analytics';

/**
 * SOS steps for the rider who needs help: group alert first (queued when
 * offline), then their own text and call options. Every message uses the one
 * builder, formatEmergencySms.
 */
export function useSosWorkflow(params: {
  ride: Ride | null;
  profile: Profile | null;
  riderName: string;
  position: LocationUpdate | null;
  sendAlert: (type: 'emergency') => Promise<AlertOutcome>;
  setMessage: (m: string | null) => void;
  onMissingContact: () => void;
}) {
  const [sosModal, setSosModal] = useState(false);
  const latest = useRef(params);
  latest.current = params;

  const triggerSosWorkflow = useCallback(() => setSosModal(true), []);
  const closeSos = useCallback(() => setSosModal(false), []);

  const broadcastSosToGroup = useCallback(async () => {
    const { sendAlert, position, setMessage } = latest.current;
    setSosModal(false);
    const outcome = await sendAlert('emergency');
    track('sos_state', { step: 'group', state: outcome === 'sent' ? 'sent' : outcome === 'queued' ? 'waiting_for_signal' : 'failed' });
    if (outcome === 'failed') return;
    const fixAgeMin = position ? Math.floor((Date.now() - Date.parse(position.timestamp)) / 60000) : null;
    const where = !position
      ? 'GPS has no fix yet, so the alert has no location.'
      : isStale(position.timestamp)
        ? `It includes your last known location from ${Math.max(1, fixAgeMin ?? 1)} min ago.`
        : 'It includes your live location.';
    setMessage((outcome === 'sent' ? 'Emergency alert sent to the group. ' : 'No signal: emergency alert saved and will send as soon as you are back online. ') + where);
  }, []);

  const dialEmergencyContact = useCallback(async () => {
    setSosModal(false);
    const phone = latest.current.profile?.emergency_contact || '112';
    try {
      await Linking.openURL('tel:' + phone);
    } catch {
      latest.current.setMessage('Could not launch phone dialer.');
    }
  }, []);

  const sendEmergencySms = useCallback(async () => {
    const { position, profile, ride, riderName, setMessage, sendAlert, onMissingContact } = latest.current;
    setSosModal(false);
    if (!position) {
      setMessage('No GPS fix available.');
      return;
    }
    const phone = profile?.emergency_contact || '';
    if (!phone) {
      onMissingContact();
      return;
    }
    if (!isStale(position.timestamp)) void sendAlert('emergency');
    const body = formatEmergencySms({
      riderName,
      motorcycleModel: profile?.motorcycle_model,
      rideName: ride?.name || 'Ride',
      latitude: position.lat,
      longitude: position.lng,
    });
    const sep = Platform.OS === 'ios' ? '&' : '?';
    const smsUrl = `sms:${phone}${sep}body=${encodeURIComponent(body)}`;
    try {
      if (await Linking.canOpenURL(smsUrl)) await Linking.openURL(smsUrl);
      else await Share.share({ message: body });
      setMessage('Emergency SOS initiated.');
    } catch {
      setMessage('Could not launch SMS.');
    }
  }, []);

  return { sosModal, triggerSosWorkflow, closeSos, broadcastSosToGroup, dialEmergencyContact, sendEmergencySms };
}
