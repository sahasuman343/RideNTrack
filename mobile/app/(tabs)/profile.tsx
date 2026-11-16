import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, RidePalette } from '../../src/theme';

export default function ProfileScreen() {
  const { profile, signOut } = useAuth();
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={styles.container}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{profile?.display_name?.[0]?.toUpperCase() || '?'}</Text>
      </View>
      <Text style={styles.name}>{profile?.display_name || 'Rider'}</Text>
      <Text style={styles.username}>@{profile?.username || 'unknown'}</Text>

      <View style={styles.info}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Phone</Text>
          <Text style={styles.infoValue}>{profile?.phone || 'Not set'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Emergency Contact</Text>
          <Text style={styles.infoValue}>{profile?.emergency_contact || 'Not set'}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={() => void signOut().catch(e => Alert.alert('Sign out failed', e.message))}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background, padding: 24, alignItems: 'center', paddingTop: 60 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: c.green,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: c.text, fontSize: 32, fontWeight: 'bold' },
  name: { color: '#fff', fontSize: 24, fontWeight: '600', marginTop: 16 },
  username: { color: c.muted, fontSize: 14, marginTop: 4 },
  info: { width: '100%', marginTop: 32, gap: 16 },
  infoRow: {
    backgroundColor: c.surface,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: c.border,
  },
  infoLabel: { color: '#999', fontSize: 12 },
  infoValue: { color: '#fff', fontSize: 16, marginTop: 4 },
  logoutButton: {
    marginTop: 32,
    backgroundColor: c.danger,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    alignItems: 'center',
  },
  logoutText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
