import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useFlag } from '../../hooks/useFeatureFlags';
import { getBillingProvider, onBillingProviderChange, purchaseMessage, type BillingProduct } from '../../services/billing';
import { useRideTheme, radius, spacing, type RidePalette } from '../../theme';
import { Button } from '../ui';

/**
 * F16 club plan: bought in the app through the stores (it is a digital
 * feature), it gives every club ride Pro. Shown to club owners and admins.
 */
export function ClubPlanCard({ clubId, canBuy }: { clubId: string; canBuy: boolean }) {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const planFlag = useFlag('club_plan');
  const billingFlag = useFlag('store_billing');
  const enabled = planFlag && billingFlag;
  const [plan, setPlan] = useState<{ status: string; expires_at: string | null } | null>(null);
  const [prices, setPrices] = useState<Partial<Record<BillingProduct, string>>>({});
  const [provider, setProvider] = useState(getBillingProvider());
  const [busy, setBusy] = useState<BillingProduct | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('club_subscriptions').select('status,expires_at').eq('club_id', clubId).maybeSingle();
    setPlan(data ?? null);
  }, [clubId]);
  useEffect(() => { if (enabled) void refresh(); }, [enabled, refresh]);
  useEffect(() => onBillingProviderChange(() => setProvider(getBillingProvider())), []);
  useEffect(() => { void provider?.prices().then(setPrices).catch(() => {}); }, [provider]);

  if (!enabled) return null;
  const active = plan?.status === 'active' && (!plan.expires_at || Date.parse(plan.expires_at) > Date.now());
  const until = plan?.expires_at ? new Date(plan.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  const buy = async (product: BillingProduct) => {
    if (!provider) return;
    setBusy(product);
    setMessage(null);
    try {
      const outcome = await provider.purchase(product, { clubId });
      setMessage(purchaseMessage(outcome, product));
      setTimeout(() => void refresh(), 4000);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[s.card, active && { borderColor: theme.green }]}>
      <Text style={s.kicker}>CLUB PLAN</Text>
      <Text style={s.title}>{active ? 'Every club ride has Pro' : 'Pro for every club ride'}</Text>
      <Text style={s.meta}>
        {active
          ? `Spectator links, longer history and the rest of Pro on all club rides${until ? `, renewing ${until}` : ''}. Manage it in your store account.`
          : 'One plan for the club instead of each captain buying Pro. Members ride free as always.'}
      </Text>
      {!active && canBuy && provider && (
        <View style={s.row}>
          <Button style={{ flex: 1 }} title={prices.club_monthly ? `${prices.club_monthly} / month` : 'Monthly'} variant="outline" loading={busy === 'club_monthly'} onPress={() => void buy('club_monthly')} />
          <Button style={{ flex: 1 }} title={prices.club_annual ? `${prices.club_annual} / year` : 'Yearly'} loading={busy === 'club_annual'} onPress={() => void buy('club_annual')} />
        </View>
      )}
      {!active && canBuy && !provider && <Text style={s.meta}>Buying is not available in this build yet.</Text>}
      {message ? <Text style={s.meta}>{message}</Text> : null}
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  kicker: { color: c.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: c.text, fontSize: 18, fontWeight: '800' },
  meta: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
