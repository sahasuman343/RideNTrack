import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { Debrief } from '@ridentrack/shared';
import { SheetModal } from '../ui';
import { useCaptainFlowStyles } from './captainFlowStyles';

/* F1 debrief: generated from alerts, regroups and the start; the captain adds a note or just saves. */

export interface DebriefSheetProps {
  visible: boolean;
  onClose: () => void;
  bottomInset: number;
  generated: Debrief | null;
  saved: { summary: string; facts: string[]; notes: string | null } | null;
  onSave: (notes: string) => Promise<void>;
}

export function DebriefSheet(props: DebriefSheetProps) {
  const { cs, theme } = useCaptainFlowStyles();
  const [notes, setNotes] = useState(props.saved?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (props.saved?.notes != null) setNotes(props.saved.notes); }, [props.saved?.notes]);

  const summary = props.saved?.summary ?? props.generated?.summary;
  const facts = props.saved?.facts ?? props.generated?.facts ?? [];

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onSave(notes);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the debrief.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetModal visible={props.visible} onRequestClose={props.onClose}>
      <View style={[cs.sheet, { paddingBottom: Math.max(props.bottomInset, 24) }]}>
        <View style={cs.grabber} />
        <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text style={cs.step}>{props.saved ? 'DEBRIEF SAVED' : 'STEP 3 OF 3 · DEBRIEF'}</Text>
          <Text style={cs.headline}>{props.generated?.title ?? 'Debrief'}</Text>
          {summary ? (
            <View style={cs.card}>
              <Text style={cs.cardTitle}>{summary}</Text>
              {facts.map(f => <Text key={f} style={[cs.lede, { color: theme.text }]}>• {f}</Text>)}
            </View>
          ) : (
            <Text style={cs.lede}>Gathering the ride&apos;s alerts and regroups…</Text>
          )}
          <Text style={cs.sectionLabel}>CAPTAIN&apos;S NOTES (OPTIONAL)</Text>
          <TextInput
            style={[cs.input, { minHeight: 96 }]}
            multiline
            maxLength={2000}
            value={notes}
            onChangeText={setNotes}
            placeholder="What went well, what to change next time"
            placeholderTextColor={theme.subtle}
          />
          {error ? <Text style={cs.error}>{error}</Text> : null}
          <TouchableOpacity style={[cs.primary, (busy || !summary) && { opacity: 0.6 }]} disabled={busy || !summary} onPress={() => void save()}>
            <Text style={cs.primaryText}>{busy ? 'Saving…' : props.saved ? 'Update debrief' : 'Save debrief'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={props.onClose}><Text style={cs.ghostText}>Later</Text></TouchableOpacity>
        </ScrollView>
      </View>
    </SheetModal>
  );
}
