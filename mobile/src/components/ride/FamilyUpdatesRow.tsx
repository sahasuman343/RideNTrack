import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { familyUpdateSummary, type OutboundStatusRow } from '@ridentrack/shared';
import { Icon } from '../ui';
import { supabase } from '../../lib/supabase';
import { useFamilyContacts } from '../../hooks/useFamilyContacts';
import { useCaptainFlowStyles } from './captainFlowStyles';

/*
 * F2 on the ride screen: one line that says what your family was told, with
 * the shared status words, plus "Share link" and a pause switch. Refreshes
 * every minute while the ride is live.
 */

export function FamilyUpdatesRow({ rideId, live, onShareLink }: { rideId: string; live: boolean; onShareLink: () => void }) {
  const { cs, theme } = useCaptainFlowStyles();
  const family = useFamilyContacts();
  const [rows, setRows] = useState<OutboundStatusRow[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_outbound_status', { p_ride_id: rideId });
    if (!error && Array.isArray(data)) setRows(data as OutboundStatusRow[]);
  }, [rideId]);

  useEffect(() => {
    void load();
    if (!live) return;
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load, live]);

  const summary = useMemo(() => familyUpdateSummary(rows, family.contacts), [rows, family.contacts]);
  const color = summary.tone === 'failed' ? theme.danger : summary.tone === 'pending' ? theme.warning : summary.tone === 'ok' ? theme.green : theme.subtle;
  const paused = family.contacts.length > 0 && family.contacts.every(c => c.paused);

  return (
    <View style={[cs.card, { backgroundColor: theme.surface, gap: 10, marginTop: 8 }]} accessibilityRole="summary">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="home-outline" size="md" color={color} />
        <View style={{ flex: 1 }}>
          <Text style={cs.riderName}>{summary.headline}</Text>
          <Text style={cs.riderMeta}>{summary.detail}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity style={[cs.secondary, { flex: 1, minHeight: 48 }]} onPress={onShareLink} accessibilityRole="button">
          <Text style={cs.secondaryText}>Share live link</Text>
        </TouchableOpacity>
        {family.contacts.length > 0 ? (
          <TouchableOpacity
            style={[cs.secondary, { flex: 1, minHeight: 48, borderColor: paused ? theme.warning : theme.borderStrong }]}
            onPress={() => void family.setPaused(!paused).catch(() => {})}
            accessibilityRole="button"
          >
            <Text style={cs.secondaryText}>{paused ? 'Resume updates' : 'Pause updates'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}
