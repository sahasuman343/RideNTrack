import React, { useState } from 'react';
import { Linking, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  ALERT_LABELS,
  MECHANICAL_ISSUE_LABELS,
  NATIONAL_EMERGENCY_HELPLINES,
  type AlertType,
  type LiveRideStats,
  type MechanicalIssueType,
  type VerifiedBreakdownService,
} from '@ridentrack/shared';
import { Icon, SheetModal } from '../ui';
import { ALERT_ICONS, MECHANICAL_ICONS, plainLabel } from '../../icons';
import type { RidePalette } from '../../theme';
import type { RideStyles } from './rideStyles';

interface BaseSheetProps {
  s: RideStyles;
  theme: RidePalette;
  bottomInset: number;
  visible: boolean;
  onClose: () => void;
}

export function AlertPickerSheet(props: BaseSheetProps & {
  busy: boolean;
  isCaptain: boolean;
  onAnnouncement: () => void;
  onMechanical: () => void;
  onSos: () => void;
  onAlert: (type: AlertType) => void;
  onRoadsideHelp: () => void;
}) {
  const { s, theme, busy } = props;
  return (
    <SheetModal visible={props.visible} onRequestClose={props.onClose}>
      <View style={[s.modal, { paddingBottom: Math.max(props.bottomInset, 24) }]}>
        <Text style={s.heading}>Let your group know</Text>
        <Text style={s.muted}>Your location is attached. Offline alerts are delivered after reconnecting.</Text>
        {props.isCaptain && (
          <TouchableOpacity
            style={[s.alertOption, { backgroundColor: theme.accentSoft, borderColor: theme.accent, borderWidth: 1 }]}
            disabled={busy}
            onPress={props.onAnnouncement}
          >
            <Icon name="megaphone-outline" size="md" color={theme.accent} />
            <Text style={[s.text, { color: theme.accent }]}>Captain Announcement…</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.alertOption, { backgroundColor: theme.surfaceRaised, borderColor: theme.warning, borderWidth: 1 }]}
          disabled={busy}
          onPress={props.onMechanical}
        >
          <Icon name="construct-outline" size="md" color={theme.warning} />
          <Text style={[s.text, { color: theme.warning }]}>Mechanical Breakdown…</Text>
        </TouchableOpacity>
        {(Object.keys(ALERT_LABELS) as AlertType[])
          .filter(t => t !== 'announcement' && t !== 'mechanical')
          .map(type => (
            <TouchableOpacity
              key={type}
              style={[s.alertOption, type === 'emergency' && s.emergency]}
              disabled={busy}
              onPress={() => (type === 'emergency' ? props.onSos() : props.onAlert(type))}
            >
              <Icon name={ALERT_ICONS[type]} size="md" color={type === 'emergency' ? theme.danger : theme.textMuted} />
              <Text style={s.text}>{plainLabel(ALERT_LABELS[type])}</Text>
            </TouchableOpacity>
          ))}
        <TouchableOpacity style={[s.alertOption, { borderColor: theme.border, borderWidth: 1 }]} onPress={props.onRoadsideHelp}>
          <Icon name="call-outline" size="md" color={theme.textMuted} />
          <Text style={s.text}>Roadside help (1033 / RSA)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.secondary} onPress={props.onClose}>
          <Text style={s.text}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </SheetModal>
  );
}

export const ANNOUNCEMENT_PRESETS = [
  'Fuel stop at next pump (~5km)',
  'Chai & stretch break ahead',
  'Wet roads / rain ahead — reduce speed',
  'Road hazard / debris observed',
  'Regroup at next junction',
  'Pull over safely now',
];

export function AnnouncementSheet(props: BaseSheetProps & {
  busy: boolean;
  message: string | null;
  customAnnouncement: string;
  setCustomAnnouncement: (v: string) => void;
  onBroadcast: (msg: string) => void;
}) {
  const { s, theme, busy } = props;
  return (
    <SheetModal visible={props.visible} onRequestClose={props.onClose}>
      <View style={[s.modal, { paddingBottom: Math.max(props.bottomInset, 24) }]}>
        <Text style={[s.heading, { color: theme.accent }]}>Announcement</Text>
        {props.message && <Text style={s.warningText}>{props.message}</Text>}
        <Text style={s.muted}>Broadcast a quick directive or sticky status alert to all riders&apos; heads-up display.</Text>
        <View style={{ gap: 8, marginVertical: 4 }}>
          {ANNOUNCEMENT_PRESETS.map(preset => (
            <TouchableOpacity key={preset} style={s.presetOption} disabled={busy} onPress={() => props.onBroadcast(preset)}>
              <Text style={s.presetText}>{preset}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <TextInput
            style={s.announcementInput}
            placeholder="Or type custom announcement..."
            placeholderTextColor={theme.muted}
            value={props.customAnnouncement}
            onChangeText={props.setCustomAnnouncement}
            maxLength={120}
          />
          <TouchableOpacity
            style={[s.sendAnnouncementBtn, !props.customAnnouncement.trim() && s.disabled]}
            disabled={busy || !props.customAnnouncement.trim()}
            onPress={() => props.onBroadcast(props.customAnnouncement)}
          >
            <Text style={s.sendAnnouncementText}>Send</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={s.secondary} onPress={props.onClose}>
          <Text style={s.text}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </SheetModal>
  );
}

export function RideStatsSheet(props: BaseSheetProps & {
  liveStats: LiveRideStats;
  batterySentence?: string | null;
}) {
  const { s, theme, liveStats } = props;
  return (
    <SheetModal visible={props.visible} onRequestClose={props.onClose}>
      <View style={[s.modal, { maxHeight: '85%', paddingBottom: Math.max(props.bottomInset, 24) }]}>
        <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={s.heading}>Ride stats</Text>
            <TouchableOpacity onPress={props.onClose} accessibilityLabel="Close statistics">
              <Icon name="close" size="lg" color={theme.muted} />
            </TouchableOpacity>
          </View>
          <Text style={[s.muted, { marginBottom: 14 }]}>Real-time speed, pace, moving time, and pack spread statistics.</Text>

          <View style={s.statsCard}>
            <Text style={s.statsCardHeader}>TIME & DURATION</Text>
            <View style={s.statsGrid}>
              <Stat s={s} value={liveStats.formatted.elapsedTime} label="ELAPSED" />
              <Stat s={s} value={liveStats.formatted.movingTime} label="MOVING TIME" color={theme.green} />
              <Stat s={s} value={liveStats.formatted.stoppedTime} label="STOPPED" />
            </View>
          </View>

          <View style={s.statsCard}>
            <Text style={s.statsCardHeader}>SPEED & DISTANCE</Text>
            <View style={s.statsGrid}>
              <Stat s={s} value={liveStats.formatted.currentSpeed} label="CURRENT" />
              <Stat s={s} value={liveStats.formatted.avgSpeed} label="AVG MOVING" color={theme.accent} />
              <Stat s={s} value={liveStats.formatted.maxSpeed} label="TOP SPEED" />
            </View>
            <View style={[s.statsGrid, { marginTop: 10 }]}>
              <Stat s={s} value={liveStats.formatted.distance} label="RECORDED TRAIL" />
              <Stat s={s} value={liveStats.formatted.altitude} label="ALTITUDE" />
              <Stat s={s} value={`${liveStats.elevationGainMeters} m`} label="ASCENT GAIN" />
            </View>
          </View>

          <View style={s.statsCard}>
            <Text style={s.statsCardHeader}>PACK FORMATION & TELEMETRY</Text>
            <View style={s.statsGrid}>
              <Stat s={s} value={liveStats.formatted.packSpread} label="LEAD-TO-SWEEP SPREAD" color={theme.accent} />
              <Stat s={s} value={String(liveStats.packSummary.ridingCount)} label="RIDING NOW" />
              <Stat s={s} value={String(liveStats.packSummary.stoppedCount)} label="STOPPED" />
            </View>
          </View>

          {props.batterySentence ? (
            <View style={s.statsCard}>
              <Text style={[s.statsCardHeader, { marginBottom: 2 }]}>BATTERY</Text>
              <Text style={s.muted}>{props.batterySentence}</Text>
            </View>
          ) : null}

          <TouchableOpacity style={s.secondary} onPress={props.onClose}>
            <Text style={s.text}>Close Statistics</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </SheetModal>
  );
}

function Stat({ s, value, label, color }: { s: RideStyles; value: string; label: string; color?: string }) {
  return (
    <View style={s.statsGridItem}>
      <Text style={[s.statsValue, color ? { color } : null]}>{value}</Text>
      <Text style={s.statsLabel}>{label}</Text>
    </View>
  );
}

export function MechanicalSheet(props: BaseSheetProps & {
  busy: boolean;
  onSend: (issue: MechanicalIssueType, details: string) => Promise<boolean>;
  onDirectory: () => void;
}) {
  const { s, theme, busy } = props;
  const [selectedMechanicalIssue, setSelectedMechanicalIssue] = useState<MechanicalIssueType>('puncture');
  const [mechanicalDetails, setMechanicalDetails] = useState('');
  async function sendMechanicalBreakdownAlert() {
    if (await props.onSend(selectedMechanicalIssue, mechanicalDetails)) setMechanicalDetails('');
  }
  return (
    <SheetModal visible={props.visible} onRequestClose={props.onClose}>
      <View style={[s.modal, { maxHeight: '85%', paddingBottom: Math.max(props.bottomInset, 24) }]}>
        <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={[s.heading, { color: theme.warning }]}>Report a breakdown</Text>
            <TouchableOpacity onPress={props.onClose} accessibilityLabel="Close">
              <Icon name="close" size="lg" color={theme.muted} />
            </TouchableOpacity>
          </View>
          <Text style={[s.muted, { marginBottom: 14 }]}>Notify your pack of bike issues and attach your exact live location so sweep and teammates can assist.</Text>

          <Text style={[s.statsCardHeader, { marginBottom: 8 }]}>SELECT ISSUE TYPE</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {(Object.keys(MECHANICAL_ISSUE_LABELS) as MechanicalIssueType[]).map(issue => (
              <TouchableOpacity
                key={issue}
                style={[s.issueChip, selectedMechanicalIssue === issue && s.issueChipSelected]}
                onPress={() => setSelectedMechanicalIssue(issue)}
              >
                <Icon name={MECHANICAL_ICONS[issue]} size="sm" color={selectedMechanicalIssue === issue ? theme.accent : theme.textMuted} />
                <Text style={[s.issueChipText, selectedMechanicalIssue === issue && s.issueChipTextSelected]}>{MECHANICAL_ISSUE_LABELS[issue].label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[s.statsCardHeader, { marginBottom: 6 }]}>ADDITIONAL DETAILS (OPTIONAL)</Text>
          <TextInput
            style={[s.announcementInput, { marginBottom: 14, minHeight: 44 }]}
            placeholder="e.g. Rear tire flat, need pump or patch kit..."
            placeholderTextColor={theme.muted}
            value={mechanicalDetails}
            onChangeText={setMechanicalDetails}
            maxLength={140}
          />

          <TouchableOpacity style={[s.primary, { backgroundColor: theme.warningSoft, borderWidth: 1, borderColor: theme.warning, marginBottom: 10 }]} disabled={busy} onPress={() => void sendMechanicalBreakdownAlert()}>
            <Text style={[s.buttonText, { color: theme.warning, fontWeight: '800' }]}>Send breakdown alert</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.alertOption, { borderColor: theme.border, borderWidth: 1, marginBottom: 10, justifyContent: 'center' }]} onPress={props.onDirectory}>
            <Icon name="call-outline" size="md" color={theme.textMuted} />
            <Text style={s.text}>Roadside assistance numbers</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.secondary} onPress={props.onClose}>
            <Text style={s.text}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </SheetModal>
  );
}

export function BreakdownDirectorySheet(props: BaseSheetProps & { services: VerifiedBreakdownService[] }) {
  const { s, theme } = props;
  return (
    <SheetModal visible={props.visible} onRequestClose={props.onClose}>
      <View style={[s.modal, { maxHeight: '88%', paddingBottom: Math.max(props.bottomInset, 24) }]}>
        <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={[s.heading, { color: theme.accent }]}>Roadside help</Text>
            <TouchableOpacity onPress={props.onClose} accessibilityLabel="Close directory">
              <Icon name="close" size="lg" color={theme.muted} />
            </TouchableOpacity>
          </View>
          <Text style={[s.muted, { marginBottom: 14 }]}>24x7 verified highway helplines, motorcycle roadside recovery, and emergency towing.</Text>

          <Text style={s.statsCardHeader}>24X7 NATIONAL HELPLINES</Text>
          {NATIONAL_EMERGENCY_HELPLINES.map(helpline => (
            <View key={helpline.number} style={s.directoryCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={s.directoryName}>{helpline.name}</Text>
                  <Text style={s.directoryCoverage}>{helpline.purpose}</Text>
                </View>
                <TouchableOpacity style={s.callButton} onPress={() => void Linking.openURL('tel:' + helpline.number)}>
                  <Icon name="call" size="xs" color={theme.onAccent} />
                  <Text style={s.callButtonText}>{helpline.number}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <Text style={[s.statsCardHeader, { marginTop: 10 }]}>MOTORCYCLE RSA & TOWING SERVICES</Text>
          {props.services.map((service, idx) => (
            <View key={service.id || idx} style={s.directoryCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={s.directoryName}>{service.name}</Text>
                  <Text style={s.directoryCoverage}>{service.region} · {service.category}</Text>
                  {(service.notes || service.description) && <Text style={s.directoryPhone}>{service.notes || service.description}</Text>}
                </View>
                <TouchableOpacity style={s.callButton} onPress={() => void Linking.openURL('tel:' + service.phone)}>
                  <Icon name="call" size="xs" color={theme.onAccent} />
                  <Text style={s.callButtonText}>Call</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <TouchableOpacity style={[s.secondary, { marginTop: 8 }]} onPress={props.onClose}>
            <Text style={s.text}>Close Directory</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </SheetModal>
  );
}
