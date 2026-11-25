import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Linking, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  captainRegistrationLine,
  formatInr,
  parseFeeInr,
  riderRegistrationState,
  type RegistrationSummary,
} from '@ridentrack/shared';
import { supabase } from '../../lib/supabase';
import { useFlag } from '../../hooks/useFeatureFlags';
import { useRideTheme, radius, spacing, type RidePalette } from '../../theme';
import { Button } from '../ui';

/**
 * F16 paid registration on the trip screen. Riders pay a captain-set fee
 * through a Razorpay payment link in the browser; the webhook marks it paid
 * and adds them to the ride. Captains set the fee and see what came in.
 */
export function RegistrationCard({ rideId, isCaptain, planned }: { rideId: string; isCaptain: boolean; planned: boolean }) {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const enabled = useFlag('paid_registrations');
  const [summary, setSummary] = useState<RegistrationSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [fee, setFee] = useState('');
  const [capacity, setCapacity] = useState('');
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc('get_ride_registration_summary', { p_ride_id: rideId });
    setSummary((data as RegistrationSummary | null) ?? null);
  }, [rideId]);
  useEffect(() => { if (enabled) void refresh(); }, [enabled, refresh]);
  // Coming back from the payment page: check again.
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', st => { if (st === 'active') void refresh(); });
    return () => sub.remove();
  }, [enabled, refresh]);

  if (!enabled || !summary) return null;
  const hasFee = summary.fee_paise != null;
  if (!hasFee && !(isCaptain && planned)) return null;

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('create-registration-payment', { body: { ride_id: rideId } });
      if (fnError) throw new Error((data as { error?: string } | null)?.error ?? 'Could not start the payment.');
      const result = data as { status: string; url?: string; error?: string };
      if (result.url) await Linking.openURL(result.url);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment.');
    } finally {
      setBusy(false);
    }
  };

  const saveFee = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const rupees = on ? parseFeeInr(fee) : null;
      if (on && rupees == null) throw new Error('Enter the fee in rupees, e.g. 1500.');
      const cap = capacity.trim() ? Number(capacity.trim()) : null;
      if (cap != null && !(Number.isInteger(cap) && cap >= 1 && cap <= 500)) throw new Error('Spots must be a whole number up to 500.');
      const { error: rpcError } = await supabase.rpc('set_ride_registration', { p_ride_id: rideId, p_fee_inr: rupees ?? 0, p_capacity: cap, p_note: note });
      if (rpcError) throw new Error(rpcError.message);
      setEditing(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  if (isCaptain) {
    return (
      <View style={s.card}>
        <View style={s.headRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.kicker}>REGISTRATION FEE</Text>
            <Text style={s.title}>{hasFee ? formatInr(summary.fee_paise) : 'Free ride'}</Text>
          </View>
          {planned && (
            <Switch
              value={hasFee || editing}
              onValueChange={on => (on ? setEditing(true) : void saveFee(false))}
              trackColor={{ false: theme.border, true: theme.accent }}
              thumbColor={theme.onAccent}
              accessibilityLabel="Charge a registration fee"
            />
          )}
        </View>
        {hasFee && !editing && <Text style={s.meta}>{captainRegistrationLine(summary)}</Text>}
        {editing && (
          <View style={{ gap: spacing.sm }}>
            <TextInput style={s.input} value={fee} onChangeText={setFee} placeholder="Fee per rider, ₹" placeholderTextColor={theme.subtle} keyboardType="decimal-pad" />
            <TextInput style={s.input} value={capacity} onChangeText={setCapacity} placeholder="Spots (optional)" placeholderTextColor={theme.subtle} keyboardType="number-pad" />
            <TextInput style={s.input} value={note} onChangeText={setNote} placeholder="What it covers, e.g. 2 nights' stay and a support jeep" placeholderTextColor={theme.subtle} maxLength={280} />
            <Text style={s.meta}>For real costs only: stay, fuel, support. Riders pay through Razorpay; it lands in RideNTrack&apos;s account and is paid out to you.</Text>
            <Button title="Save fee" loading={busy} onPress={() => void saveFee(true)} />
          </View>
        )}
        {error ? <Text style={[s.meta, { color: theme.danger }]}>{error}</Text> : null}
      </View>
    );
  }

  const state = riderRegistrationState(summary);
  return (
    <View style={[s.card, state.tone === 'ok' && { borderColor: theme.green }]}>
      <Text style={s.kicker}>REGISTRATION</Text>
      <Text style={s.meta}>{state.detail}</Text>
      {state.action && <Button title={state.action} loading={busy} onPress={() => void pay()} />}
      {error ? <Text style={[s.meta, { color: theme.danger }]}>{error}</Text> : null}
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  kicker: { color: c.subtle, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: c.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.3, marginTop: 2 },
  meta: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
  input: { minHeight: 48, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md, color: c.text, fontSize: 16 },
});
