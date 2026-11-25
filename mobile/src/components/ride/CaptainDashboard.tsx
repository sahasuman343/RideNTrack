import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { Alert, LiveRideStats, PackRiderProgress } from '@ridentrack/shared';
import { Icon, SheetModal } from '../ui';
import type { RidePalette } from '../../theme';
import type { RideStyles } from './rideStyles';
import type { RideRegroupPoint } from '../../hooks/ride/useRegroupPoints';

export interface CaptainDashboardProps {
  s: RideStyles;
  theme: RidePalette;
  bottomInset: number;
  visible: boolean;
  onClose: () => void;
  busy: boolean;
  liveStats: LiveRideStats;
  packFormation: PackRiderProgress[];
  participantsCount: number;
  regroupPoints: RideRegroupPoint[];
  alerts: Alert[];
  acknowledgementMap: Record<string, { count: number; riders: string[] }>;
  hasActiveSpectatorLink: boolean;
  onPaceAdvisory: (kmh: number, label: string) => void;
  onCloseRegroup: (pointId: string) => void;
  onNewBroadcast: () => void;
  onShareFamilyLink: () => void;
  onRevokeFamilyLinks: () => void;
  onRoadsideHelp: () => void;
  /** Extra captain tools from later features (briefing, roll call, debrief). */
  children?: React.ReactNode;
}

const PACE_PRESETS: Array<[number, string, string]> = [
  [40, 'Curves / Ghats', '40 km/h (Ghats)'],
  [60, 'Cruising', '60 km/h (Cruising)'],
  [80, 'Highway', '80 km/h (Highway)'],
  [30, 'Wet Road / Rain', '30 km/h (Rain)'],
];

export function CaptainDashboard(props: CaptainDashboardProps) {
  const { s, theme, liveStats, packFormation, regroupPoints, alerts, acknowledgementMap } = props;
  const announcements = alerts.filter(a => a.type === 'announcement');
  return (
    <SheetModal visible={props.visible} onRequestClose={props.onClose}>
      <View style={[s.modal, { maxHeight: '88%', paddingBottom: Math.max(props.bottomInset, 24) }]}>
        <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={[s.heading, { color: theme.accent }]}>Captain&apos;s view</Text>
            <TouchableOpacity onPress={props.onClose} accessibilityLabel="Close dashboard">
              <Icon name="close" size="lg" color={theme.muted} />
            </TouchableOpacity>
          </View>
          <Text style={[s.muted, { marginBottom: 14 }]}>Lead controls, pack spacing overview, speed advisories, and regroup coordination.</Text>

          {props.children}

          <View style={s.statsCard}>
            <Text style={s.statsCardHeader}>PACK STATUS & SPREAD</Text>
            <View style={s.statsGrid}>
              <View style={s.statsGridItem}>
                <Text style={[s.statsValue, { color: theme.green }]}>{liveStats.packSummary.ridingCount}</Text>
                <Text style={s.statsLabel}>RIDING</Text>
              </View>
              <View style={s.statsGridItem}>
                <Text style={s.statsValue}>{liveStats.packSummary.stoppedCount}</Text>
                <Text style={s.statsLabel}>STOPPED</Text>
              </View>
              <View style={s.statsGridItem}>
                <Text style={[s.statsValue, packFormation.some(p => p.isSeparated) ? { color: theme.danger } : null]}>
                  {packFormation.filter(p => p.isSeparated).length}
                </Text>
                <Text style={s.statsLabel}>SEPARATED</Text>
              </View>
              <View style={s.statsGridItem}>
                <Text style={[s.statsValue, { color: theme.accent }]}>{liveStats.formatted.packSpread}</Text>
                <Text style={s.statsLabel}>SPREAD</Text>
              </View>
            </View>
          </View>

          <View style={s.statsCard}>
            <Text style={s.statsCardHeader}>BROADCAST PACE ADVISORY</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {PACE_PRESETS.map(([kmh, label, text]) => (
                <TouchableOpacity key={kmh} style={[s.paceButton, { minWidth: '45%' }]} onPress={() => props.onPaceAdvisory(kmh, label)}>
                  <Text style={s.paceButtonText}>{text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={s.statsCard}>
            <Text style={s.statsCardHeader}>REGROUP POINTS COORDINATION</Text>
            {regroupPoints.length === 0 ? (
              <Text style={s.muted}>No regroup points set for this ride. Add them in Trip Workspace.</Text>
            ) : (
              regroupPoints.map(point => {
                const isClosed = point.status === 'closed';
                return (
                  <View key={point.id} style={s.regroupActionItem}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={s.text}>#{point.sequence} {point.name}</Text>
                      <Text style={s.muted}>{isClosed ? 'Closed & completed' : `${point.total_arrived || 0}/${props.participantsCount} arrived`}</Text>
                    </View>
                    {isClosed ? (
                      <View style={s.acknowledgedBadge}>
                        <Text style={s.acknowledgedText}>Closed</Text>
                      </View>
                    ) : (
                      <TouchableOpacity style={s.regroupCloseBtn} disabled={props.busy} onPress={() => props.onCloseRegroup(point.id)}>
                        <Text style={s.regroupCloseBtnText}>Close</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </View>

          <View style={s.statsCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={s.statsCardHeader}>ANNOUNCEMENT ACKNOWLEDGEMENTS</Text>
              <TouchableOpacity style={{ backgroundColor: theme.accentSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }} onPress={props.onNewBroadcast}>
                <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '800' }}>+ New Broadcast</Text>
              </TouchableOpacity>
            </View>
            {announcements.length === 0 ? (
              <Text style={s.muted}>No announcements broadcast yet.</Text>
            ) : (
              announcements.slice(0, 5).map(alertItem => {
                const ack = acknowledgementMap[alertItem.id];
                return (
                  <View key={alertItem.id} style={{ backgroundColor: theme.surface, padding: 10, borderRadius: 8, marginBottom: 6, borderWidth: 1, borderColor: theme.border }}>
                    <Text style={[s.text, { fontSize: 13 }]}>&quot;{alertItem.message}&quot;</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <Text style={s.muted}>{new Date(alertItem.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                      <Text style={[s.statsValue, { fontSize: 12, color: theme.accent }]}>
                        {ack ? `${ack.count}/${props.participantsCount} acknowledged` : 'Checking...'}
                      </Text>
                    </View>
                    {ack && ack.riders.length > 0 && <Text style={[s.muted, { fontSize: 10, marginTop: 2 }]}>Acknowledged by {ack.riders.join(', ')}</Text>}
                  </View>
                );
              })
            )}
          </View>

          <TouchableOpacity style={[s.alertOption, { borderColor: theme.accent, borderWidth: 1, marginBottom: 12, justifyContent: 'center' }]} onPress={props.onShareFamilyLink}>
            <Icon name="share-social-outline" size="md" color={theme.accent} />
            <Text style={[s.text, { color: theme.accent }]}>Share live link with family (24 h)</Text>
          </TouchableOpacity>
          {props.hasActiveSpectatorLink && (
            <TouchableOpacity style={[s.alertOption, { borderColor: theme.danger, borderWidth: 1, marginBottom: 12, justifyContent: 'center' }]} onPress={props.onRevokeFamilyLinks}>
              <Icon name="close-circle-outline" size="md" color={theme.danger} />
              <Text style={[s.text, { color: theme.danger }]}>Turn off family links</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[s.alertOption, { borderColor: theme.accent, borderWidth: 1, marginBottom: 12, justifyContent: 'center' }]} onPress={props.onRoadsideHelp}>
            <Icon name="call-outline" size="md" color={theme.accent} />
            <Text style={[s.text, { color: theme.accent }]}>Find roadside help</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.secondary} onPress={props.onClose}>
            <Text style={s.text}>Close Dashboard</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </SheetModal>
  );
}
