import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { radius, spacing, typography, useRideTheme, type RidePalette } from '../../theme';

/* Shared look for the captain flow sheets: one step, one headline, one main action. */
export const makeCaptainFlowStyles = (c: RidePalette) => StyleSheet.create({
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: spacing.xl, paddingTop: spacing.lg, gap: spacing.md, maxHeight: '92%' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, marginBottom: spacing.xs },
  step: { ...typography.labelCaps, color: c.accent },
  headline: { ...typography.headlineMd, color: c.text },
  lede: { ...typography.bodyMd, color: c.textMuted },
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceRaised, padding: spacing.lg, gap: spacing.sm },
  cardTitle: { ...typography.titleMd, color: c.text },
  factRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'baseline' },
  factLabel: { ...typography.labelCaps, color: c.subtle, width: 72 },
  factValue: { ...typography.bodyMd, color: c.text, flex: 1, fontWeight: '600' },
  sectionLabel: { ...typography.labelCaps, color: c.subtle, marginTop: spacing.xs },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border, justifyContent: 'center' },
  chipOn: { borderColor: c.accent, backgroundColor: c.accentSoft },
  chipText: { ...typography.bodySm, color: c.text, fontWeight: '700' },
  input: { minHeight: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.borderStrong, backgroundColor: c.input, color: c.text, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 15, textAlignVertical: 'top' },
  primary: { minHeight: 56, borderRadius: radius.md, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  primaryText: { ...typography.titleMd, color: c.onAccent },
  secondary: { minHeight: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  secondaryText: { ...typography.titleMd, color: c.text },
  ghostText: { ...typography.bodyMd, color: c.textMuted, textAlign: 'center', paddingVertical: spacing.sm, fontWeight: '700' },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  riderName: { ...typography.bodyLg, color: c.text, fontWeight: '700', flex: 1 },
  riderMeta: { ...typography.bodySm, color: c.textMuted },
  pill: { minHeight: 44, minWidth: 72, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  pillText: { ...typography.bodySm, fontWeight: '800' },
  meter: { flexDirection: 'row', gap: 4, height: 8 },
  meterSeg: { flex: 1, borderRadius: 4 },
  error: { ...typography.bodySm, color: c.danger, fontWeight: '700' },
});

export type CaptainFlowStyles = ReturnType<typeof makeCaptainFlowStyles>;

export function useCaptainFlowStyles() {
  const theme = useRideTheme();
  return { theme, cs: useMemo(() => makeCaptainFlowStyles(theme), [theme]) };
}
