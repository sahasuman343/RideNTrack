import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { DEFAULT_HAND_SIGNALS, buildBriefing, type BriefingInput } from '@ridentrack/shared';
import { SheetModal } from '../ui';
import { useCaptainFlowStyles } from './captainFlowStyles';
import type { BriefingState } from '../../hooks/ride/useCaptainFlow';

/*
 * F1 briefing. The card is generated from the trip (meetup, lead, sweep,
 * regroups); the captain only picks hand signals and adds a note. Riders see
 * the same card, and opening it counts as read.
 */

export interface BriefingSheetProps {
  visible: boolean;
  onClose: () => void;
  bottomInset: number;
  isLeader: boolean;
  trip: Omit<BriefingInput, 'handSignals' | 'notes'>;
  briefing: BriefingState | null;
  onPublish: (handSignals: string[], notes: string) => Promise<void>;
  onOpened: () => void;
}

export function BriefingSheet(props: BriefingSheetProps) {
  const { cs, theme } = useCaptainFlowStyles();
  const { briefing, isLeader, visible, onOpened } = props;
  const [signals, setSignals] = useState<string[]>(briefing?.handSignals.length ? briefing.handSignals : DEFAULT_HAND_SIGNALS);
  const [notes, setNotes] = useState(briefing?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (briefing?.handSignals.length) setSignals(briefing.handSignals);
    if (briefing?.notes != null) setNotes(briefing.notes);
    if (!isLeader && briefing) onOpened();
  }, [visible, briefing, isLeader, onOpened]);

  const card = useMemo(() => buildBriefing({ ...props.trip, handSignals: isLeader ? signals : briefing?.handSignals ?? [], notes: isLeader ? notes : briefing?.notes }), [props.trip, isLeader, signals, notes, briefing]);
  const toggle = (sig: string) => setSignals(list => (list.includes(sig) ? list.filter(x => x !== sig) : [...list, sig]));

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onPublish(signals, notes);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not share the briefing.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetModal visible={visible} onRequestClose={props.onClose}>
      <View style={[cs.sheet, { paddingBottom: Math.max(props.bottomInset, 24) }]}>
        <View style={cs.grabber} />
        <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text style={cs.step}>{isLeader ? 'STEP 1 OF 3 · BRIEFING' : 'BRIEFING FROM YOUR CAPTAIN'}</Text>
          <Text style={cs.headline}>{isLeader ? 'Brief the pack' : card.title}</Text>
          {isLeader ? (
            <Text style={cs.lede}>
              Built from your trip. Riders see it on their phone; you see who has read it.
              {briefing ? ` ${briefing.readCount} of ${Math.max(0, briefing.memberCount - 1)} read so far.` : ''}
            </Text>
          ) : null}

          <View style={cs.card}>
            {card.lines.map(line => (
              <View key={line.label} style={cs.factRow}>
                <Text style={cs.factLabel}>{line.label.toUpperCase()}</Text>
                <Text style={cs.factValue}>{line.value}</Text>
              </View>
            ))}
            {card.notes && !isLeader ? <Text style={[cs.lede, { color: theme.text }]}>{card.notes}</Text> : null}
          </View>

          <Text style={cs.sectionLabel}>HAND SIGNALS</Text>
          {isLeader ? (
            <View style={cs.chipWrap}>
              {DEFAULT_HAND_SIGNALS.map(sig => {
                const on = signals.includes(sig);
                return (
                  <TouchableOpacity key={sig} style={[cs.chip, on && cs.chipOn]} onPress={() => toggle(sig)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                    <Text style={cs.chipText}>{sig}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={{ gap: 6 }}>
              {card.signals.map(sig => <Text key={sig} style={[cs.lede, { color: theme.text }]}>• {sig}</Text>)}
            </View>
          )}

          {isLeader ? (
            <>
              <Text style={cs.sectionLabel}>NOTE FOR THE PACK (OPTIONAL)</Text>
              <TextInput
                style={[cs.input, { minHeight: 80 }]}
                multiline
                maxLength={1000}
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g. Fuel up before the ghat; no overtaking in the convoy"
                placeholderTextColor={theme.subtle}
              />
              {error ? <Text style={cs.error}>{error}</Text> : null}
              <TouchableOpacity style={[cs.primary, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => void publish()} accessibilityRole="button">
                <Text style={cs.primaryText}>{busy ? 'Sharing…' : briefing ? 'Share updated briefing' : 'Share briefing'}</Text>
              </TouchableOpacity>
            </>
          ) : null}
          <TouchableOpacity onPress={props.onClose} accessibilityRole="button">
            <Text style={cs.ghostText}>{isLeader ? 'Not now' : 'Got it'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </SheetModal>
  );
}
