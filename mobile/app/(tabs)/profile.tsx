import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../src/hooks/useAuth';

export default function ProfileScreen() {
  const { profile, signOut } = useAuth();

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

      <TouchableOpacity style={styles.logoutButton} onPress={signOut}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 24, alignItems: 'center', paddingTop: 60 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FF6B00',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: '#fff', fontSize: 32, fontWeight: 'bold' },
  name: { color: '#fff', fontSize: 24, fontWeight: '600', marginTop: 16 },
  username: { color: '#999', fontSize: 14, marginTop: 4 },
  info: { width: '100%', marginTop: 32, gap: 16 },
  infoRow: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  infoLabel: { color: '#999', fontSize: 12 },
  infoValue: { color: '#fff', fontSize: 16, marginTop: 4 },
  logoutButton: {
    marginTop: 32,
    backgroundColor: '#e74c3c',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    alignItems: 'center',
  },
  logoutText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
