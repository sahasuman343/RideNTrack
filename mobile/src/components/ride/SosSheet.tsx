import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { SosRecipient, SosStep } from '@ridentrack/shared';
import { Icon, SheetModal } from '../ui';
import { useT } from '../../hooks/useLocale';
import type { RidePalette } from '../../theme';
import type { RideStyles } from './rideStyles';

/*
 * F6: one big button, then a list of what happened in plain status words
 * ("Alert to your pack · Waiting for signal", "Text to Amma, Sam · Tap Send
 * in Messages"). Calls stay one tap away underneath.
 */

export interface SosSheetProps {
  s: RideStyles;
  theme: RidePalette;
  bottomInset: number;
  visible: boolean;
  busy: boolean;
  emergencyContact: string | null | undefined;
  started: boolean;
  steps: SosStep[];
  recipients: SosRecipient[];
  primaryLabel: string;
  onClose: () => void;
  onPrimary: () => void;
  onCallContact: () => void;
  onCall112: () => void;
  onHighwayHelp: () => void;
}

const STEP_ICON: Record<SosStep['state'], { name: string; tone: 'ok' | 'wait' | 'act' | 'bad' | 'muted' }> = {
  sent: { name: 'checkmark-circle', tone: 'ok' },
  sent_by_sms: { name: 'checkmark-done-circle', tone: 'ok' },
  sending: { name: 'sync-circle-outline', tone: 'wait' },
  pending: { name: 'ellipse-outline', tone: 'muted' },
  waiting_for_signal: { name: 'cloud-offline-outline', tone: 'wait' },
  action_needed: { name: 'hand-left-outline', tone: 'act' },
  failed: { name: 'alert-circle', tone: 'bad' },
  skipped: { name: 'remove-circle-outline', tone: 'muted' },
};

export function SosSheet(props: SosSheetProps) {
  const { s, theme, busy } = props;
  const t = useT();
  const toneColor = { ok: theme.green, wait: theme.warning, act: theme.accent, bad: theme.danger, muted: theme.subtle };
  return (
    <SheetModal visible={props.visible} onRequestClose={props.onClose} dismissOnScrimPress={!props.started}>
      <View style={[s.modal, { paddingBottom: Math.max(props.bottomInset, 24), gap: 12 }]}>
        <Text style={[s.heading, { color: theme.danger }]}>{props.started ? t('sos.title_sent') : t('sos.title')}</Text>
        {!props.started ? (
          <Text style={s.muted}>
            {t('sos.intro', { who: props.recipients.length ? props.recipients.map(r => r.name).join(', ') : t('sos.intro_nobody') })}
          </Text>
        ) : null}

        {props.steps.map(step => {
          const icon = STEP_ICON[step.state];
          return (
            <View key={step.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }} accessibilityLiveRegion="polite">
              <Icon name={icon.name as never} size="lg" color={toneColor[icon.tone]} />
              <View style={{ flex: 1 }}>
                <Text style={[s.text, { fontWeight: '700' }]}>{step.label}</Text>
                <Text style={[s.muted, { color: toneColor[icon.tone], fontWeight: '700' }]}>{step.status}</Text>
              </View>
            </View>
          );
        })}

        <TouchableOpacity
          style={[s.sosEmergencyOption, { minHeight: 64 }]}
          disabled={busy}
          onPress={props.onPrimary}
          accessibilityRole="button"
        >
          <Text style={s.sosEmergencyText}>{props.primaryLabel}</Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={[s.alertOption, { flex: 1, justifyContent: 'center' }]} onPress={props.onCall112} accessibilityLabel={t('sos.call_112')}>
            <Icon name="call" size="md" color={theme.danger} />
            <Text style={[s.text, { fontWeight: '800' }]}>{t('sos.call_112')}</Text>
          </TouchableOpacity>
          {props.emergencyContact ? (
            <TouchableOpacity style={[s.alertOption, { flex: 1, justifyContent: 'center' }]} onPress={props.onCallContact} accessibilityLabel={t('sos.call_contact_a11y')}>
              <Icon name="call-outline" size="md" color={theme.textMuted} />
              <Text style={[s.text, { fontWeight: '700' }]} numberOfLines={1}>{t('sos.call_contact')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity style={[s.alertOption, { borderColor: theme.accent, borderWidth: 1 }]} onPress={props.onHighwayHelp}>
          <Icon name="car-outline" size="md" color={theme.accent} />
          <Text style={[s.text, { color: theme.accent, flexShrink: 1 }]}>{t('sos.highway_help')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.secondary} onPress={props.onClose}>
          <Text style={s.text}>{props.started ? t('common.close') : t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>
    </SheetModal>
  );
}
