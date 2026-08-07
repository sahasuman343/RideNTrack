import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';

export default function JoinRideScreen() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleJoin() {
    if (!code || code.length < 6) {
      Alert.alert('Error', 'Please enter a valid 6-character ride code');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('join_ride_by_code', { p_code: code.toUpperCase() });
      if (error) throw error;
      Alert.alert('Joined!', 'You have joined the ride.', [
        { text: 'Go to Ride', onPress: () => router.push(`/ride/${data}`) },
      ]);
      setCode('');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not join ride');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join a Ride</Text>
      <Text style={styles.subtitle}>Enter the 6-character code shared by the ride admin</Text>

      <View style={styles.codeContainer}>
        <TextInput
          style={styles.codeInput}
          placeholder="XXXXXX"
          placeholderTextColor="#666"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          maxLength={6}
          autoCapitalize="characters"
        />
      </View>

      <TouchableOpacity style={styles.button} onPress={handleJoin} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Joining...' : 'Join Ride'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 24, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 24, fontWeight: 'bold', textAlign: 'center' },
  subtitle: { color: '#999', fontSize: 14, marginTop: 4, marginBottom: 32, textAlign: 'center' },
  codeContainer: { alignItems: 'center', marginBottom: 24 },
  codeInput: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 20,
    fontSize: 32,
    color: '#FF6B00',
    borderWidth: 2,
    borderColor: '#0f3460',
    textAlign: 'center',
    letterSpacing: 8,
    width: '80%',
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  button: {
    backgroundColor: '#FF6B00',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
