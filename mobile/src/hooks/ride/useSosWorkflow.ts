import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Share } from 'react-native';
import {
  formatEmergencySms,
  isStale,
  mergeSosRecipients,
  smsComposerUrl,
  sosPrimaryLabel,
  sosSteps,
  type LocationUpdate,
  type Profile,
  type Ride,
  type SosRecipient,
} from '@ridentrack/shared';
import type { AlertOutcome } from './useRideAlerts';
import { supabase } from '../../lib/supabase';
import { getRideValue, saveRideValue } from '../../lib/tripCache';
import { newQueueId } from '../../lib/offlineQueue';
import { track } from '../../services/analytics';
import { useT } from '../useLocale';

/*
 * F6 SOS. One press does everything that can be done: the pack alert (queued
 * with no signal), server SMS when there is some data and it is switched on,
 * and one Messages composer to everyone on the cached list. The sheet then
 * shows each step in the shared status words, so the rider knows exactly
 * what happened and what is left to do.
 */

type PackState = 'pending' | 'sent' | 'queued' | 'failed';
type ComposerState = 'pending' | 'opened' | 'unavailable' | 'no_recipients';
type ServerState = 'off' | 'pending' | 'queued' | 'sent' | 'failed';

/** Ids of SOS texts already on the ride, so a new alert is not shown as sent by an older one. */
async function sosSmsIds(rideId: string | undefined): Promise<Set<string>> {
  if (!rideId) return new Set();
  const { data } = await supabase.rpc('get_outbound_status', { p_ride_id: rideId });
  const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; template: string }>;
  return new Set(rows.filter(r => r.template === 'sos_alert' || r.template === 'crash_alert').map(r => r.id));
}

export function useSosWorkflow(params: {
  ride: Ride | null;
  profile: Profile | null;
  riderName: string;
  position: LocationUpdate | null;
  online: boolean;
  serverSms: boolean;
  sendAlert: (type: 'emergency' | 'crash_detected', message?: string, alertId?: string) => Promise<AlertOutcome>;
  setMessage: (m: string | null) => void;
  onMissingContact: () => void;
}) {
  const t = useT();
  const [sosModal, setSosModal] = useState(false);
  const [started, setStarted] = useState(false);
  const [pack, setPack] = useState<PackState>('pending');
  const [composer, setComposer] = useState<ComposerState>('pending');
  const [server, setServer] = useState<ServerState>('off');
  const [recipients, setRecipients] = useState<SosRecipient[]>([]);
  const alertIdRef = useRef<string | null>(null);
  const latest = useRef(params);
  latest.current = params;
  const rideId = params.ride?.id;
  const rideStatus = params.ride?.status;
  const userId = params.profile?.id;
  // Outbound rows that existed before this SOS asked for texts; only newer ones count.
  const priorSmsIds = useRef<Set<string> | null>(null);

  // Cache the recipient list when the ride is open with signal; read it back with none.
  useEffect(() => {
    setRecipients([]);
    if (!rideId || !userId) return;
    // Per rider: the list includes this rider's own private emergency contact.
    const key = `sos-recipients:${userId}:${rideId}`;
    let cancelled = false;
    void getRideValue<SosRecipient[]>(key).then(cached => { if (!cancelled && cached) setRecipients(cached); });
    if (!params.online || (rideStatus !== 'planned' && rideStatus !== 'active')) return () => { cancelled = true; };
    void supabase.rpc('get_ride_sos_recipients', { p_ride_id: rideId }).then(({ data, error }) => {
      if (cancelled || error || !Array.isArray(data)) return;
      const merged = mergeSosRecipients(data as Array<{ name: string; phone: string; role: string }>, latest.current.profile?.phone);
      setRecipients(merged);
      void saveRideValue(key, merged);
    });
    return () => { cancelled = true; };
  }, [rideId, userId, rideStatus, params.online]);

  // Follow the server SMS until it reports sent.
  useEffect(() => {
    if (server !== 'queued' || !rideId) return;
    const t = setInterval(() => {
      void supabase.rpc('get_outbound_status', { p_ride_id: rideId }).then(({ data }) => {
        const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; user_id: string; template: string; status: string; created_at: string }>;
        const prior = priorSmsIds.current ?? new Set<string>();
        const mine = rows.filter(r => (r.template === 'sos_alert' || r.template === 'crash_alert')
          && r.user_id === latest.current.profile?.id && !prior.has(r.id));
        if (mine.some(r => r.status === 'sent')) { setServer('sent'); track('sos_state', { step: 'server', state: 'sent_by_sms' }); }
        else if (mine.length && mine.every(r => r.status === 'failed')) setServer('failed');
      });
    }, 5000);
    return () => clearInterval(t);
  }, [server, rideId]);

  const smsBody = useCallback(() => {
    const { position, profile, ride, riderName } = latest.current;
    const age = position ? (Date.now() - Date.parse(position.timestamp)) / 60000 : null;
    return formatEmergencySms({
      riderName,
      motorcycleModel: profile?.motorcycle_model,
      rideName: ride?.name || 'Ride',
      latitude: position?.lat ?? null,
      longitude: position?.lng ?? null,
      locationAgeMinutes: position && isStale(position.timestamp) ? age : null,
    });
  }, []);

  const openComposer = useCallback(async () => {
    if (!recipients.length) {
      setComposer('no_recipients');
      latest.current.onMissingContact();
      return;
    }
    const body = smsBody();
    const url = smsComposerUrl(recipients.map(r => r.phone), body, Platform.OS);
    try {
      if (await Linking.canOpenURL(url)) await Linking.openURL(url);
      else await Share.share({ message: body });
      setComposer('opened');
      track('sos_state', { step: 'texts', state: 'composer_opened', recipients: recipients.length });
    } catch {
      setComposer('unavailable');
    }
  }, [recipients, smsBody]);

  /** The pack alert and server SMS. Safe to call twice; the alert id is reused. */
  const alertPack = useCallback(async (type: 'emergency' | 'crash_detected' = 'emergency') => {
    const { sendAlert, online, serverSms } = latest.current;
    setStarted(true);
    alertIdRef.current ??= await newQueueId();
    const id = alertIdRef.current;
    const outcome = await sendAlert(type, type === 'crash_detected' ? 'No answer to the crash check.' : undefined, id);
    const state: PackState = outcome === 'sent' ? 'sent' : outcome === 'queued' ? 'queued' : 'failed';
    setPack(state);
    track('sos_state', { step: 'group', state: state === 'queued' ? 'waiting_for_signal' : state });
    if (outcome === 'sent' && online && serverSms) {
      setServer('pending');
      // Once per alert: a second call for the same alert reuses its texts.
      priorSmsIds.current ??= await sosSmsIds(latest.current.ride?.id);
      const { data, error } = await supabase.rpc('request_sos_sms', { p_alert_id: id });
      setServer(error ? 'failed' : (data as number) > 0 ? 'queued' : 'off');
    }
    return state;
  }, []);

  /** From the hold-to-confirm button: alert the pack, then show the next step. */
  const broadcastSosToGroup = useCallback(async () => {
    setSosModal(true);
    await alertPack('emergency');
  }, [alertPack]);

  /**
   * The crash countdown ran out: the rider may not be able to tap anything, so
   * the pack alert and the server SMS go now and the sheet stays open for a
   * bystander (Call 112, text contacts).
   */
  const escalateCrash = useCallback(async () => {
    setSosModal(true);
    await alertPack('crash_detected');
  }, [alertPack]);

  /** From the sheet: everything at once, including the composer. */
  const sendSos = useCallback(async () => {
    const packPromise = alertPack('emergency');
    await openComposer();
    await packPromise;
  }, [alertPack, openComposer]);

  const triggerSosWorkflow = useCallback(() => setSosModal(true), []);
  const closeSos = useCallback(() => {
    setSosModal(false);
    // A finished SOS resets so the next one starts clean.
    if (started) {
      setStarted(false); setPack('pending'); setComposer('pending'); setServer('off'); alertIdRef.current = null; priorSmsIds.current = null;
    }
  }, [started]);

  const dial = useCallback(async (number: string) => {
    try {
      await Linking.openURL('tel:' + number);
    } catch {
      latest.current.setMessage('Could not open the phone dialer.');
    }
  }, []);

  const steps = started ? sosSteps({ pack, composer, server, recipients }, t) : [];
  const primaryLabel = !started
    ? sosPrimaryLabel({ online: params.online, recipients: recipients.length }, t)
    : composer === 'opened' ? t('sos.open_messages_again') : recipients.length === 1 ? t('sos.text_person') : recipients.length ? t('sos.text_people', { count: recipients.length }) : t('sos.add_contact');

  return {
    sosModal, started, steps, recipients, primaryLabel,
    triggerSosWorkflow, closeSos, broadcastSosToGroup, sendSos, openComposer, escalateCrash,
    dialEmergencyContact: () => dial(latest.current.profile?.emergency_contact || '112'),
    dial112: () => dial('112'),
  };
}
