import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Icon, SheetModal } from '../ui';
import type { RidePalette } from '../../theme';
import type { RideStyles } from './rideStyles';

export interface SosSheetProps {
  s: RideStyles;
  theme: RidePalette;
  bottomInset: number;
  visible: boolean;
  busy: boolean;
  emergencyContact: string | null | undefined;
  /** Extra rows from later features, such as per-recipient send states. */
  children?: React.ReactNode;
  onClose: () => void;
  onSendToGroup: () => void;
  onSms: () => void;
  onCall: () => void;
  onHighwayHelp: () => void;
}

export function SosSheet(props: SosSheetProps) {
  const { s, theme, busy } = props;
  return (
    <SheetModal visible={props.visible} onRequestClose={props.onClose}>
      <View style={[s.modal, { paddingBottom: Math.max(props.bottomInset, 24) }]}>
        <Text style={[s.heading, { color: theme.danger }]}>Emergency</Text>
        <Text style={s.muted}>Broadcast an instant emergency alert with your live GPS location to your group, and reach your emergency contact.</Text>
        <TouchableOpacity style={s.sosEmergencyOption} disabled={busy} onPress={props.onSendToGroup}>
          <Text style={s.sosEmergencyText}>Send to group</Text>
        </TouchableOpacity>
        {props.children}
        <TouchableOpacity style={s.alertOption} disabled={busy} onPress={props.onSms}>
          <Icon name="chatbubble-outline" size="md" color={theme.textMuted} />
          <Text style={[s.text, { flexShrink: 1 }]}>SMS GPS to Contact ({props.emergencyContact || 'None set'})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.alertOption} disabled={busy} onPress={props.onCall}>
          <Icon name="call-outline" size="md" color={theme.textMuted} />
          <Text style={[s.text, { flexShrink: 1 }]}>Call Emergency Contact ({props.emergencyContact || '112'})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.alertOption, { borderColor: theme.accent, borderWidth: 1 }]} onPress={props.onHighwayHelp}>
          <Icon name="call-outline" size="md" color={theme.accent} />
          <Text style={[s.text, { color: theme.accent, flexShrink: 1 }]}>Highway help (1033 / 112)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.secondary} onPress={props.onClose}>
          <Text style={s.text}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </SheetModal>
  );
}
