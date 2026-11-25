import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { FuelGapReport, RouteAdvisory, TouringRoute } from '@ridentrack/shared';
import { useRideTheme, radius, spacing, type RidePalette } from '../../theme';
import { Icon } from '../ui';

/*
 * F10: fuel and permits for this trip. The fuel ladder reads top to bottom
 * like the road: each station with its kilometre mark, and the stretch to
 * the next one drawn as a bar that turns amber when long and red when the
 * pack cannot make it on one tank.
 */

type TripAdvisory = RouteAdvisory & { inSeason: boolean; sentence: string };

export interface TouringKnowledgeCardProps {
  route: TouringRoute | null;
  fuel: FuelGapReport | null;
  advisories: TripAdvisory[];
  packSafeRangeKm: number | null;
}

const ADVISORY_ICON: Record<RouteAdvisory['kind'], string> = {
  permit: 'document-text-outline',
  pass_window: 'snow-outline',
  closure: 'close-circle-outline',
  info: 'information-circle-outline',
};

export function TouringKnowledgeCard({ route, fuel, advisories, packSafeRangeKm }: TouringKnowledgeCardProps) {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [expanded, setExpanded] = useState(false);
  if (!fuel?.stops.length && !advisories.length) return null;

  const stretches = fuel?.stretches ?? [];
  const worst = fuel?.gaps.length ? 'gap' : stretches.some(x => x.long) ? 'long' : 'ok';
  const shown = expanded ? stretches : stretches.filter(x => x.long || x.exceedsRange).slice(0, 3);
  const headline = worst === 'gap'
    ? `${fuel!.gaps.length} stretch${fuel!.gaps.length === 1 ? '' : 'es'} longer than your pack's range`
    : worst === 'long' ? 'Long stretches without fuel ahead' : 'Fuel every few hours on this route';

  return (
    <View style={[s.card, worst === 'gap' ? { borderColor: theme.danger + '88', borderLeftWidth: 4 } : worst === 'long' ? { borderColor: theme.warning + '88', borderLeftWidth: 4 } : null]}>
      <View style={s.header}>
        <View style={[s.badge, { backgroundColor: worst === 'gap' ? theme.dangerSoft : worst === 'long' ? theme.warningSoft : theme.greenSoft }]}>
          <Icon name="speedometer-outline" size="lg" color={worst === 'gap' ? theme.danger : worst === 'long' ? theme.warning : theme.green} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={s.kicker}>{route ? route.name.toUpperCase() : 'FUEL AND PERMITS'}</Text>
          <Text style={s.headline}>{headline}</Text>
          {packSafeRangeKm ? <Text style={s.sub}>Pack range on one tank: {Math.round(packSafeRangeKm)} km</Text> : <Text style={s.sub}>Add bike details to check the pack's range.</Text>}
        </View>
      </View>

      {shown.length > 0 && (
        <View style={s.ladder}>
          {shown.map(x => {
            const tone = x.exceedsRange ? theme.danger : x.long ? theme.warning : theme.green;
            return (
              <View key={`${x.fromKm}-${x.toKm}`} style={s.rung}>
                <View style={s.rail}>
                  <View style={[s.dot, { borderColor: tone }]} />
                  <View style={[s.bar, { backgroundColor: tone, height: Math.max(22, Math.min(64, x.lengthKm / 4)) }]} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={s.station} numberOfLines={1}>
                    <Text style={s.km}>{Math.round(x.fromKm)} km  </Text>
                    {x.from ? x.from.poi.name : 'Start, full tanks'}
                  </Text>
                  <Text style={[s.stretch, { color: tone }]}>
                    {Math.round(x.lengthKm)} km to {x.to ? x.to.poi.name : 'the end'}
                    {x.exceedsRange ? ' · carry extra fuel' : x.long ? ' · fill up here' : ''}
                  </Text>
                  {x.from && !x.from.poi.verified_at && <Text style={s.unverified}>Not verified this season</Text>}
                </View>
              </View>
            );
          })}
          {stretches.length > shown.length || expanded ? (
            <TouchableOpacity onPress={() => setExpanded(v => !v)} style={s.more} accessibilityRole="button">
              <Text style={s.moreText}>{expanded ? 'Show only long stretches' : `Show all ${fuel!.stops.length} fuel stops`}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {advisories.map(a => (
        <View key={a.id} style={s.advisory}>
          <Icon name={ADVISORY_ICON[a.kind] as never} size="sm" color={a.kind === 'pass_window' && !a.inSeason ? theme.danger : theme.textMuted} />
          <Text style={s.advisoryText}>{a.sentence}</Text>
        </View>
      ))}
      <Text style={s.footer}>Community-curated. Confirm locally before you rely on it.</Text>
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.lg, gap: spacing.md, marginBottom: spacing.md, backgroundColor: c.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: c.subtle, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  headline: { color: c.text, fontSize: 17, fontWeight: '800', lineHeight: 23, letterSpacing: -0.2 },
  sub: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
  ladder: { gap: 0, paddingLeft: 2 },
  rung: { flexDirection: 'row', gap: spacing.md },
  rail: { width: 14, alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 3, backgroundColor: c.surface, marginTop: 3 },
  bar: { width: 3, borderRadius: 2, marginVertical: 2, opacity: 0.85 },
  station: { color: c.text, fontSize: 15, fontWeight: '700' },
  km: { color: c.subtle, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  stretch: { fontSize: 13, fontWeight: '700' },
  unverified: { color: c.subtle, fontSize: 11, fontStyle: 'italic' },
  more: { paddingVertical: spacing.sm, minHeight: 44, justifyContent: 'center' },
  moreText: { color: c.accent, fontSize: 14, fontWeight: '700' },
  advisory: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  advisoryText: { flex: 1, color: c.text, fontSize: 14, lineHeight: 20 },
  footer: { color: c.subtle, fontSize: 11 },
});
