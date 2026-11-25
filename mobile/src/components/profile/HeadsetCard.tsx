import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { looksLikeHelmetHeadset } from '@ridentrack/shared';
import {
  bondedAudioDevices,
  headsetMonitorAvailable,
  loadHeadsetSettings,
  saveHeadsetSettings,
  type HeadsetSettings,
} from '../../services/headsetAutostart';
import { track } from '../../services/analytics';
import { useRideTheme, radius, spacing, type RidePalette } from '../../theme';

/**
 * F20: "Ask me to share when my helmet connects". Android only, and only in
 * builds that carry the HeadsetMonitor module; otherwise the card is hidden.
 */
export function HeadsetCard() {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [settings, setSettings] = useState<HeadsetSettings | null>(null);
  const [devices, setDevices] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    void Promise.all([loadHeadsetSettings(), bondedAudioDevices()]).then(([loaded, bonded]) => {
      if (!live) return;
      setSettings(loaded);
      // Helmet communicators first: they are almost always the one riders want.
      setDevices([...bonded].sort((a, b) => Number(looksLikeHelmetHeadset(b)) - Number(looksLikeHelmetHeadset(a))));
    });
    return () => { live = false; };
  }, []);

  if (!headsetMonitorAvailable() || !settings) return null;

  const update = (next: HeadsetSettings) => {
    setSettings(next);
    void saveHeadsetSettings(next);
  };

  const toggleDevice = (name: string) => {
    const on = settings.devices.includes(name);
    update({ ...settings, devices: on ? settings.devices.filter(d => d !== name) : [...settings.devices, name] });
  };

  return (
    <View style={s.card}>
      <View style={s.headRow}>
        <View style={s.headText}>
          <Text style={s.title}>Helmet headset</Text>
          <Text style={s.hint}>
            When your headset connects on a ride day, we ask if you want to share. Nothing is shared until you tap.
          </Text>
        </View>
        <Switch
          value={settings.enabled}
          onValueChange={enabled => {
            update({ ...settings, enabled });
            track('headset_autostart_changed', { enabled });
          }}
          trackColor={{ false: theme.border, true: theme.accent }}
          thumbColor={theme.onAccent}
          accessibilityLabel="Ask to share when my helmet headset connects"
        />
      </View>
      {settings.enabled && devices.length > 0 && (
        <>
          <Text style={s.sub}>
            {settings.devices.length ? 'Only these devices:' : 'Any helmet communicator. Pick yours to be exact:'}
          </Text>
          <View style={s.row}>
            {devices.map(name => {
              const on = settings.devices.includes(name);
              return (
                <TouchableOpacity
                  key={name}
                  style={[s.chip, on && s.chipOn]}
                  onPress={() => toggleDevice(name)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                >
                  <Text style={[s.chipText, on && s.chipTextOn]} numberOfLines={1}>{name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.lg, gap: spacing.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headText: { flex: 1, gap: spacing.xs },
  title: { color: c.text, fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  hint: { color: c.textMuted, fontSize: 12, lineHeight: 18 },
  sub: { color: c.textMuted, fontSize: 12, fontWeight: '700', marginTop: spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 44, maxWidth: '100%', paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, justifyContent: 'center' },
  chipOn: { borderColor: c.accent, backgroundColor: c.accentSoft },
  chipText: { color: c.textMuted, fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: c.text },
});
