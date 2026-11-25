import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PAYMENT_CONFIG } from '@ridentrack/shared';
import { useRideTheme, radius, spacing, typography } from '../../theme';
import { Icon } from './Icon';
import { useFlag } from '../../hooks/useFeatureFlags';
import { useAuth } from '../../hooks/useAuth';
import { track } from '../../services/analytics';
import {
  getBillingProvider,
  onBillingProviderChange,
  purchaseMessage,
  type BillingProduct,
} from '../../services/billing';

interface Props {
  visible: boolean;
  featureTitle: string;
  featureDescription: string;
  onClose: () => void;
  /** When set, the Expedition Pass option unlocks this trip. */
  rideId?: string;
}

export function UpgradePromptModal({
  visible,
  featureTitle,
  featureDescription,
  onClose,
  rideId,
}: Props) {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const storeBilling = useFlag('store_billing');
  const { user, reloadProfile } = useAuth();
  const [provider, setProvider] = useState(getBillingProvider);
  const [prices, setPrices] = useState<Partial<Record<BillingProduct, string>>>({});
  const [busy, setBusy] = useState<BillingProduct | 'restore' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const canBuy = storeBilling && !!provider && !!user;

  useEffect(() => onBillingProviderChange(() => setProvider(getBillingProvider())), []);

  useEffect(() => {
    if (!visible) { setNote(null); return; }
    track('paywall_viewed', { feature: featureTitle.slice(0, 40), can_buy: canBuy });
    if (!canBuy || !provider || !user) return;
    let cancelled = false;
    void provider.identify(user.id).then(() => provider.prices()).then(p => { if (!cancelled) setPrices(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [visible, canBuy, provider, user, featureTitle]);

  const buy = async (product: BillingProduct | 'restore') => {
    if (!provider || busy) return;
    setBusy(product);
    setNote(null);
    track('purchase_started', { product });
    try {
      const outcome = product === 'restore' ? await provider.restore() : await provider.purchase(product, { rideId });
      if (outcome.status === 'purchased') {
        track('purchase_completed', { product });
        await reloadProfile();
      }
      setNote(product === 'restore'
        ? outcome.status === 'purchased' ? 'Purchases restored.' : 'Nothing to restore on this store account.'
        : purchaseMessage(outcome, product));
    } finally {
      setBusy(null);
    }
  };

  const priceLabel = (product: BillingProduct, fallbackInr: number, suffix: string) =>
    `${prices[product] ?? `₹${fallbackInr}`}${suffix}`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={s.badgeRow}>
            <Icon name="ribbon" size="md" color={theme.accent} />
            <Text style={s.badgeText}>PRO TOURER · HOST UNLOCKS GROUP</Text>
          </View>
          <Text style={s.title}>{featureTitle}</Text>
          <Text style={s.body}>{featureDescription}</Text>

          <View style={s.perksBox}>
            <Text style={s.perk}>• Unlimited multi-day expeditions & up to 50 waypoints</Text>
            <Text style={s.perk}>• Up to 50 riders per pack (guests join free)</Text>
            <Text style={s.perk}>• Two-way GPX import/export, pack fuel & ghat advisories</Text>
            <Text style={s.perk}>• Live Family Spectator Link & unlimited ride archive</Text>
          </View>

          {canBuy ? (
            <View style={s.buyStack}>
              <TouchableOpacity
                style={s.primaryBtn}
                accessibilityRole="button"
                disabled={!!busy}
                onPress={() => void buy('pro_monthly')}
              >
                {busy === 'pro_monthly' ? <ActivityIndicator color={theme.onAccent} /> : (
                  <Text style={s.primaryBtnText}>Go Pro · {priceLabel('pro_monthly', PAYMENT_CONFIG.monthlyPlanPriceInr, '/mo')}</Text>
                )}
              </TouchableOpacity>
              <View style={s.secondaryRow}>
                <TouchableOpacity style={s.secondaryBtn} accessibilityRole="button" disabled={!!busy} onPress={() => void buy('pro_annual')}>
                  {busy === 'pro_annual' ? <ActivityIndicator color={theme.text} /> : (
                    <Text style={s.secondaryBtnText}>{priceLabel('pro_annual', PAYMENT_CONFIG.annualPlanPriceInr, '/yr')}</Text>
                  )}
                </TouchableOpacity>
                {rideId ? (
                  <TouchableOpacity style={s.secondaryBtn} accessibilityRole="button" disabled={!!busy} onPress={() => void buy('expedition_pass')}>
                    {busy === 'expedition_pass' ? <ActivityIndicator color={theme.text} /> : (
                      <Text style={s.secondaryBtnText}>This trip · {priceLabel('expedition_pass', PAYMENT_CONFIG.expeditionPassPriceInr, '')}</Text>
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>
              {note ? <Text style={s.note}>{note}</Text> : null}
              <View style={s.footerRow}>
                <TouchableOpacity accessibilityRole="button" onPress={() => void buy('restore')} disabled={!!busy}>
                  <Text style={s.linkText}>Restore purchases</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" onPress={onClose}>
                  <Text style={s.linkText}>Not now</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <Text style={s.priceNote}>
                Pro Tourer ₹{PAYMENT_CONFIG.monthlyPlanPriceInr}/mo or Expedition Pass ₹{PAYMENT_CONFIG.expeditionPassPriceInr}/trip.
                {storeBilling ? '' : ' In-app purchases open soon.'}
              </Text>
              <TouchableOpacity style={s.primaryBtn} onPress={onClose}>
                <Text style={s.primaryBtnText}>Got it</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(theme: ReturnType<typeof useRideTheme>) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: theme.scrim, justifyContent: 'center', padding: spacing.lg },
    card: {
      backgroundColor: theme.surface,
      borderRadius: radius.lg,
      padding: spacing.xl,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      gap: spacing.md,
    },
    badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    badgeText: { ...typography.labelCaps, color: theme.accent },
    title: { ...typography.headlineMd, color: theme.text },
    body: { ...typography.bodyMd, color: theme.textMuted },
    perksBox: {
      backgroundColor: theme.surfaceRaised,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.xs,
    },
    perk: { ...typography.bodySm, color: theme.text },
    priceNote: { ...typography.bodySm, color: theme.textMuted, textAlign: 'center' },
    primaryBtn: {
      minHeight: 48,
      borderRadius: radius.md,
      backgroundColor: theme.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryBtnText: { ...typography.titleMd, color: theme.onAccent },
    buyStack: { gap: spacing.sm },
    secondaryRow: { flexDirection: 'row', gap: spacing.sm },
    secondaryBtn: {
      flex: 1,
      minHeight: 48,
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderColor: theme.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
    },
    secondaryBtnText: { ...typography.bodySm, color: theme.text, fontWeight: '800' },
    note: { ...typography.bodySm, color: theme.textMuted, textAlign: 'center' },
    footerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.xs },
    linkText: { ...typography.bodySm, color: theme.accent, fontWeight: '700', paddingVertical: spacing.sm },
  });
}
