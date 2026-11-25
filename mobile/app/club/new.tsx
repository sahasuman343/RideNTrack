import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isValidClubSlug, slugifyClubName } from '@ridentrack/shared';
import { createClub } from '../../src/hooks/useClubs';
import { useRideTheme, radius, spacing, type RidePalette } from '../../src/theme';
import { Button, Icon } from '../../src/components/ui';

/** F15: start a club. The link is made from the name and can be edited. */
export default function NewClubScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [city, setCity] = useState('');
  const [description, setDescription] = useState('');
  const [byCode, setByCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finalSlug = slugEdited ? slug : slugifyClubName(name);
  const ready = name.trim().length >= 3 && isValidClubSlug(finalSlug);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await createClub({ name, slug: finalSlug, city, description, joinPolicy: byCode ? 'code' : 'open' });
      router.replace(`/club/${finalSlug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the club.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={[s.screen, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TouchableOpacity onPress={() => router.back()} style={s.back} accessibilityLabel="Back">
        <Icon name="chevron-back" size="md" color={theme.text} />
      </TouchableOpacity>
      <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: insets.bottom + 40, gap: spacing.md }} keyboardShouldPersistTaps="handled">
        <Text style={s.kicker}>NEW CLUB</Text>
        <Text style={s.h1}>Give your crew a home</Text>
        <Text style={s.muted}>A roster, regular rides you plan in one tap, and a page you can share.</Text>

        <Text style={s.label}>Name</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="e.g. Deccan Dawn Riders" placeholderTextColor={theme.subtle} maxLength={60} />
        <Text style={s.label}>Club link</Text>
        <View style={s.slugRow}>
          <Text style={s.slugPrefix}>ridentrack.app/club/</Text>
          <TextInput
            style={s.slugInput}
            value={finalSlug}
            onChangeText={v => { setSlugEdited(true); setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, '')); }}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={40}
          />
        </View>
        {finalSlug.length > 0 && !isValidClubSlug(finalSlug) && <Text style={[s.muted, { color: theme.danger }]}>3 to 40 letters or numbers, single dashes between words.</Text>}
        <Text style={s.label}>City</Text>
        <TextInput style={s.input} value={city} onChangeText={setCity} placeholder="Where you usually start" placeholderTextColor={theme.subtle} maxLength={60} />
        <Text style={s.label}>About</Text>
        <TextInput style={[s.input, { minHeight: 88, textAlignVertical: 'top', paddingTop: 12 }]} value={description} onChangeText={setDescription} placeholder="What and how you ride, who should join" placeholderTextColor={theme.subtle} multiline maxLength={600} />
        <View style={s.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Join by code only</Text>
            <Text style={s.muted}>Off: anyone with the link can join. On: they also need the code you share.</Text>
          </View>
          <Switch value={byCode} onValueChange={setByCode} trackColor={{ false: theme.border, true: theme.accent }} thumbColor={theme.onAccent} />
        </View>
        {error ? <Text style={[s.muted, { color: theme.danger }]}>{error}</Text> : null}
        <Button title="Create club" size="lg" disabled={!ready} loading={busy} onPress={() => void save()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.sm },
  kicker: { color: c.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  h1: { color: c.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  muted: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
  label: { color: c.text, fontSize: 13, fontWeight: '800', marginTop: spacing.sm },
  input: { minHeight: 48, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, paddingHorizontal: spacing.md, color: c.text, fontSize: 16 },
  slugRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, paddingHorizontal: spacing.md },
  slugPrefix: { color: c.subtle, fontSize: 14 },
  slugInput: { flex: 1, color: c.text, fontSize: 14, fontWeight: '700', paddingVertical: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
});
