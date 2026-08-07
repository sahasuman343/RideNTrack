import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';

interface RideItem {
  id: string;
  name: string;
  ride_code: string;
  origin: string;
  destination: string;
  status: string;
  admin_id: string;
}

export default function MyRidesScreen() {
  const [rides, setRides] = useState<RideItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    fetchRides();
  }, []);

  async function fetchRides() {
    if (!user) return;
    const { data } = await supabase
      .from('ride_participants')
      .select('ride_id, rides(id, name, ride_code, origin, destination, status, admin_id)')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: false });

    if (data) {
      setRides(data.map((p: any) => p.rides).filter(Boolean));
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await fetchRides();
    setRefreshing(false);
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'active': return '#4CAF50';
      case 'planned': return '#FF9800';
      case 'completed': return '#9E9E9E';
      default: return '#666';
    }
  }

  return (
    <View style={styles.container}>
      {rides.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No rides yet</Text>
          <Text style={styles.emptySubtext}>Create a new ride or join one with a code</Text>
        </View>
      ) : (
        <FlatList
          data={rides}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6B00" />}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/ride/${item.id}`)}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.rideName}>{item.name}</Text>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
                  <Text style={styles.statusText}>{item.status.toUpperCase()}</Text>
                </View>
              </View>
              <Text style={styles.route}>{item.origin} → {item.destination}</Text>
              <Text style={styles.code}>Code: {item.ride_code}</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { color: '#fff', fontSize: 20, fontWeight: '600' },
  emptySubtext: { color: '#999', fontSize: 14, marginTop: 8 },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rideName: { color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  route: { color: '#ccc', fontSize: 14, marginTop: 8 },
  code: { color: '#FF6B00', fontSize: 12, marginTop: 4, fontFamily: 'monospace' },
});
