import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, RidePalette } from '../../src/theme';

type Trip = {
  id: string; name: string; description?: string | null; origin: string; destination: string;
  status: string; trip_type?: string; start_date?: string | null; end_date?: string | null;
  estimated_distance_meters?: number | null; estimated_duration_seconds?: number | null;
  ride_code: string; admin_id: string; route_deviation_threshold_meters: number; rider_behind_threshold_meters: number;
};
type Waypoint = { id: string; sequence: number; waypoint_type: string; name: string; address?: string; latitude: number; longitude: number; notes?: string; trip_day_id?: string | null };
type Day = { id: string; day_number: number; trip_date?: string; title?: string; notes?: string };
type Regroup = { id: string; name: string; latitude: number; longitude: number; sequence: number; target_arrival: string | null; notes: string | null; arrived_count: number; my_arrived: boolean };
type Rider = { user_id: string; display_name: string; role: 'leader' | 'sweep' | 'rider'; is_active: boolean; last_seen: string | null };
type Stay = { id: string; name: string; stay_type: string; address?: string; check_in?: string; check_out?: string; price_amount?: number; price_currency: string; trip_day_id?: string | null };

export default function TripWorkspaceScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const theme = useRideTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [stays, setStays] = useState<Stay[]>([]);
  const [roster, setRoster] = useState<Rider[]>([]);
  const [now, setNow] = useState(Date.now());
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'rider' | 'sweep'>('rider');
  const [regroupPoints, setRegroupPoints] = useState<Regroup[]>([]);
  const [deviationLimit, setDeviationLimit] = useState('500');
  const [behindLimit, setBehindLimit] = useState('1000');
  const [regroupName, setRegroupName] = useState('');
  const [regroupLat, setRegroupLat] = useState('');
  const [regroupLng, setRegroupLng] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [stayName, setStayName] = useState('');
  const [stayAddress, setStayAddress] = useState('');
  const [stayDay, setStayDay] = useState('1');
  const [stayCheckIn, setStayCheckIn] = useState('');
  const [stayCheckOut, setStayCheckOut] = useState('');
  const [stayPrice, setStayPrice] = useState('');

  const isAdmin = !!user && trip?.admin_id === user.id;
  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!id) return;
    setLoading(true); setError('');
    try {
      const [tripResult, waypointResult, dayResult, stayResult, rosterResult, regroupResult] = await Promise.all([
        supabase.from('rides').select('*').eq('id', id).single(),
        supabase.from('trip_waypoints').select('*').eq('ride_id', id).order('sequence'),
        supabase.from('trip_days').select('*').eq('ride_id', id).order('day_number'),
        supabase.from('trip_stays').select('*').eq('ride_id', id).order('check_in'),
        supabase.rpc('get_trip_roster', { p_ride_id: id }),
        supabase.rpc('get_regroup_points', { p_ride_id: id }),
      ]);
      if (generation !== loadGeneration.current) return;
      if (tripResult.error) throw tripResult.error;
      if (waypointResult.error) throw waypointResult.error;
      if (dayResult.error) throw dayResult.error;
      if (stayResult.error) throw stayResult.error;
      if (rosterResult.error) throw rosterResult.error;
      if (regroupResult.error) throw regroupResult.error;
      setTrip(tripResult.data as Trip);
      setWaypoints((waypointResult.data || []) as Waypoint[]);
      setDays((dayResult.data || []) as Day[]);
      setStays((stayResult.data || []) as Stay[]);
      setRoster((rosterResult.data || []) as Rider[]);
      setRegroupPoints((regroupResult.data || []) as Regroup[]);
      setDeviationLimit(String((tripResult.data as Trip).route_deviation_threshold_meters || 500));
      setBehindLimit(String((tripResult.data as Trip).rider_behind_threshold_meters || 1000));
    } catch (e: any) { if (generation === loadGeneration.current) setError(e?.message || 'Could not load this trip.'); }
    finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); return () => { ++loadGeneration.current; }; }, [load]));
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);

  async function openDirections(point: Waypoint) {
    const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(point.latitude + ',' + point.longitude);
    await Linking.openURL(url);
  }
  function moveWaypoint(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= waypoints.length) return;
    setWaypoints(current => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((point, sequence) => ({ ...point, sequence }));
    });
  }
  function assignWaypointDay(pointId: string, dayNumber: number | null) {
    const dayId = days.find(day => day.day_number === dayNumber)?.id || null;
    setWaypoints(current => current.map(point => point.id === pointId ? { ...point, trip_day_id: dayId } : point));
  }
  async function saveItinerary() {
    setSaving(true); setError('');
    try {
      const payload = waypoints.map((point, sequence) => ({
        id: point.id, sequence,
        day_number: days.find(day => day.id === point.trip_day_id)?.day_number ?? null,
      }));
      const { error: saveError } = await supabase.rpc('save_trip_itinerary', { p_ride_id: id, p_waypoints: payload });
      if (saveError) throw saveError;
      await load();
      Alert.alert('Itinerary saved', 'Stop order and day assignments have been updated.');
    } catch (e: any) { setError(e?.message || 'Could not save itinerary.'); }
    finally { setSaving(false); }
  }
  async function saveSafetySettings() {
    const deviation = Number(deviationLimit), behind = Number(behindLimit);
    if (!Number.isInteger(deviation) || deviation < 50 || deviation > 5000 || !Number.isInteger(behind) || behind < 100 || behind > 10000) {
      Alert.alert('Invalid thresholds', 'Route deviation must be 50–5000 m and rider-behind distance 100–10000 m.'); return;
    }
    setSaving(true); setError('');
    try {
      const { error: saveError } = await supabase.rpc('update_group_safety_settings', {
        p_ride_id: id, p_route_deviation_meters: deviation, p_rider_behind_meters: behind,
      });
      if (saveError) throw saveError;
      await load();
      Alert.alert('Safety settings saved', 'Group alert thresholds were updated.');
    } catch (e: any) { setError(e?.message || 'Could not save safety settings.'); }
    finally { setSaving(false); }
  }
  async function addRegroupPoint() {
    const lat = Number(regroupLat), lng = Number(regroupLng);
    if (!regroupName.trim() || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      Alert.alert('Invalid regroup point', 'Enter a name and valid latitude/longitude coordinates.'); return;
    }
    setSaving(true); setError('');
    try {
      const { error: addError } = await supabase.rpc('add_regroup_point', {
        p_ride_id: id, p_name: regroupName.trim(), p_latitude: lat, p_longitude: lng,
        p_sequence: regroupPoints.length,
      });
      if (addError) throw addError;
      setRegroupName(''); setRegroupLat(''); setRegroupLng('');
      await load();
    } catch (e: any) { setError(e?.message || 'Could not add regroup point.'); }
    finally { setSaving(false); }
  }
  async function confirmArrival(point: Regroup) {
    setSaving(true); setError('');
    try {
      const { error: confirmError } = await supabase.rpc('confirm_regroup_arrival', { p_regroup_point_id: point.id });
      if (confirmError) throw confirmError;
      await load();
    } catch (e: any) { setError(e?.message || 'Could not confirm arrival.'); }
    finally { setSaving(false); }
  }
  async function inviteRider() {
    setSaving(true); setError('');
    try {
      const { data, error: inviteError } = await supabase.rpc('create_trip_invitation', {
        p_ride_id: id, p_email: inviteEmail.trim() || null, p_role: inviteRole, p_expires_in_hours: 72,
      });
      if (inviteError) throw inviteError;
      const invitation = Array.isArray(data) ? data[0] : data;
      if (!invitation?.invitation_token) throw new Error('Invitation was created but no token was returned.');
      await Share.share({ message: 'You are invited to join ' + trip?.name + ' on RideNTrack. Invitation token: ' + invitation.invitation_token + '. It expires at ' + invitation.expires_at + '. Open RideNTrack → Join a Group Ride → Accept trip invitation.' });
      setInviteEmail('');
      await load();
    } catch (e: any) { setError(e?.message || 'Could not create invitation.'); }
    finally { setSaving(false); }
  }
  async function changeRole(rider: Rider, role: 'sweep' | 'rider') {
    setSaving(true); setError('');
    try {
      const { error: roleError } = await supabase.rpc('set_trip_participant_role', { p_ride_id: id, p_user_id: rider.user_id, p_role: role });
      if (roleError) throw roleError;
      await load();
    } catch (e: any) { setError(e?.message || 'Could not update rider role.'); }
    finally { setSaving(false); }
  }
  async function addStay() {
    if (!stayName.trim()) { Alert.alert('Stay name required', 'Enter the accommodation name.'); return; }
    if (stayPrice.trim() && (!Number.isFinite(Number(stayPrice)) || Number(stayPrice) < 0)) {
      Alert.alert('Invalid price', 'Enter a non-negative amount.'); return;
    }
    if (stayCheckIn && stayCheckOut && stayCheckOut < stayCheckIn) {
      Alert.alert('Invalid dates', 'Check-out must be on or after check-in.'); return;
    }
    setSaving(true); setError('');
    try {
      const { error: addError } = await supabase.rpc('add_trip_stay', {
        p_ride_id: id,
        p_stay: {
          name: stayName.trim(), address: stayAddress.trim() || null,
          day_number: stayDay ? Number(stayDay) : null,
          check_in: stayCheckIn || null, check_out: stayCheckOut || null,
          price_amount: stayPrice ? Number(stayPrice) : null, price_currency: 'INR',
          stay_type: 'hotel',
        },
      });
      if (addError) throw addError;
      setStayName(''); setStayAddress(''); setStayCheckIn(''); setStayCheckOut(''); setStayPrice('');
      await load();
      Alert.alert('Accommodation added', 'The stay has been added to this trip.');
    } catch (e: any) { setError(e?.message || 'Could not add accommodation.'); }
    finally { setSaving(false); }
  }

  const distance = trip?.estimated_distance_meters ? (trip.estimated_distance_meters / 1000).toFixed(0) + ' km' : 'Pending';
  const duration = trip?.estimated_duration_seconds ? Math.round(trip.estimated_duration_seconds / 3600) + ' hr map estimate' : 'Pending';

  if (loading && !trip) return <View style={styles.center}><ActivityIndicator color="#ff8a32" /><Text style={styles.muted}>Loading trip workspace…</Text></View>;
  if (!trip) return <View style={styles.center}><Text style={styles.title}>Trip unavailable</Text><Text style={styles.muted}>{error || 'You may not have access to this trip.'}</Text><TouchableOpacity onPress={() => router.back()}><Text style={styles.link}>Go back</Text></TouchableOpacity></View>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#ff8a32" />}>
      <Text style={styles.eyebrow}>TRIP WORKSPACE · {trip.status.toUpperCase()}</Text>
      <Text style={styles.title}>{trip.name}</Text>
      {!!trip.description && <Text style={styles.muted}>{trip.description}</Text>}
      <View style={styles.hero}>
        <Text style={styles.route}>{trip.origin}</Text><Text style={styles.arrow}>↓</Text><Text style={styles.route}>{trip.destination}</Text>
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
        <Text style={styles.section}>Regroup points · {regroupPoints.length}</Text>
        {regroupPoints.map(point => <View key={point.id} style={styles.riderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pointName}>{point.name}</Text>
            <Text style={styles.mutedSmall}>{point.latitude.toFixed(5)}, {point.longitude.toFixed(5)} · {point.arrived_count}/{roster.length} arrived</Text>
          </View>
          <TouchableOpacity style={styles.smallButton} disabled={saving || point.my_arrived} onPress={() => void confirmArrival(point)}>
            <Text style={styles.smallButtonText}>{point.my_arrived ? 'Arrived ✓' : 'Confirm arrival'}</Text>
          </TouchableOpacity>
        </View>)}
        {isAdmin && <>
          <Text style={styles.label}>Add regroup point (coordinates)</Text>
          <TextInput style={styles.input} value={regroupName} onChangeText={setRegroupName} placeholder="Meetup / regroup location" placeholderTextColor="#77809a" />
          <View style={styles.editorRow}>
            <TextInput style={[styles.input,{flex:1}]} value={regroupLat} onChangeText={setRegroupLat} keyboardType="decimal-pad" placeholder="Latitude" placeholderTextColor="#77809a" />
            <TextInput style={[styles.input,{flex:1}]} value={regroupLng} onChangeText={setRegroupLng} keyboardType="decimal-pad" placeholder="Longitude" placeholderTextColor="#77809a" />
          </View>
          <TouchableOpacity style={styles.primaryWide} disabled={saving} onPress={() => void addRegroupPoint()}><Text style={styles.primaryText}>Add regroup point</Text></TouchableOpacity>
          <Text style={styles.label}>Route deviation alert threshold (metres)</Text>
          <TextInput style={styles.input} value={deviationLimit} onChangeText={setDeviationLimit} keyboardType="number-pad" />
          <Text style={styles.label}>Rider-behind alert threshold (metres)</Text>
          <TextInput style={styles.input} value={behindLimit} onChangeText={setBehindLimit} keyboardType="number-pad" />
          <TouchableOpacity style={styles.primaryWide} disabled={saving} onPress={() => void saveSafetySettings()}><Text style={styles.primaryText}>Save safety thresholds</Text></TouchableOpacity>
        </>}
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Group ride control · {roster.length} riders</Text>
        {roster.map(rider => {
          const age = rider.last_seen ? now - Date.parse(rider.last_seen) : Number.POSITIVE_INFINITY;
          const status = !rider.last_seen ? 'OFFLINE' : age > 120000 ? 'OFFLINE' : age > 30000 ? 'STALE' : 'LIVE';
          return <View key={rider.user_id} style={styles.riderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pointName}>{rider.display_name}{rider.user_id === user?.id ? ' · you' : ''}</Text>
              <Text style={styles.mutedSmall}>{rider.role.toUpperCase()} · {status}{rider.last_seen ? ' · seen ' + new Date(rider.last_seen).toLocaleTimeString() : ' · no GPS update yet'}</Text>
            </View>
            {isAdmin && rider.user_id !== user?.id && <TouchableOpacity style={styles.smallButton} disabled={saving}
              onPress={() => void changeRole(rider, rider.role === 'sweep' ? 'rider' : 'sweep')}>
              <Text style={styles.smallButtonText}>{rider.role === 'sweep' ? 'Make rider' : 'Assign sweep'}</Text>
            </TouchableOpacity>}
          </View>;
        })}
        {isAdmin && <>
          <Text style={styles.label}>Invite by email (optional)</Text>
          <TextInput style={styles.input} value={inviteEmail} onChangeText={setInviteEmail} keyboardType="email-address" autoCapitalize="none" placeholder="rider@example.com" placeholderTextColor="#77809a" />
          <View style={styles.editorRow}>
            <TouchableOpacity style={[styles.smallButton, inviteRole === 'rider' && styles.roleSelected]} onPress={() => setInviteRole('rider')}><Text style={styles.smallButtonText}>Rider</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.smallButton, inviteRole === 'sweep' && styles.roleSelected]} onPress={() => setInviteRole('sweep')}><Text style={styles.smallButtonText}>Sweep</Text></TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.primaryWide} disabled={saving} onPress={() => void inviteRider()}><Text style={styles.primaryText}>{saving ? 'Please wait…' : 'Create & share 72-hour invitation'}</Text></TouchableOpacity>
        </>}
        <Text style={styles.mutedSmall}>GPS status is based on the latest saved location: live ≤30 seconds, stale 30–120 seconds, offline/no recent update after 2 minutes. A missing GPS update is not proof that a rider has left the group.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Route & itinerary</Text>
        {waypoints.map((point, index) => {
          const assignedDay = days.find(day => day.id === point.trip_day_id);
          return <View key={point.id} style={styles.point}>
            <View style={styles.marker}><Text style={styles.markerText}>{index + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pointType}>{point.waypoint_type.toUpperCase()}</Text>
              <Text style={styles.pointName}>{point.name}</Text>
              {!!point.address && <Text style={styles.mutedSmall}>{point.address}</Text>}
              <TouchableOpacity onPress={() => void openDirections(point)}><Text style={styles.link}>Open map ↗</Text></TouchableOpacity>
              {isAdmin && <View style={styles.editorRow}>
                <TouchableOpacity style={styles.smallButton} disabled={index === 0} onPress={() => moveWaypoint(index, -1)}><Text style={styles.smallButtonText}>↑</Text></TouchableOpacity>
                <TouchableOpacity style={styles.smallButton} disabled={index === waypoints.length - 1} onPress={() => moveWaypoint(index, 1)}><Text style={styles.smallButtonText}>↓</Text></TouchableOpacity>
                <TouchableOpacity style={styles.smallButton} onPress={() => {
                  const current = assignedDay?.day_number || 0;
                  const next = current >= days.length ? null : current + 1;
                  assignWaypointDay(point.id, next);
                }}><Text style={styles.smallButtonText}>{assignedDay ? 'Day ' + assignedDay.day_number : 'Unassigned'} · change</Text></TouchableOpacity>
              </View>}
            </View>
          </View>;
        })}
        {isAdmin && <TouchableOpacity style={styles.primaryWide} disabled={saving} onPress={() => void saveItinerary()}><Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save stop order & days'}</Text></TouchableOpacity>}
        {!isAdmin && <Text style={styles.mutedSmall}>Only the trip admin can edit the itinerary.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Day-by-day plan</Text>
        {days.length === 0 ? <Text style={styles.muted}>No dated itinerary days were created for this trip.</Text> : days.map(day => (
          <View key={day.id} style={styles.day}>
            <Text style={styles.dayTitle}>{day.title || 'Day ' + day.day_number}</Text>
            <Text style={styles.mutedSmall}>{day.trip_date || 'Date not set'}</Text>
            {!!day.notes && <Text style={styles.mutedSmall}>{day.notes}</Text>}
            <Text style={styles.mutedSmall}>{waypoints.filter(point => point.trip_day_id === day.id).length} planned stops · {stays.filter(stay => stay.trip_day_id === day.id).length} stays</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Accommodation · {stays.length} stays</Text>
        {stays.length === 0 ? <Text style={styles.muted}>No accommodation added yet.</Text> : stays.map(stay => (
          <View key={stay.id} style={styles.day}>
            <Text style={styles.pointName}>{stay.name}</Text>
            <Text style={styles.mutedSmall}>{stay.stay_type} · {stay.check_in || 'Check-in TBD'} – {stay.check_out || 'Check-out TBD'}</Text>
            {!!stay.address && <Text style={styles.mutedSmall}>{stay.address}</Text>}
            {stay.price_amount != null ? <Text style={styles.mutedSmall}>{new Intl.NumberFormat(undefined, { style: 'currency', currency: stay.price_currency }).format(stay.price_amount)}</Text> : null}
          </View>
        ))}
        {isAdmin && <>
          <Text style={styles.label}>Add another stay</Text>
          <TextInput style={styles.input} value={stayName} onChangeText={setStayName} placeholder="Accommodation name" placeholderTextColor="#77809a" />
          <TextInput style={styles.input} value={stayAddress} onChangeText={setStayAddress} placeholder="Address (optional)" placeholderTextColor="#77809a" />
          <Text style={styles.label}>Trip day number (1–{Math.max(days.length, 1)})</Text>
          <TextInput style={styles.input} value={stayDay} onChangeText={setStayDay} keyboardType="number-pad" placeholder="1" placeholderTextColor="#77809a" />
          <TextInput style={styles.input} value={stayCheckIn} onChangeText={setStayCheckIn} placeholder="Check-in YYYY-MM-DD" placeholderTextColor="#77809a" />
          <TextInput style={styles.input} value={stayCheckOut} onChangeText={setStayCheckOut} placeholder="Check-out YYYY-MM-DD" placeholderTextColor="#77809a" />
          <TextInput style={styles.input} value={stayPrice} onChangeText={setStayPrice} keyboardType="decimal-pad" placeholder="Price in INR (optional)" placeholderTextColor="#77809a" />
          <TouchableOpacity style={styles.primaryWide} disabled={saving} onPress={() => void addStay()}><Text style={styles.primaryText}>{saving ? 'Saving…' : 'Add accommodation'}</Text></TouchableOpacity>
        </>}
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Text style={styles.footer}>Trip planning is separate from the actual GPS session. Starting the tracker records what happened, while this workspace keeps the planned journey.</Text>
    </ScrollView>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background }, content: { padding: 18, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  eyebrow: { color: c.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: c.text, fontSize: 32, fontWeight: '900', letterSpacing: -0.8, marginTop: 7 },
  muted: { color: c.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  mutedSmall: { color: c.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  label: { color: c.text, fontSize: 11, fontWeight: '700', marginTop: 10, marginBottom: 5 },
  input: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 7, padding: 11, color: c.text, marginTop: 7, fontSize: 13 },
  hero: { backgroundColor: c.surface, borderRadius: 10, borderWidth: 1, borderColor: c.border, padding: 17, marginTop: 18 },
  route: { color: c.text, fontSize: 16, fontWeight: '700' }, arrow: { color: c.accent, fontSize: 20, marginVertical: 4 },
  stats: { flexDirection: 'row', gap: 28, marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.border },
  statValue: { color: c.text, fontSize: 17, fontWeight: '800' }, statLabel: { color: '#95a4ba', fontSize: 9, marginTop: 4, fontWeight: '700' },
  note: { color: c.accent, fontSize: 10, lineHeight: 15, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 8, marginVertical: 14 }, primary: { flex: 1, backgroundColor: c.accent, borderRadius: 7, padding: 13, alignItems: 'center' },
  primaryWide: { backgroundColor: c.accent, borderRadius: 11, padding: 13, alignItems: 'center', marginTop: 14 },
  primaryText: { color: c.text, fontWeight: '800', fontSize: 12 }, secondary: { borderColor: c.border, borderWidth: 1, borderRadius: 11, padding: 13 }, secondaryText: { color: c.text, fontWeight: '700', fontSize: 12 },
  card: { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 9, padding: 15, marginTop: 12 },
  section: { color: c.text, fontSize: 17, fontWeight: '800', marginBottom: 12 },
  point: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 11, borderTopWidth: 1, borderTopColor: c.border },
  marker: { width: 25, height: 25, borderRadius: 13, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  markerText: { color: c.accent, fontSize: 11, fontWeight: '800' }, pointType: { color: c.accent, fontSize: 9, fontWeight: '800' },
  pointName: { color: c.text, fontSize: 13, fontWeight: '700', marginTop: 2 }, link: { color: c.accent, fontSize: 11, fontWeight: '700' },
  editorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  smallButton: { borderWidth: 1, borderColor: c.border, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 6 },
  smallButtonText: { color: c.accent, fontSize: 10, fontWeight: '700' },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border },
  roleSelected: { borderColor: c.accent, backgroundColor: c.accentSoft },
  day: { borderTopWidth: 1, borderTopColor: c.border, paddingVertical: 11 }, dayTitle: { color: c.text, fontWeight: '700', fontSize: 13 },
  error: { color: c.danger, marginTop: 12 }, footer: { color: c.subtle, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 18 },
});
