import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';

type Trip = {
  id: string; name: string; description?: string | null; origin: string; destination: string;
  status: string; trip_type?: string; start_date?: string | null; end_date?: string | null;
  estimated_distance_meters?: number | null; estimated_duration_seconds?: number | null;
  ride_code: string; admin_id: string;
};
type Waypoint = { id: string; sequence: number; waypoint_type: string; name: string; address?: string; latitude: number; longitude: number; notes?: string };
type Day = { id: string; day_number: number; trip_date?: string; title?: string; notes?: string };
type Stay = { id: string; name: string; stay_type: string; address?: string; check_in?: string; check_out?: string; price_amount?: number };

export default function TripWorkspaceScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [stays, setStays] = useState<Stay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError('');
    try {
      const [tripResult, waypointResult, dayResult, stayResult] = await Promise.all([
        supabase.from('rides').select('*').eq('id', id).single(),
        supabase.from('trip_waypoints').select('*').eq('ride_id', id).order('sequence'),
        supabase.from('trip_days').select('*').eq('ride_id', id).order('day_number'),
        supabase.from('trip_stays').select('*').eq('ride_id', id).order('check_in'),
      ]);
      if (tripResult.error) throw tripResult.error;
      if (waypointResult.error) throw waypointResult.error;
      if (dayResult.error) throw dayResult.error;
      if (stayResult.error) throw stayResult.error;
      setTrip(tripResult.data as Trip);
      setWaypoints((waypointResult.data || []) as Waypoint[]);
      setDays((dayResult.data || []) as Day[]);
      setStays((stayResult.data || []) as Stay[]);
    } catch (e: any) { setError(e?.message || 'Could not load this trip.'); }
    finally { setLoading(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function openDirections(point: Waypoint) {
    const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(point.latitude + ',' + point.longitude);
    await Linking.openURL(url);
  }
  const distance = trip?.estimated_distance_meters ? (trip.estimated_distance_meters / 1000).toFixed(0) + ' km' : 'Pending';
  const duration = trip?.estimated_duration_seconds ? Math.round(trip.estimated_duration_seconds / 3600) + ' hr map estimate' : 'Pending';

  if (loading && !trip) return <View style={styles.center}><ActivityIndicator color="#ff8a32" /><Text style={styles.muted}>Loading trip workspace…</Text></View>;
  if (!trip) return <View style={styles.center}><Text style={styles.title}>Trip unavailable</Text><Text style={styles.muted}>{error || 'You may not have access to this trip.'}</Text><TouchableOpacity onPress={() => router.back()}><Text style={styles.link}>Go back</Text></TouchableOpacity></View>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#ff8a32" />}>
      <Text style={styles.eyebrow}>TRIP WORKSPACE · {trip.status.toUpperCase()}</Text>
      <Text style={styles.title}>{trip.name}</Text>
      {!!trip.description && <Text style={styles.muted}>{trip.description}</Text>}
      <View style={styles.hero}>
        <Text style={styles.route}>{trip.origin}</Text>
        <Text style={styles.arrow}>↓</Text>
        <Text style={styles.route}>{trip.destination}</Text>
        <View style={styles.stats}>
          <View><Text style={styles.statValue}>{distance}</Text><Text style={styles.statLabel}>ROUTE DISTANCE</Text></View>
          <View><Text style={styles.statValue}>{duration}</Text><Text style={styles.statLabel}>DRIVING ESTIMATE</Text></View>
        </View>
        <Text style={styles.note}>The map estimate is not yet adjusted for motorcycle pace, breaks or road conditions.</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.primary} onPress={() => router.push('/ride/' + trip.id)}><Text style={styles.primaryText}>Open live ride tracker →</Text></TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={() => router.push('/(tabs)')}><Text style={styles.secondaryText}>My trips</Text></TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Route & itinerary</Text>
        {waypoints.length === 0 ? <Text style={styles.muted}>No saved waypoints yet.</Text> : waypoints.map((point, index) => (
          <TouchableOpacity key={point.id} style={styles.point} onPress={() => void openDirections(point)}>
            <View style={styles.marker}><Text style={styles.markerText}>{index + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pointType}>{point.waypoint_type.toUpperCase()}</Text>
              <Text style={styles.pointName}>{point.name}</Text>
              {!!point.address && <Text style={styles.mutedSmall}>{point.address}</Text>}
              {!!point.notes && <Text style={styles.mutedSmall}>{point.notes}</Text>}
            </View>
            <Text style={styles.link}>Map ↗</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Day-by-day plan</Text>
        {days.length === 0 ? <Text style={styles.muted}>Add trip dates when creating a plan to generate itinerary days.</Text> : days.map(day => (
          <View key={day.id} style={styles.day}>
            <Text style={styles.dayTitle}>{day.title || 'Day ' + day.day_number}</Text>
            <Text style={styles.mutedSmall}>{day.trip_date || 'Date not set'}</Text>
            {!!day.notes && <Text style={styles.mutedSmall}>{day.notes}</Text>}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Overnight stays</Text>
        {stays.length === 0 ? <Text style={styles.muted}>No accommodation added yet.</Text> : stays.map(stay => (
          <View key={stay.id} style={styles.day}>
            <Text style={styles.pointName}>{stay.name}</Text>
            <Text style={styles.mutedSmall}>{stay.stay_type} · {stay.check_in || 'Check-in TBD'} – {stay.check_out || 'Check-out TBD'}</Text>
            {!!stay.address && <Text style={styles.mutedSmall}>{stay.address}</Text>}
            {stay.price_amount != null ? <Text style={styles.mutedSmall}>₹{stay.price_amount}</Text> : null}
          </View>
        ))}
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Text style={styles.footer}>Trip planning is separate from the actual GPS session. Starting the tracker records what happened, while this workspace keeps the planned journey.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101827' }, content: { padding: 18, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: '#101827', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  eyebrow: { color: '#ff9a50', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: '#fff', fontSize: 27, fontWeight: '800', marginTop: 7 },
  muted: { color: '#aab6c9', fontSize: 13, lineHeight: 19, marginTop: 6 },
  mutedSmall: { color: '#9eacc1', fontSize: 11, lineHeight: 16, marginTop: 3 },
  hero: { backgroundColor: '#1a2940', borderRadius: 18, borderWidth: 1, borderColor: '#34445c', padding: 17, marginTop: 18 },
  route: { color: '#fff', fontSize: 16, fontWeight: '700' }, arrow: { color: '#ff9a50', fontSize: 20, marginVertical: 4 },
  stats: { flexDirection: 'row', gap: 28, marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#3b4b62' },
  statValue: { color: '#fff', fontSize: 17, fontWeight: '800' }, statLabel: { color: '#95a4ba', fontSize: 9, marginTop: 4, fontWeight: '700' },
  note: { color: '#d6a77f', fontSize: 10, lineHeight: 15, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 8, marginVertical: 14 }, primary: { flex: 1, backgroundColor: '#ed7625', borderRadius: 11, padding: 13, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 12 }, secondary: { borderColor: '#53627a', borderWidth: 1, borderRadius: 11, padding: 13 }, secondaryText: { color: '#dce4f1', fontWeight: '700', fontSize: 12 },
  card: { backgroundColor: '#192438', borderColor: '#2d3e57', borderWidth: 1, borderRadius: 16, padding: 15, marginTop: 12 },
  section: { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 12 },
  point: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#34445b' },
  marker: { width: 25, height: 25, borderRadius: 13, backgroundColor: '#58351f', alignItems: 'center', justifyContent: 'center' },
  markerText: { color: '#ffad73', fontSize: 11, fontWeight: '800' }, pointType: { color: '#ffad73', fontSize: 9, fontWeight: '800' },
  pointName: { color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 2 }, link: { color: '#ffad73', fontSize: 11, fontWeight: '700' },
  day: { borderTopWidth: 1, borderTopColor: '#34445b', paddingVertical: 11 }, dayTitle: { color: '#fff', fontWeight: '700', fontSize: 13 },
  error: { color: '#ff9999', marginTop: 12 }, footer: { color: '#7f8da3', fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 18 },
});
