import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ROAD_REPORT_TYPES, reportTrust, roadReportLabel, type RoadReport, type RoadReportType } from '@ridentrack/shared';
import { useRideTheme, radius, spacing, type RidePalette } from '../../theme';
import { Icon, SheetModal } from '../ui';
import { useT } from '../../hooks/useLocale';
import type { MessageKey } from '@ridentrack/shared';

/*
 * F11: report the road for everyone who rides here in the next two days.
 * Two taps with gloves on: pick what it is, send. A note is optional. When
 * opened on an existing report it shows that report instead, with "Still
 * there" and, for the captain, "Hide for this ride".
 */

const ICONS: Record<RoadReportType, string> = {
  landslide: 'warning-outline', closure: 'remove-circle-outline', water_crossing: 'water-outline', snow_ice: 'snow-outline',
  accident: 'medkit-outline', pothole: 'ellipse-outline', animals: 'paw-outline', police_check: 'shield-outline',
  fuel_out: 'speedometer-outline', other: 'flag-outline',
};

export function RoadReportSheet(props: {
  visible: boolean;
  onClose: () => void;
  bottomInset: number;
  hasFix: boolean;
  online: boolean;
  selected: RoadReport | null;
  canHide: boolean;
  onReport: (type: RoadReportType, note: string | null) => Promise<boolean>;
  onConfirm: (id: string) => void;
  onHide: (id: string) => void;
}) {
  const theme = useRideTheme();
  const tr = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [type, setType] = useState<RoadReportType | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const close = () => { setType(null); setNote(''); props.onClose(); };

  const selected = props.selected;
  return (
    <SheetModal visible={props.visible} onRequestClose={close}>
      <View style={[s.sheet, { paddingBottom: Math.max(props.bottomInset, 24) }]}>
        {selected ? (
          <>
            <Text style={s.kicker}>{tr('road.kicker_view')}</Text>
            <Text style={s.title}>{tr(`road.type.${selected.type}` as MessageKey)}</Text>
            {selected.note ? <Text style={s.body}>{selected.note}</Text> : null}
            <Text style={s.meta}>{reportTrust(selected)}</Text>
            <View style={s.row}>
              {!selected.mine && !selected.confirmed_by_me && !selected.pending && (
                <TouchableOpacity style={[s.primary, !props.online && s.disabled]} disabled={!props.online} onPress={() => { props.onConfirm(selected.id); close(); }}>
                  <Text style={s.primaryText}>{tr('road.still_there')}</Text>
                </TouchableOpacity>
              )}
              {props.canHide && !selected.pending && (
                <TouchableOpacity style={s.secondary} onPress={() => { props.onHide(selected.id); close(); }}>
                  <Text style={s.secondaryText}>{tr('road.hide')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        ) : (
          <>
            <Text style={s.kicker}>{tr('road.kicker')}</Text>
            <Text style={s.title}>{tr('road.title')}</Text>
            <Text style={s.meta}>
              {props.hasFix ? tr('road.pinned') : tr('road.no_fix')}
              {props.online ? '' : ` ${tr('road.offline')}`}
            </Text>
            <View style={s.grid}>
              {ROAD_REPORT_TYPES.map(t => {
                const on = type === t.type;
                const tone = t.severe ? theme.danger : theme.warning;
                return (
                  <TouchableOpacity
                    key={t.type}
                    style={[s.tile, on && { borderColor: tone, backgroundColor: t.severe ? theme.dangerSoft : theme.warningSoft }]}
                    onPress={() => setType(t.type)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Icon name={ICONS[t.type] as never} size="md" color={on ? tone : theme.textMuted} />
                    <Text style={[s.tileText, on && { color: theme.text }]} numberOfLines={2}>{tr(`road.type.${t.type}` as MessageKey)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              style={s.input}
              value={note}
              onChangeText={setNote}
              placeholder={tr('road.note_placeholder')}
              placeholderTextColor={theme.subtle}
              maxLength={140}
            />
            <TouchableOpacity
              style={[s.primary, (!type || !props.hasFix || sending) && s.disabled]}
              disabled={!type || !props.hasFix || sending}
              onPress={async () => {
                if (!type) return;
                setSending(true);
                const ok = await props.onReport(type, note || null).finally(() => setSending(false));
                if (ok) close();
              }}
            >
              <Text style={s.primaryText}>{type ? tr('road.report_type', { type: tr(`road.type.${type}` as MessageKey) }) : tr('road.pick')}</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity style={s.cancel} onPress={close}>
          <Text style={s.secondaryText}>{tr('common.close')}</Text>
        </TouchableOpacity>
      </View>
    </SheetModal>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: spacing.lg, gap: spacing.md },
  kicker: { color: c.subtle, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: c.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  body: { color: c.text, fontSize: 16, lineHeight: 22 },
  meta: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    width: '48%', minHeight: 64, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border,
    backgroundColor: c.surfaceRaised, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  tileText: { flex: 1, color: c.textMuted, fontSize: 14, fontWeight: '700' },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  primary: { flex: 1, minHeight: 56, borderRadius: radius.md, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: c.onAccent, fontSize: 16, fontWeight: '800' },
  secondary: { flex: 1, minHeight: 56, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: c.text, fontSize: 15, fontWeight: '700' },
  cancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
});
