import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { buildRecurrenceRule, describeRecurrence, type ClubRideRow, type RecurrenceRule, type Weekday } from '@ridentrack/shared';
import { useRideTheme, radius, spacing, type RidePalette } from '../../theme';
import { Button, SheetModal } from '../ui';

const DAYS: Array<{ code: Weekday; short: string }> = [
  { code: 'MO', short: 'Mon' }, { code: 'TU', short: 'Tue' }, { code: 'WE', short: 'Wed' }, { code: 'TH', short: 'Thu' },
  { code: 'FR', short: 'Fri' }, { code: 'SA', short: 'Sat' }, { code: 'SU', short: 'Sun' },
];
const PATTERNS: Array<{ id: string; label: string; rule: (d: Weekday) => RecurrenceRule }> = [
  { id: 'weekly', label: 'Every week', rule: day => ({ freq: 'WEEKLY', interval: 1, day, nth: null }) },
  { id: 'fortnight', label: 'Every other week', rule: day => ({ freq: 'WEEKLY', interval: 2, day, nth: null }) },
  { id: 'first', label: 'First of the month', rule: day => ({ freq: 'MONTHLY', interval: 1, day, nth: 1 }) },
  { id: 'last', label: 'Last of the month', rule: day => ({ freq: 'MONTHLY', interval: 1, day, nth: -1 }) },
];

/** F15: a regular club ride is a template trip plus a day pattern. */
export function SeriesSheet(props: {
  visible: boolean;
  onClose: () => void;
  bottomInset: number;
  rides: ClubRideRow[];
  onCreate: (name: string, rule: string, templateRideId: string) => Promise<void>;
}) {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [name, setName] = useState('');
  const [day, setDay] = useState<Weekday>('SU');
  const [pattern, setPattern] = useState('weekly');
  const [template, setTemplate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rule = buildRecurrenceRule(PATTERNS.find(p => p.id === pattern)!.rule(day));
  const ready = name.trim().length >= 3 && template;

  const save = async () => {
    if (!template) return;
    setBusy(true);
    setError(null);
    try {
      await props.onCreate(name.trim(), rule, template);
      setName(''); setTemplate(null);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetModal visible={props.visible} onRequestClose={props.onClose}>
      <View style={[s.sheet, { paddingBottom: Math.max(props.bottomInset, 24) }]}>
        <Text style={s.kicker}>REGULAR RIDE</Text>
        <Text style={s.title}>{describeRecurrence(rule)}</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Name, e.g. Sunday dawn ride" placeholderTextColor={theme.subtle} maxLength={60} />
        <View style={s.row}>
          {DAYS.map(d => (
            <TouchableOpacity key={d.code} style={[s.chip, day === d.code && s.chipOn]} onPress={() => setDay(d.code)} accessibilityRole="radio" accessibilityState={{ selected: day === d.code }}>
              <Text style={[s.chipText, day === d.code && s.chipTextOn]}>{d.short}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={s.row}>
          {PATTERNS.map(p => (
            <TouchableOpacity key={p.id} style={[s.chip, pattern === p.id && s.chipOn]} onPress={() => setPattern(p.id)} accessibilityRole="radio" accessibilityState={{ selected: pattern === p.id }}>
              <Text style={[s.chipText, pattern === p.id && s.chipTextOn]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.label}>Copy route and stops from</Text>
        {props.rides.length === 0 && <Text style={s.muted}>Add a trip to the club first (trip screen, Club row), then use it as the template.</Text>}
        {props.rides.slice(0, 6).map(r => (
          <TouchableOpacity key={r.id} style={[s.option, template === r.id && s.optionOn]} onPress={() => setTemplate(r.id)} accessibilityRole="radio" accessibilityState={{ selected: template === r.id }}>
            <Text style={s.optionText} numberOfLines={1}>{r.name}</Text>
            <Text style={s.muted}>{r.distance_km ? `${r.distance_km} km` : ''}</Text>
          </TouchableOpacity>
        ))}
        {error ? <Text style={[s.muted, { color: theme.danger }]}>{error}</Text> : null}
        <Button title="Save series" disabled={!ready} loading={busy} onPress={() => void save()} />
      </View>
    </SheetModal>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: spacing.lg, gap: spacing.md },
  kicker: { color: c.subtle, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: c.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  input: { minHeight: 48, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md, color: c.text, fontSize: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, justifyContent: 'center' },
  chipOn: { borderColor: c.accent, backgroundColor: c.accentSoft },
  chipText: { color: c.textMuted, fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: c.text },
  label: { color: c.text, fontSize: 13, fontWeight: '800' },
  muted: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
  option: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border },
  optionOn: { borderColor: c.accent, backgroundColor: c.accentSoft },
  optionText: { color: c.text, fontSize: 15, fontWeight: '600', flex: 1 },
});
