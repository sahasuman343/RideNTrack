import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LOCALES, lineHeightFor, type Locale } from '@ridentrack/shared';
import { useLocale } from '../../hooks/useLocale';
import { useRideTheme, radius, spacing, type RidePalette } from '../../theme';

/**
 * F13: three chips, each written in its own script so a rider who cannot
 * read the current language still finds theirs.
 */
export function LanguagePicker() {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { chosen, setLocale, t } = useLocale();
  const options: Array<{ code: Locale | null; label: string }> = [
    { code: null, label: t('profile.language_phone') },
    ...LOCALES.map(l => ({ code: l.code, label: l.name })),
  ];
  return (
    <View style={s.card}>
      <Text style={s.title}>{t('profile.language')}</Text>
      <Text style={s.hint}>{t('profile.language_hint')}</Text>
      <View style={s.row} accessibilityRole="radiogroup">
        {options.map(o => {
          const on = chosen === o.code;
          return (
            <TouchableOpacity
              key={o.code ?? 'phone'}
              style={[s.chip, on && s.chipOn]}
              onPress={() => setLocale(o.code)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text style={[s.chipText, on && s.chipTextOn, o.code === 'hi' && { lineHeight: lineHeightFor('hi', 15) }]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.lg, gap: spacing.sm },
  title: { color: c.text, fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  hint: { color: c.textMuted, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  chip: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, justifyContent: 'center' },
  chipOn: { borderColor: c.accent, backgroundColor: c.accentSoft },
  chipText: { color: c.textMuted, fontSize: 15, fontWeight: '700' },
  chipTextOn: { color: c.text },
});
