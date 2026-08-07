import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';

export default function CreateRideScreen() {
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const router = useRouter();

  async function handleCreate() {
    if (!name || !origin || !destination) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (!user) return;

    setLoading(true);
    try {
      // Geocode origin and destination using Mapbox
      const originCoords = await geocode(origin);
      const destCoords = await geocode(destination);

      if (!originCoords || !destCoords) {
        Alert.alert('Error', 'Could not find one or both locations. Try being more specific.');
        return;
      }

      const { data, error } = await supabase.from('rides').insert({
        name,
        admin_id: user.id,
        origin,
        destination,
        origin_coords: originCoords,
        destination_coords: destCoords,
      }).select().single();

      if (error) throw error;

      Alert.alert('Ride Created!', `Share this code with your group: ${data.ride_code}`, [
        { text: 'Go to Ride', onPress: () => router.push(`/ride/${data.id}`) },
      ]);

      setName('');
      setOrigin('');
      setDestination('');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Create a Group Ride</Text>
      <Text style={styles.subtitle}>Set up a ride and share the code with your group</Text>

      <View style={styles.form}>
        <Text style={styles.label}>Ride Name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Weekend Coastal Ride"
          placeholderTextColor="#666"
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.label}>Starting Point</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Bangalore, Karnataka"
          placeholderTextColor="#666"
          value={origin}
          onChangeText={setOrigin}
        />

        <Text style={styles.label}>Destination</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Goa"
          placeholderTextColor="#666"
          value={destination}
          onChangeText={setDestination}
        />

        <TouchableOpacity style={styles.button} onPress={handleCreate} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Creating...' : 'Create Ride'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

async function geocode(place: string): Promise<[number, number] | null> {
  const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(place)}.json?country=IN&access_token=${token}`
    );
    const data = await res.json();
    if (data.features && data.features.length > 0) {
      return data.features[0].center as [number, number]; // [lng, lat]
    }
    return null;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  scroll: { padding: 24 },
  title: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  subtitle: { color: '#999', fontSize: 14, marginTop: 4, marginBottom: 24 },
  form: { gap: 12 },
  label: { color: '#ccc', fontSize: 14, fontWeight: '500' },
  input: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  button: {
    backgroundColor: '#FF6B00',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
