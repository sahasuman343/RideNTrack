import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { referralCountText, type ReferralSource } from '@ridentrack/shared';
import { useReferral } from '../hooks/useReferral';
import { useRideTheme, radius, spacing, type RidePalette } from '../theme';
import { Icon } from './ui';

/**
 * F17: one card for the recap and the profile. On a finished ride it leads
 * with the ride ("Share the ride"); on the profile with the code.
 */
export function InviteCard({ source, ride }: { source: Extract<ReferralSource, 'recap' | 'profile'>; ride?: { name?: string | null; distanceKm?: number | null } }) {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const referral = useReferral();
  if (!referral.enabled) return null;
  const recap = source === 'recap';
  return (
    <View style={s.card}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.kicker}>{recap ? 'SHARE THE RIDE' : 'INVITE RIDERS'}</Text>
        <Text style={s.title}>{recap ? 'Know someone who should ride with you next time?' : 'Bring your riding friends'}</Text>
        <Text style={s.meta}>
          {referral.code ? `Your code ${referral.code}. ` : ''}{referralCountText(referral.joined)}
        </Text>
      </View>
      <TouchableOpacity
        style={s.button}
        onPress={() => void referral.share(source, ride).catch(() => {})}
        accessibilityRole="button"
        accessibilityLabel={recap ? 'Share this ride with an invite link' : 'Share your invite link'}
      >
        <Icon name="share-social-outline" size="md" color={theme.onAccent} />
        <Text style={s.buttonText}>Share</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.lg },
  kicker: { color: c.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: c.text, fontSize: 16, fontWeight: '800', lineHeight: 21 },
  meta: { color: c.textMuted, fontSize: 12, lineHeight: 17 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: c.accent },
  buttonText: { color: c.onAccent, fontSize: 14, fontWeight: '800' },
});
