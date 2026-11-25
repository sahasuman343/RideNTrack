import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  READINESS_SHORT_LABELS,
  type ReadinessItem,
  type ReadinessItemId,
  type ReadinessSummary,
} from '@ridentrack/shared';
import { supabase } from '../../lib/supabase';
import { useRideTheme, radius, spacing, type RidePalette } from '../../theme';
import { Icon } from '../ui';
import { track } from '../../services/analytics';

/*
 * One card that says whether this rider is ready for this trip, and fixes
 * each missing thing with one tap. Missing items come first; finished ones
 * fold into a single line so the card stays short once you are ready.
 */

export interface RideReadyCardProps {
  items: ReadinessItem[];
  summary: ReadinessSummary;
  onFix: (item: ReadinessItem) => void;
  /** Extra line under the header, e.g. the battery estimate from F4. */
  footnote?: string | null;
}

export function RideReadyCard({ items, summary, onFix, footnote }: RideReadyCardProps) {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const missing = items.filter(i => i.status === 'missing' || i.status === 'unknown');
  const done = items.filter(i => i.status === 'ok');
  const counted = items.filter(i => i.status !== 'skipped');

  useEffect(() => {
    track('ready_check_viewed', { ready: summary.ready, missing: summary.essentialMissing + summary.recommendedMissing });
  }, [summary.ready, summary.essentialMissing, summary.recommendedMissing]);

  return (
    <View style={[s.card, summary.ready ? s.cardReady : s.cardPending]} accessibilityRole="summary">
      <View style={s.header}>
        <View style={[s.badge, { backgroundColor: summary.ready ? theme.greenSoft : theme.warningSoft }]}>
          <Icon name={summary.ready ? 'shield-checkmark' : 'shield-half-outline'} size="lg" color={summary.ready ? theme.green : theme.warning} />
        </View>
        <View style={s.headerText}>
          <Text style={s.kicker}>RIDE READY CHECK</Text>
          <Text style={s.headline}>{summary.headline}</Text>
        </View>
      </View>

      <View style={s.track} accessibilityLabel={`${summary.done} of ${summary.total} done`}>
        {counted.map(item => (
          <View
            key={item.id}
            style={[
              s.segment,
              { backgroundColor: item.status === 'ok' ? theme.green : item.essential ? theme.warning : theme.borderStrong },
              item.status !== 'ok' && { opacity: item.essential ? 0.9 : 0.5 },
            ]}
          />
        ))}
      </View>
      {footnote ? <Text style={s.footnote}>{footnote}</Text> : null}

      {missing.map(item => (
        <View key={item.id} style={s.row}>
          <View style={[s.dot, { backgroundColor: item.essential ? theme.warning : theme.subtle }]} />
          <View style={s.rowText}>
            <Text style={s.rowTitle}>{item.title}{item.status === 'unknown' ? ' (check)' : ''}</Text>
            <Text style={s.rowWhy}>{item.detail || item.why}</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${item.fixLabel}: ${item.title}`}
            style={[s.fix, item.essential ? { backgroundColor: theme.accent, borderColor: theme.accent } : null]}
            onPress={() => onFix(item)}
          >
            <Text style={[s.fixText, item.essential ? { color: theme.onAccent } : null]}>{item.fixLabel}</Text>
          </TouchableOpacity>
        </View>
      ))}

      {done.length > 0 && (
        <View style={s.doneRow}>
          <Icon name="checkmark-circle" size="sm" color={theme.green} />
          <Text style={s.doneText}>{done.map(i => READINESS_SHORT_LABELS[i.id]).join(' · ')}</Text>
        </View>
      )}
    </View>
  );
}

interface RosterRider { user_id: string; display_name: string }

/** Captain's view of who is ready. Riders who never opened the trip show as "Not checked". */
export function PackReadinessList({ rideId, roster }: { rideId: string; roster: RosterRider[] }) {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [rows, setRows] = useState<Record<string, { missing: ReadinessItemId[]; ready: boolean }>>({});

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc('get_ride_readiness', { p_ride_id: rideId }).then(({ data }) => {
      if (cancelled || !Array.isArray(data)) return;
      setRows(Object.fromEntries((data as Array<{ user_id: string; missing: ReadinessItemId[]; ready: boolean }>).map(r => [r.user_id, r])));
    });
    return () => { cancelled = true; };
  }, [rideId, roster.length]);

  const readyCount = roster.filter(r => rows[r.user_id]?.ready).length;
  return (
    <View style={[s.card, s.cardPlain]}>
      <Text style={s.kicker}>PACK READINESS</Text>
      <Text style={s.headline}>{readyCount} of {roster.length} ready</Text>
      {roster.map(rider => {
        const row = rows[rider.user_id];
        const label = !row ? 'Not checked yet' : row.ready
          ? row.missing.length ? `Ready · ${row.missing.map(m => READINESS_SHORT_LABELS[m] ?? m).join(', ')} suggested` : 'Ready'
          : `Missing ${row.missing.map(m => READINESS_SHORT_LABELS[m] ?? m).join(', ')}`;
        return (
          <View key={rider.user_id} style={s.packRow}>
            <Icon
              name={!row ? 'ellipse-outline' : row.ready ? 'checkmark-circle' : 'alert-circle'}
              size="md"
              color={!row ? theme.subtle : row.ready ? theme.green : theme.warning}
            />
            <Text style={s.packName} numberOfLines={1}>{rider.display_name}</Text>
            <Text style={s.packState}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: c.surface,
  },
  cardReady: { borderColor: c.green + '66' },
  cardPending: { borderColor: c.warning + '88', borderLeftWidth: 4 },
  cardPlain: { borderColor: c.border },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  kicker: { color: c.subtle, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  headline: { color: c.text, fontSize: 18, fontWeight: '800', lineHeight: 24, letterSpacing: -0.2 },
  track: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 6, borderRadius: 3 },
  footnote: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { color: c.text, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  rowWhy: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
  fix: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center' },
  fixText: { color: c.text, fontSize: 13, fontWeight: '800' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  doneText: { color: c.textMuted, fontSize: 13, fontWeight: '600', flexShrink: 1, lineHeight: 18 },
  packRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  packName: { color: c.text, fontSize: 14, fontWeight: '700', width: '35%' },
  packState: { color: c.textMuted, fontSize: 13, flex: 1, lineHeight: 18 },
});
