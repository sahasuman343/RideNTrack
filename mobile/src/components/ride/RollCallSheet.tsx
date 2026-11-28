import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { START_ANYWAY_REASONS, canStartRide, type RollCallRider, type RollCallSummary } from '@ridentrack/shared';
import { Icon, SheetModal } from '../ui';
import { useCaptainFlowStyles } from './captainFlowStyles';
import { StartNeedsReasonError } from '../../hooks/ride/useCaptainFlow';

/*
 * F1 automatic roll call. Riders near the meetup check in by themselves; the
 * captain sees only who is still missing, taps Here or Absent, and starts.
 * "Start anyway" is always visible and asks for a one-tap reason.
 */

export interface RollCallSheetProps {
  visible: boolean;
  onClose: () => void;
  bottomInset: number;
  summary: RollCallSummary;
  onSetStatus: (riderId: string, status: 'checked_in' | 'absent' | 'confirmed') => Promise<void>;
  onStart: (reason?: string) => Promise<unknown>;
}

export function RollCallSheet(props: RollCallSheetProps) {
  const { cs, theme } = useCaptainFlowStyles();
  const { summary } = props;
  const gate = canStartRide(summary);
  const [askReason, setAskReason] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = summary.checkedIn.length + summary.waiting.length;

  const start = async (reason?: string) => {
    setBusy(true);
    setError(null);
    try {
      await props.onStart(reason);
      setAskReason(false);
      props.onClose();
    } catch (e) {
      if (e instanceof StartNeedsReasonError) setAskReason(true);
      else setError(e instanceof Error ? e.message : 'Could not start the ride.');
    } finally {
      setBusy(false);
    }
  };

  const mark = (rider: RollCallRider, status: 'checked_in' | 'absent' | 'confirmed') => {
    void props.onSetStatus(rider.userId, status).catch(e => setError(e instanceof Error ? e.message : 'Could not update.'));
  };

  return (
    <SheetModal visible={props.visible} onRequestClose={props.onClose}>
      <View style={[cs.sheet, { paddingBottom: Math.max(props.bottomInset, 24) }]}>
        <View style={cs.grabber} />
        <Text style={cs.step}>STEP 2 OF 3 · ROLL CALL</Text>
        <Text style={cs.headline} accessibilityLiveRegion="polite">{summary.headline}</Text>
        <View style={cs.meter} accessibilityElementsHidden>
          {summary.checkedIn.map(r => <View key={r.userId} style={[cs.meterSeg, { backgroundColor: theme.green }]} />)}
          {summary.waiting.map(r => <View key={r.userId} style={[cs.meterSeg, { backgroundColor: theme.warning, opacity: 0.5 }]} />)}
          {total === 0 ? <View style={[cs.meterSeg, { backgroundColor: theme.green }]} /> : null}
        </View>
        {summary.byLocation > 0 ? (
          <Text style={cs.lede}>{summary.byLocation} checked in by location near the meetup. Tap a name to correct it.</Text>
        ) : (
          <Text style={cs.lede}>Riders within 200 m of the meetup check in by themselves.</Text>
        )}

        <ScrollView style={{ maxHeight: 340 }}>
          {summary.waiting.map(rider => (
            <View key={rider.userId} style={cs.riderRow}>
              <Icon name="ellipse-outline" size="md" color={theme.warning} />
              <Text style={cs.riderName} numberOfLines={1}>{rider.name}</Text>
              <TouchableOpacity style={[cs.pill, { borderColor: theme.green }]} onPress={() => mark(rider, 'checked_in')} accessibilityLabel={`Mark ${rider.name} here`}>
                <Text style={[cs.pillText, { color: theme.green }]}>Here</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[cs.pill, { borderColor: theme.borderStrong }]} onPress={() => mark(rider, 'absent')} accessibilityLabel={`Mark ${rider.name} not coming`}>
                <Text style={[cs.pillText, { color: theme.textMuted }]}>Absent</Text>
              </TouchableOpacity>
            </View>
          ))}
          {summary.checkedIn.map(rider => (
            <TouchableOpacity key={rider.userId} style={cs.riderRow} onPress={() => mark(rider, 'confirmed')} accessibilityHint="Tap to undo check-in">
              <Icon name="checkmark-circle" size="md" color={theme.green} />
              <Text style={cs.riderName} numberOfLines={1}>{rider.name}</Text>
              <Text style={cs.riderMeta}>{rider.checkedInBy === 'location' ? 'by location' : rider.checkedInBy === 'self' ? 'checked in' : 'marked here'}</Text>
            </TouchableOpacity>
          ))}
          {summary.absent.map(rider => (
            <TouchableOpacity key={rider.userId} style={cs.riderRow} onPress={() => mark(rider, 'confirmed')} accessibilityHint="Tap to undo absent">
              <Icon name="remove-circle-outline" size="md" color={theme.subtle} />
              <Text style={[cs.riderName, { color: theme.textMuted }]} numberOfLines={1}>{rider.name}</Text>
              <Text style={cs.riderMeta}>not coming</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {error ? <Text style={cs.error}>{error}</Text> : null}
        {askReason ? (
          <View style={{ gap: 8 }}>
            <Text style={cs.sectionLabel}>{gate.reason.toUpperCase()} WHY START NOW?</Text>
            {START_ANYWAY_REASONS.map(reason => (
              <TouchableOpacity key={reason} style={cs.secondary} disabled={busy} onPress={() => void start(reason)}>
                <Text style={cs.secondaryText}>{reason}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={[cs.primary, busy && { opacity: 0.6 }]}
              disabled={busy}
              onPress={() => (gate.ok ? void start() : setAskReason(true))}
              accessibilityRole="button"
            >
              <Text style={cs.primaryText}>{busy ? 'Starting…' : gate.ok ? 'Start the ride' : `Start anyway · ${summary.waiting.length} missing`}</Text>
            </TouchableOpacity>
            {!gate.ok ? <Text style={[cs.lede, { textAlign: 'center' }]}>{gate.reason}</Text> : null}
          </>
        )}
        <TouchableOpacity onPress={props.onClose}><Text style={cs.ghostText}>Wait a bit</Text></TouchableOpacity>
      </View>
    </SheetModal>
  );
}
