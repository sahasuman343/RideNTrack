import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Modal, TextInput, Image, Switch, ScrollView } from 'react-native';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, useRideThemeSettings, RidePalette } from '../../src/theme';

export default function ProfileScreen() {
  const { profile, signOut, updateProfile } = useAuth();
  const theme = useRideTheme();
  const { mode, setMode } = useRideThemeSettings();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');

  function openEditor() {
    setDisplayName(profile?.display_name || '');
    setPhone(profile?.phone || '');
    setAvatarUrl(profile?.avatar_url || '');
    setEditing(true);
  }
  async function saveProfile() {
    if (!displayName.trim()) { Alert.alert('Name required', 'Please enter your display name.'); return; }
    if (phone.trim() && !/^\\+?[0-9 ()-]{7,20}$/.test(phone.trim())) {
      Alert.alert('Check phone number', 'Enter a valid phone number, including country code if needed.'); return;
    }
    if (avatarUrl.trim() && !/^https?:\\/\\//i.test(avatarUrl.trim())) {
      Alert.alert('Invalid photo URL', 'Use a public HTTPS or HTTP image URL.'); return;
    }
    setSaving(true);
    try {
      await updateProfile({ display_name: displayName.trim(), phone: phone.trim() || null, avatar_url: avatarUrl.trim() || null });
      setEditing(false);
      Alert.alert('Profile updated', 'Your rider details have been saved.');
    } catch (error) {
      Alert.alert('Could not update profile', error instanceof Error ? error.message : 'Please try again.');
    } finally { setSaving(false); }
  }
  const dark = mode === 'dark' || (mode === 'system' && theme.background === '#14221D');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>YOUR RIDER ACCOUNT</Text>
      {profile?.avatar_url ? <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} /> :
        <View style={styles.avatar}><Text style={styles.avatarText}>{profile?.display_name?.[0]?.toUpperCase() || '?'}</Text></View>}
      <Text style={styles.name}>{profile?.display_name || 'Rider'}</Text>
      <Text style={styles.username}>@{profile?.username || 'unknown'}</Text>
      <TouchableOpacity style={styles.editButton} onPress={openEditor}><Text style={styles.editText}>Edit profile</Text></TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.section}>Rider details</Text>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>Phone</Text><Text style={styles.infoValue}>{profile?.phone || 'Not set'}</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>Emergency contact</Text><Text style={styles.infoValue}>{profile?.emergency_contact || 'Not set'}</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>Username</Text><Text style={styles.infoValue}>@{profile?.username || 'unknown'}</Text></View>
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Appearance</Text>
        <View style={styles.settingRow}>
          <View style={{ flex: 1 }}><Text style={styles.settingTitle}>Dark mode</Text><Text style={styles.settingHint}>{mode === 'system' ? 'Following your device setting' : dark ? 'Dark theme enabled' : 'Light theme enabled'}</Text></View>
          <Switch value={dark} onValueChange={value => setMode(value ? 'dark' : 'light')} trackColor={{ false: theme.border, true: theme.green }} thumbColor={theme.surface} />
        </View>
        <TouchableOpacity onPress={() => setMode('system')} style={styles.systemButton}><Text style={styles.systemText}>Use device appearance</Text></TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={() => void signOut().catch(e => Alert.alert('Sign out failed', e.message))}>
        <Text style={styles.logoutText}>Sign out</Text>
      </TouchableOpacity>

      <Modal visible={editing} transparent animationType="slide" onRequestClose={() => setEditing(false)}>
        <View style={styles.overlay}><View style={styles.modal}>
          <Text style={styles.modalTitle}>Edit rider profile</Text>
          <Text style={styles.fieldLabel}>Display name</Text>
          <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={theme.subtle} />
          <Text style={styles.fieldLabel}>Phone number</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91..." placeholderTextColor={theme.subtle} />
          <Text style={styles.fieldLabel}>Profile photo URL</Text>
          <TextInput style={styles.input} value={avatarUrl} onChangeText={setAvatarUrl} autoCapitalize="none" keyboardType="url" placeholder="https://..." placeholderTextColor={theme.subtle} />
          <Text style={styles.hint}>Use a publicly accessible image URL. Leave blank to use your initials.</Text>
          <TouchableOpacity disabled={saving} style={styles.saveButton} onPress={() => void saveProfile()}><Text style={styles.saveText}>{saving ? 'Saving…' : 'Save changes'}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={() => setEditing(false)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </ScrollView>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  content: { padding: 24, alignItems: 'center', paddingTop: 42, paddingBottom: 48 },
  eyebrow: { color: c.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 20 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: c.green, justifyContent: 'center', alignItems: 'center' },
  avatarImage: { width: 88, height: 88, borderRadius: 44, backgroundColor: c.surfaceRaised },
  avatarText: { color: c.surface, fontSize: 32, fontWeight: 'bold' },
  name: { color: c.text, fontSize: 25, fontWeight: '800', marginTop: 15 },
  username: { color: c.muted, fontSize: 14, marginTop: 4 },
  editButton: { marginTop: 17, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 11 },
  editText: { color: c.text, fontWeight: '700', fontSize: 13 },
  card: { width: '100%', marginTop: 22, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 17 },
  section: { color: c.text, fontSize: 17, fontWeight: '800', marginBottom: 12 },
  infoRow: { paddingVertical: 11, borderTopWidth: 1, borderTopColor: c.border },
  infoLabel: { color: c.muted, fontSize: 12 },
  infoValue: { color: c.text, fontSize: 15, fontWeight: '600', marginTop: 4 },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  settingTitle: { color: c.text, fontSize: 15, fontWeight: '700' },
  settingHint: { color: c.muted, fontSize: 12, marginTop: 3 },
  systemButton: { alignSelf: 'flex-start', marginTop: 10, paddingVertical: 8 },
  systemText: { color: c.accent, fontSize: 13, fontWeight: '700' },
  logoutButton: { marginTop: 24, backgroundColor: c.danger, borderRadius: 13, padding: 16, width: '100%', alignItems: 'center' },
  logoutText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' },
  modal: { backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 36 },
  modalTitle: { color: c.text, fontSize: 21, fontWeight: '800', marginBottom: 14 },
  fieldLabel: { color: c.text, fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 5 },
  input: { backgroundColor: c.input, color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 13, fontSize: 15 },
  hint: { color: c.muted, fontSize: 11, marginTop: 7, lineHeight: 16 },
  saveButton: { backgroundColor: c.accent, padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  saveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  cancelButton: { padding: 14, alignItems: 'center', marginTop: 4 },
  cancelText: { color: c.muted, fontWeight: '700' },
});
