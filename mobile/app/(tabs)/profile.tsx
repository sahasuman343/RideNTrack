import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../../src/hooks/useAuth';

export default function ProfileScreen() {
  const { profile, signOut, deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);

  function confirmDeleteAccount() {
    Alert.alert(
      'Permanently delete account?',
      'This cannot be undone. Your profile, all rides you organized, your participation in other rides, GPS history, alerts, and this account’s refreshable sessions will be deleted. Other riders’ data in rides you did not organize will remain.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => {
          setDeleting(true);
          void deleteAccount()
            .then(() => Alert.alert('Account deleted', 'Your RideNTrack account and associated data have been permanently deleted.'))
            .catch(error => Alert.alert('Deletion failed', error instanceof Error ? error.message : 'Please try again.'))
            .finally(() => setDeleting(false));
        } },
      ],
    );
  }

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

      <View style={styles.dangerInfo}>
        <Text style={styles.dangerTitle}>Delete account</Text>
        <Text style={styles.dangerDescription}>Permanently remove your account and associated RideNTrack data. Rides you organized will also be deleted for all participants.</Text>
        <TouchableOpacity accessibilityRole="button" disabled={deleting} style={[styles.deleteButton, deleting && styles.disabled]} onPress={confirmDeleteAccount}>
          <Text style={styles.deleteText}>{deleting ? 'Deleting account…' : 'Permanently delete account'}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={() => void signOut().catch(e => Alert.alert('Sign out failed', e.message))}>
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
  dangerInfo: { width: '100%', marginTop: 28, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#6b3038', backgroundColor: '#241c30' },
  dangerTitle: { color: '#ffaaa3', fontSize: 16, fontWeight: '700' },
  dangerDescription: { color: '#c6b6b8', fontSize: 12, lineHeight: 18, marginTop: 6 },
  deleteButton: { marginTop: 14, borderRadius: 10, padding: 14, alignItems: 'center', backgroundColor: '#7f2e36' },
  deleteText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.55 },
});
