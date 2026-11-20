import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { buildGoogleMapsNavigationUrl, type TripStage, type StageStatus, calculateMotorcycleFuelPlan, generateTouringAdvisories, getWeatherConditionFromCode, type RouteWeatherPoint, type TripJournalEntry, type JournalPhoto, formatShareableRideCard } from '@ridentrack/shared';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, RidePalette } from '../../src/theme';

type Trip = {
  id: string; name: string; description?: string | null; origin: string; destination: string;
  origin_coords?: [number, number] | null; destination_coords?: [number, number] | null;
  status: string; trip_type?: string; start_date?: string | null; end_date?: string | null;
  estimated_distance_meters?: number | null; estimated_duration_seconds?: number | null;
  ride_code: string; admin_id: string; route_deviation_threshold_meters: number; rider_behind_threshold_meters: number;
};
type Waypoint = { id: string; sequence: number; waypoint_type: string; name: string; address?: string; latitude: number; longitude: number; provider_place_id?: string | null; notes?: string; trip_day_id?: string | null };
type Day = { id: string; day_number: number; trip_date?: string; title?: string; notes?: string };
type Regroup = { id: string; name: string; latitude: number; longitude: number; sequence: number; target_arrival: string | null; notes: string | null; arrived_count: number; my_arrived: boolean };
type Rider = { user_id: string; display_name: string; role: 'leader' | 'sweep' | 'rider'; is_active: boolean; last_seen: string | null };
type Stay = { id: string; name: string; stay_type: string; address?: string; check_in?: string; check_out?: string; price_amount?: number; price_currency: string; trip_day_id?: string | null };

export default function TripWorkspaceScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user, profile } = useAuth();
  const theme = useRideTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [stays, setStays] = useState<Stay[]>([]);
  const [stages, setStages] = useState<TripStage[]>([]);
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
  const [editTripVisible, setEditTripVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Stage modal state
  const [stageModalVisible, setStageModalVisible] = useState(false);
  const [stageName, setStageName] = useState('');
  const [stageStart, setStageStart] = useState('');
  const [stageDestination, setStageDestination] = useState('');
  const [stageStartCoords, setStageStartCoords] = useState('');
  const [stageDestCoords, setStageDestCoords] = useState('');
  const [stageDayNumber, setStageDayNumber] = useState('1');
  const [stageNotes, setStageNotes] = useState('');

  const [journalEntry, setJournalEntry] = useState<TripJournalEntry | null>(null);
  const [journalModalVisible, setJournalModalVisible] = useState(false);
  const [journalTitle, setJournalTitle] = useState('');
  const [journalNotes, setJournalNotes] = useState('');
  const [journalHighlights, setJournalHighlights] = useState('');
  const [journalRating, setJournalRating] = useState('5');
  const [journalPhotoUrl, setJournalPhotoUrl] = useState('');
  const [journalPhotoCaption, setJournalPhotoCaption] = useState('');
  const [journalPhotos, setJournalPhotos] = useState<JournalPhoto[]>([]);

  const [weatherPoints, setWeatherPoints] = useState<RouteWeatherPoint[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(false);

  useEffect(() => {
    if (!trip) return;
    let cancelled = false;
    async function fetchWeather() {
      const pointsToFetch: Array<{ label: string; coords: [number, number] }> = [];
      if (trip?.origin_coords && trip.origin_coords.length === 2 && Number.isFinite(trip.origin_coords[0]) && Number.isFinite(trip.origin_coords[1])) {
        pointsToFetch.push({ label: trip.origin || 'Start', coords: trip.origin_coords });
      }
      if (trip?.destination_coords && trip.destination_coords.length === 2 && Number.isFinite(trip.destination_coords[0]) && Number.isFinite(trip.destination_coords[1])) {
        pointsToFetch.push({ label: trip.destination || 'Destination', coords: trip.destination_coords });
      }
      if (pointsToFetch.length === 0) return;
      setWeatherLoading(true);
      try {
        const results: RouteWeatherPoint[] = [];
        for (const pt of pointsToFetch) {
          const [lng, lat] = pt.coords;
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`;
          const res = await fetch(url);
          if (!res.ok) continue;
          const json = await res.json();
          if (json?.current) {
            const cond = getWeatherConditionFromCode(json.current.weather_code);
            results.push({
              label: pt.label,
              latitude: lat,
              longitude: lng,
              temperatureC: json.current.temperature_2m,
              humidityPercent: json.current.relative_humidity_2m,
              windSpeedKmh: json.current.wind_speed_10m,
              weatherCode: json.current.weather_code,
              condition: cond.condition,
              icon: cond.icon,
              retrievedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              source: 'Open-Meteo API',
            });
          }
        }
        if (!cancelled) setWeatherPoints(results);
      } catch {
        /* Ignore network weather failures */
      } finally {
        if (!cancelled) setWeatherLoading(false);
      }
    }
    void fetchWeather();
    return () => { cancelled = true; };
  }, [trip?.origin_coords, trip?.destination_coords, trip?.origin, trip?.destination]);

  const fuelPlan = useMemo(() => {
    const distMeters = trip?.estimated_distance_meters || 0;
    return calculateMotorcycleFuelPlan(distMeters, {
      make: profile?.motorcycle_make,
      model: profile?.motorcycle_model,
      category: profile?.motorcycle_category,
      fuelTankCapacityLiters: profile?.fuel_tank_capacity_liters,
      mileageKmPerLiter: profile?.mileage_km_per_liter,
      fuelReserveLiters: profile?.fuel_reserve_liters,
    });
  }, [trip?.estimated_distance_meters, profile]);

  const advisories = useMemo(() => {
    return generateTouringAdvisories({
      distanceMeters: trip?.estimated_distance_meters || 0,
      fuelPlan,
      weatherPoints,
    });
  }, [trip?.estimated_distance_meters, fuelPlan, weatherPoints]);

  const isAdmin = !!user && trip?.admin_id === user.id;
  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!id) return;
    setLoading(true); setError('');
    try {
      const [tripResult, waypointResult, dayResult, stayResult, rosterResult, regroupResult, stageResult] = await Promise.all([
        supabase.from('rides').select('*').eq('id', id).single(),
        supabase.from('trip_waypoints').select('*').eq('ride_id', id).order('sequence'),
        supabase.from('trip_days').select('*').eq('ride_id', id).order('day_number'),
        supabase.from('trip_stays').select('*').eq('ride_id', id).order('check_in'),
        supabase.rpc('get_trip_roster', { p_ride_id: id }),
        supabase.rpc('get_regroup_points', { p_ride_id: id }),
        supabase.rpc('get_trip_stages', { p_ride_id: id }),
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
      setStages((stageResult.data || []) as TripStage[]);
      setRoster((rosterResult.data || []) as Rider[]);
      setRegroupPoints((regroupResult.data || []) as Regroup[]);
      setDeviationLimit(String((tripResult.data as Trip).route_deviation_threshold_meters || 500));
      setBehindLimit(String((tripResult.data as Trip).rider_behind_threshold_meters || 1000));
      if (user?.id) {
        const { data: entry } = await supabase
          .from('trip_journal_entries')
          .select('*')
          .eq('ride_id', id)
          .eq('user_id', user.id)
          .maybeSingle();
        if (generation === loadGeneration.current && entry) {
          setJournalEntry(entry as TripJournalEntry);
        }
      }
    } catch (e: any) { if (generation === loadGeneration.current) setError(e?.message || 'Could not load this trip.'); }
    finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [id, user?.id]);

  useFocusEffect(useCallback(() => { void load(); return () => { ++loadGeneration.current; }; }, [load]));
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);

  function openJournalEditor() {
    setJournalTitle(journalEntry?.title || trip?.name || 'Motorcycle Tour');
    setJournalNotes(journalEntry?.notes || '');
    setJournalHighlights(journalEntry?.highlights || '');
    setJournalRating(journalEntry?.rating != null ? String(journalEntry.rating) : '5');
    setJournalPhotos(Array.isArray(journalEntry?.photos) ? journalEntry.photos : []);
    setJournalPhotoUrl('');
    setJournalPhotoCaption('');
    setJournalModalVisible(true);
  }

  function addPhotoToJournal() {
    if (!journalPhotoUrl.trim()) {
      Alert.alert('Photo URL required', 'Enter a valid image URL.');
      return;
    }
    setJournalPhotos(prev => [...prev, {
      url: journalPhotoUrl.trim(),
      caption: journalPhotoCaption.trim() || undefined,
      taken_at: new Date().toISOString(),
    }]);
    setJournalPhotoUrl('');
    setJournalPhotoCaption('');
  }

  async function saveJournal() {
    if (!journalTitle.trim()) {
      Alert.alert('Title required', 'Please enter a title for your journal entry.');
      return;
    }
    setSaving(true);
    try {
      const { error: saveError } = await supabase.rpc('save_trip_journal_entry', {
        p_ride_id: id,
        p_title: journalTitle.trim(),
        p_notes: journalNotes.trim() || null,
        p_highlights: journalHighlights.trim() || null,
        p_rating: Number(journalRating) || 5,
        p_photos: journalPhotos,
      });
      if (saveError) throw saveError;
      setJournalModalVisible(false);
      await load();
      Alert.alert('Journal saved', 'Your touring recollections and photos have been preserved.');
    } catch (e: any) {
      Alert.alert('Could not save journal', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function shareRideCard() {
    if (!trip) return;
    const distKm = Math.round(((trip.estimated_distance_meters || 0) / 1000) * 10) / 10;
    const cardText = formatShareableRideCard({
      tripName: trip.name,
      riderName: profile?.display_name || user?.email || 'Rider',
      machine: profile?.motorcycle_make ? `${profile.motorcycle_make} ${profile.motorcycle_model || ''}` : undefined,
      distanceKm: distKm,
      origin: trip.origin,
      destination: trip.destination,
      stopsCount: waypoints.length,
      rating: journalEntry?.rating ?? 5,
      highlights: journalEntry?.highlights || (waypoints.length > 2 ? `${waypoints[1]?.name} and intermediate stops` : undefined),
    });
    try {
      await Share.share({ message: cardText });
    } catch {
      Alert.alert('Share error', 'Could not open sharing options.');
    }
  }

  function openTripEditor() {
    if (!trip) return;
    setEditName(trip.name || '');
    setEditDescription(trip.description || '');
    setEditTripVisible(true);
  }

  async function saveTripDetails() {
    if (!editName.trim()) { Alert.alert('Trip name required', 'Enter a name for this trip.'); return; }
    setSaving(true); setError('');
    try {
      const { error: updateError } = await supabase.from('rides').update({
        name: editName.trim(), description: editDescription.trim() || null,
      }).eq('id', id);
      if (updateError) throw updateError;
      setEditTripVisible(false);
      await load();
      Alert.alert('Trip updated', 'Your trip details have been saved.');
    } catch (e: any) {
      setError(e?.message || 'Could not update trip details.');
    } finally { setSaving(false); }
  }

  function confirmDeleteTrip() {
    if (!trip || !isAdmin || saving) return;
    Alert.alert(
      'Delete this trip permanently?',
      '“' + trip.name + '” and its route, itinerary, invitations, regroup points and trip history will be deleted for everyone. This cannot be undone.',
      [
        { text: 'Keep trip', style: 'cancel' },
        { text: 'Delete permanently', style: 'destructive', onPress: () => { void deleteTrip(); } },
      ],
    );
  }

  async function deleteTrip() {
    if (!trip || !isAdmin) return;
    setSaving(true); setError('');
    try {
      const { error: deleteError } = await supabase.rpc('delete_trip', { p_ride_id: id });
      if (deleteError) throw deleteError;
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e?.message || 'Could not delete this trip.');
      setSaving(false);
    }
  }

  function confirmLeaveRide() {
    if (!trip || isAdmin || saving) return;
    Alert.alert(
      'Leave this group ride?',
      'You will no longer share your live location or receive regroup and separation alerts for “' + trip.name + '”. You can rejoin later if you have an invitation code.',
      [
        { text: 'Stay in ride', style: 'cancel' },
        { text: 'Leave ride', style: 'destructive', onPress: () => { void leaveRide(); } },
      ],
    );
  }

  async function leaveRide() {
    if (!trip || isAdmin) return;
    setSaving(true); setError('');
    try {
      const { error: leaveError } = await supabase.rpc('leave_ride', { p_ride_id: id });
      if (leaveError) throw leaveError;
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e?.message || 'Could not leave this ride.');
      setSaving(false);
    }
  }

  function openCreateStage(dayNum?: number) {
    setStageName('');
    setStageStart(trip?.origin || '');
    setStageDestination(trip?.destination || '');
    setStageStartCoords(Array.isArray(trip?.origin_coords) ? trip.origin_coords.join(', ') : '77.5946, 12.9716');
    setStageDestCoords(Array.isArray(trip?.destination_coords) ? trip.destination_coords.join(', ') : '78.0, 13.0');
    setStageDayNumber(String(dayNum || 1));
    setStageNotes('');
    setStageModalVisible(true);
  }

  async function saveStage() {
    if (!stageName.trim() || !stageStart.trim() || !stageDestination.trim()) {
      Alert.alert('Missing stage details', 'Enter a stage title, start location and destination.');
      return;
    }
    const startPairs = stageStartCoords.split(',').map(s => Number(s.trim()));
    const destPairs = stageDestCoords.split(',').map(s => Number(s.trim()));
    if (startPairs.length < 2 || !Number.isFinite(startPairs[0]) || !Number.isFinite(startPairs[1]) ||
        destPairs.length < 2 || !Number.isFinite(destPairs[0]) || !Number.isFinite(destPairs[1])) {
      Alert.alert('Invalid coordinates', 'Enter coordinates as: longitude, latitude (e.g. 77.5946, 12.9716)');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { error: stageError } = await supabase.rpc('save_trip_stage', {
        p_ride_id: id,
        p_stage: {
          name: stageName.trim(),
          start_name: stageStart.trim(),
          destination_name: stageDestination.trim(),
          start_coords: [startPairs[0], startPairs[1]],
          destination_coords: [destPairs[0], destPairs[1]],
          day_number: Number(stageDayNumber) || 1,
          notes: stageNotes.trim() || null,
          status: 'planned',
        },
      });
      if (stageError) throw stageError;
      setStageModalVisible(false);
      await load();
      Alert.alert('Stage added', 'Riding stage has been saved to your itinerary.');
    } catch (e: any) {
      setError(e?.message || 'Could not save stage.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDeleteStage(stageId: string, name: string) {
    if (!isAdmin || saving) return;
    Alert.alert(
      'Delete stage?',
      `Remove stage “${name}” from this trip? Waypoints and other stages will be preserved.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const { error: delError } = await supabase.rpc('delete_trip_stage', {
                p_ride_id: id,
                p_stage_id: stageId,
              });
              if (delError) throw delError;
              await load();
            } catch (e: any) {
              setError(e?.message || 'Could not delete stage.');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  }

  async function cycleStageStatus(stage: TripStage) {
    const cycle: Record<StageStatus, StageStatus> = {
      planned: 'in_progress',
      in_progress: 'completed',
      completed: 'planned',
      skipped: 'planned',
    };
    const nextStatus = cycle[stage.status] || 'planned';
    setSaving(true);
    try {
      const { error: statusError } = await supabase.rpc('update_stage_status', {
        p_stage_id: stage.id,
        p_status: nextStatus,
      });
      if (statusError) throw statusError;
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not update stage status.');
    } finally {
      setSaving(false);
    }
  }

  async function shareItinerary() {
    if (!trip) return;
    const lines: string[] = [
      `🏍️ ${trip.name.toUpperCase()}`,
      `Route: ${trip.origin} → ${trip.destination}`,
      `Total Distance: ${distance} · ${duration}`,
    ];
    if (trip.description) lines.push(`Notes: ${trip.description}`);
    lines.push('');

    if (days.length > 0) {
      lines.push('📅 TOUR ITINERARY:');
      for (const day of days) {
        lines.push(`--- Day ${day.day_number}: ${day.title || 'Day ' + day.day_number} (${day.trip_date || 'Date TBD'}) ---`);
        if (day.notes) lines.push(`Note: ${day.notes}`);

        const dayStages = stages.filter(s => s.trip_day_id === day.id || s.day_number === day.day_number);
        if (dayStages.length > 0) {
          lines.push('Riding Stages:');
          for (const s of dayStages) {
            const distStr = s.estimated_distance_meters ? `${(s.estimated_distance_meters / 1000).toFixed(0)} km` : '';
            const statusIcon = s.status === 'completed' ? '✅' : s.status === 'in_progress' ? '🟡' : '⏳';
            lines.push(`  ${statusIcon} Stage ${s.stage_number}: ${s.name} (${s.start_name} → ${s.destination_name}${distStr ? ' · ' + distStr : ''})`);
            if (s.notes) lines.push(`     Memo: ${s.notes}`);
          }
        }

        const dayWaypoints = waypoints.filter(w => w.trip_day_id === day.id);
        if (dayWaypoints.length > 0) {
          lines.push('Planned Stops:');
          for (const w of dayWaypoints) {
            lines.push(`  • [${w.waypoint_type.toUpperCase()}] ${w.name}${w.notes ? ' — ' + w.notes : ''}`);
          }
        }
        lines.push('');
      }
    } else {
      lines.push('STOPS:');
      for (const w of waypoints) {
        lines.push(`  • [${w.waypoint_type.toUpperCase()}] ${w.name}${w.notes ? ' — ' + w.notes : ''}`);
      }
      lines.push('');
    }

    lines.push(`Join group ride on RideNTrack with code: ${trip.ride_code}`);
    lines.push('RideNTrack: Your journey. Your machine. Your adventure.');

    try {
      await Share.share({
        title: trip.name,
        message: lines.join('\n'),
      });
    } catch {
      /* Sharing was cancelled */
    }
  }

  async function openDirections(point: Waypoint) {
    try {
      const url = buildGoogleMapsNavigationUrl({
        latitude: point.latitude,
        longitude: point.longitude,
        placeId: point.provider_place_id,
      });
      await Linking.openURL(url);
    } catch (e: any) {
      Alert.alert('Could not open navigation', e?.message || 'Please check that a maps app is available and try again.');
    }
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
  function promptDayAssignment(point: Waypoint) {
    if (days.length === 0) {
      Alert.alert('No dated days', 'This trip does not have dated itinerary days yet.');
      return;
    }
    const buttons = [
      { text: 'Unassigned', onPress: () => assignWaypointDay(point.id, null) },
      ...days.map(day => ({
        text: `Day ${day.day_number}${day.title ? ': ' + day.title : ''}`,
        onPress: () => assignWaypointDay(point.id, day.day_number),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ];
    Alert.alert('Assign Day for ' + point.name, 'Choose which day of the trip this stop belongs to:', buttons);
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

  function renderStageCard(stage: TripStage) {
    const statusMeta = {
      planned: { label: 'Planned', color: theme.muted, icon: '⏳' },
      in_progress: { label: 'Riding', color: theme.accent, icon: '🟡' },
      completed: { label: 'Completed', color: theme.green, icon: '✅' },
      skipped: { label: 'Skipped', color: theme.subtle, icon: '⏭️' },
    }[stage.status] || { label: 'Planned', color: theme.muted, icon: '⏳' };

    const dist = stage.estimated_distance_meters ? `${(stage.estimated_distance_meters / 1000).toFixed(0)} km` : null;

    return (
      <View key={stage.id} style={styles.stageCard}>
        <View style={styles.stageHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.stageTitle}>Stage {stage.stage_number}: {stage.name}</Text>
            <Text style={styles.stageEndpoints}>{stage.start_name} → {stage.destination_name}</Text>
            {dist && <Text style={styles.stageMetaText}>{dist}</Text>}
          </View>
          <TouchableOpacity
            style={[styles.stageStatusPill, { borderColor: statusMeta.color }]}
            onPress={() => void cycleStageStatus(stage)}
          >
            <Text style={[styles.stageStatusText, { color: statusMeta.color }]}>
              {statusMeta.icon} {statusMeta.label}
            </Text>
          </TouchableOpacity>
        </View>
        {!!stage.notes && (
          <Text style={styles.stageNotes}>📝 {stage.notes}</Text>
        )}
        {isAdmin && (
          <View style={styles.stageActions}>
            <TouchableOpacity onPress={() => confirmDeleteStage(stage.id, stage.name)}>
              <Text style={styles.remove}>Remove stage</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

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
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.secondary, { flex: 1, alignItems: 'center' }]} onPress={() => void shareItinerary()}>
          <Text style={styles.secondaryText}>📤 Share touring itinerary</Text>
        </TouchableOpacity>
      </View>
      {isAdmin && <View style={styles.actions}>
        <TouchableOpacity style={styles.primary} onPress={() => router.push('/trip/' + trip.id + '/route')}><Text style={styles.primaryText}>✎ Edit route & stops</Text></TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={openTripEditor}><Text style={styles.secondaryText}>Trip details</Text></TouchableOpacity>
      </View>}
      {isAdmin && <TouchableOpacity style={styles.dangerButton} disabled={saving} onPress={confirmDeleteTrip}>
        <Text style={styles.dangerText}>{saving ? 'Please wait…' : 'Delete trip permanently'}</Text>
      </TouchableOpacity>}
      {!isAdmin && roster.some(r => r.user_id === user?.id && r.is_active) && (
        <TouchableOpacity style={styles.dangerButton} disabled={saving} onPress={confirmLeaveRide}>
          <Text style={styles.dangerText}>{saving ? 'Please wait…' : 'Leave group ride'}</Text>
        </TouchableOpacity>
      )}

      {/* Touring Intelligence & Fuel Planning */}
      <View style={styles.card}>
        <Text style={styles.section}>Touring Intelligence & Motorcycle Fuel</Text>

        <View style={styles.intelBlock}>
          <Text style={styles.intelTitle}>
            ⛽ Motorcycle Fuel Advisory · {profile?.motorcycle_model ? `${profile.motorcycle_make || ''} ${profile.motorcycle_model}` : 'Motorcycle'}
          </Text>
          <View style={styles.fuelRow}>
            <View style={styles.fuelStat}>
              <Text style={styles.fuelStatValue}>{fuelPlan.totalDistanceKm} km</Text>
              <Text style={styles.fuelStatLabel}>DISTANCE</Text>
            </View>
            <View style={styles.fuelStat}>
              <Text style={styles.fuelStatValue}>{fuelPlan.estimatedFuelConsumedLiters ? fuelPlan.estimatedFuelConsumedLiters + ' L' : '—'}</Text>
              <Text style={styles.fuelStatLabel}>EST. FUEL</Text>
            </View>
            <View style={styles.fuelStat}>
              <Text style={styles.fuelStatValue}>{fuelPlan.safeRangeKm ? fuelPlan.safeRangeKm + ' km' : '—'}</Text>
              <Text style={styles.fuelStatLabel}>SAFE RANGE</Text>
            </View>
            <View style={styles.fuelStat}>
              <Text style={styles.fuelStatValue}>{fuelPlan.recommendedFuelStops != null ? fuelPlan.recommendedFuelStops : '—'}</Text>
              <Text style={styles.fuelStatLabel}>REC. STOPS</Text>
            </View>
          </View>
          {fuelPlan.estimatedCostInr != null && (
            <Text style={styles.fuelCostText}>Estimated fuel expense: ~₹{fuelPlan.estimatedCostInr} (@ ₹105/L)</Text>
          )}
          <Text style={styles.mutedSmall}>{fuelPlan.advisoryNote}</Text>
        </View>

        <View style={[styles.intelBlock, { borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 14 }]}>
          <Text style={styles.intelTitle}>⛅ Route Weather Forecast</Text>
          {weatherLoading && weatherPoints.length === 0 ? (
            <ActivityIndicator size="small" color={theme.accent} style={{ marginVertical: 8 }} />
          ) : weatherPoints.length === 0 ? (
            <Text style={styles.mutedSmall}>Weather forecast will load when origin and destination coordinates are set.</Text>
          ) : (
            <View style={{ gap: 8, marginVertical: 6 }}>
              {weatherPoints.map(wp => (
                <View key={wp.label} style={styles.weatherCard}>
                  <Text style={{ fontSize: 24 }}>{wp.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pointName}>{wp.label}: {wp.condition}</Text>
                    <Text style={styles.mutedSmall}>
                      {wp.temperatureC}°C · Humidity {wp.humidityPercent}% · Wind {wp.windSpeedKmh} km/h
                    </Text>
                    <Text style={[styles.mutedSmall, { fontSize: 10 }]}>
                      Source: {wp.source} · Checked {wp.retrievedAt}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {advisories.length > 0 && (
          <View style={[styles.intelBlock, { borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 14 }]}>
            <Text style={styles.intelTitle}>⚠️ Touring Advisories & Safety</Text>
            {advisories.map((adv, idx) => (
              <View
                key={idx}
                style={[
                  styles.advisoryItem,
                  adv.level === 'warning' ? styles.advisoryWarning :
                  adv.level === 'caution' ? styles.advisoryCaution : styles.advisoryInfo,
                ]}
              >
                <Text style={styles.advisoryTitle}>{adv.title}</Text>
                <Text style={styles.advisoryDesc}>{adv.description}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Ride Journal & Travel Memories */}
      <View style={styles.card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.section}>📖 Ride Journal & Memories</Text>
          <TouchableOpacity style={styles.smallButton} onPress={openJournalEditor}>
            <Text style={styles.smallButtonText}>{journalEntry ? 'Edit journal' : '＋ Add entry'}</Text>
          </TouchableOpacity>
        </View>

        {journalEntry ? (
          <View style={{ marginTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.pointName}>{journalEntry.title}</Text>
              <Text style={{ color: '#EAB308', fontSize: 13, fontWeight: '800' }}>
                {'★'.repeat(journalEntry.rating || 5)}{'☆'.repeat(5 - (journalEntry.rating || 5))}
              </Text>
            </View>
            {!!journalEntry.highlights && (
              <Text style={[styles.mutedSmall, { color: theme.accent, fontWeight: '700', marginTop: 4 }]}>
                ✨ {journalEntry.highlights}
              </Text>
            )}
            {!!journalEntry.notes && (
              <Text style={[styles.mutedSmall, { marginTop: 6, fontStyle: 'italic' }]}>
                “{journalEntry.notes}”
              </Text>
            )}
            {Array.isArray(journalEntry.photos) && journalEntry.photos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                {journalEntry.photos.map((p, i) => (
                  <View key={i} style={{ marginRight: 8, borderRadius: 8, overflow: 'hidden' }}>
                    <Image source={{ uri: p.url }} style={{ width: 100, height: 80, borderRadius: 8, backgroundColor: theme.surfaceRaised }} />
                    {!!p.caption && (
                      <Text numberOfLines={1} style={[styles.mutedSmall, { width: 100, fontSize: 9, marginTop: 2 }]}>
                        {p.caption}
                      </Text>
                    )}
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        ) : (
          <Text style={styles.mutedSmall}>Record your memories, route highlights, ratings and photos for this journey.</Text>
        )}

        <TouchableOpacity style={[styles.secondary, { marginTop: 12, alignItems: 'center' }]} onPress={() => void shareRideCard()}>
          <Text style={styles.secondaryText}>📱 Share Ride Card (WhatsApp / Instagram)</Text>
        </TouchableOpacity>
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
        {(() => {
          const nextStop = waypoints.find(point => point.waypoint_type !== 'origin');
          if (!nextStop) return null;
          return (
            <TouchableOpacity
              style={styles.primaryWide}
              onPress={() => void openDirections(nextStop)}
            >
              <Text style={styles.primaryText}>Navigate to next stop: {nextStop.name} ↗</Text>
            </TouchableOpacity>
          );
        })()}
        {waypoints.map((point, index) => {
          const assignedDay = days.find(day => day.id === point.trip_day_id);
          return <View key={point.id} style={styles.point}>
            <View style={styles.marker}><Text style={styles.markerText}>{index + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pointType}>{point.waypoint_type.toUpperCase()}</Text>
              <Text style={styles.pointName}>{point.name}</Text>
              {!!point.address && <Text style={styles.mutedSmall}>{point.address}</Text>}
              {point.waypoint_type !== 'origin' && (
                <TouchableOpacity onPress={() => void openDirections(point)}>
                  <Text style={styles.link}>Navigate here ↗</Text>
                </TouchableOpacity>
              )}
              {isAdmin && <View style={styles.editorRow}>
                <TouchableOpacity style={styles.smallButton} disabled={index === 0} onPress={() => moveWaypoint(index, -1)}><Text style={styles.smallButtonText}>↑</Text></TouchableOpacity>
                <TouchableOpacity style={styles.smallButton} disabled={index === waypoints.length - 1} onPress={() => moveWaypoint(index, 1)}><Text style={styles.smallButtonText}>↓</Text></TouchableOpacity>
                <TouchableOpacity style={styles.smallButton} onPress={() => promptDayAssignment(point)}>
                  <Text style={styles.smallButtonText}>{assignedDay ? 'Day ' + assignedDay.day_number : 'Unassigned'} · change</Text>
                </TouchableOpacity>
              </View>}
            </View>
          </View>;
        })}
        {isAdmin && <View style={{ marginTop: 14, gap: 8 }}>
          <TouchableOpacity style={styles.primaryWide} onPress={() => router.push('/trip/' + trip.id + '/route')}>
            <Text style={styles.primaryText}>＋ Add stops & edit route in workshop →</Text>
          </TouchableOpacity>
          {waypoints.length > 0 && (
            <TouchableOpacity style={[styles.secondary, { alignItems: 'center' }]} disabled={saving} onPress={() => void saveItinerary()}>
              <Text style={styles.secondaryText}>{saving ? 'Saving…' : 'Save stop order & days'}</Text>
            </TouchableOpacity>
          )}
        </View>}
        {!isAdmin && <Text style={styles.mutedSmall}>Only the trip admin can edit the itinerary.</Text>}
      </View>

      <View style={styles.card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={styles.section}>Day-by-day plan & stages</Text>
          {isAdmin && (
            <TouchableOpacity style={styles.smallButton} onPress={() => openCreateStage(1)}>
              <Text style={styles.smallButtonText}>＋ Add stage</Text>
            </TouchableOpacity>
          )}
        </View>
        {days.length === 0 ? (
          <View>
            <Text style={styles.muted}>No dated itinerary days were created for this trip.</Text>
            {stages.length > 0 && (
              <View style={{ marginTop: 10, gap: 8 }}>
                <Text style={styles.stageSectionHeader}>RIDING STAGES ({stages.length})</Text>
                {stages.map(stage => renderStageCard(stage))}
              </View>
            )}
          </View>
        ) : (
          days.map(day => {
            const dayStages = stages.filter(s => s.trip_day_id === day.id || s.day_number === day.day_number);
            const dayWaypoints = waypoints.filter(point => point.trip_day_id === day.id);
            const dayStays = stays.filter(stay => stay.trip_day_id === day.id);

            return (
              <View key={day.id} style={styles.day}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dayTitle}>{day.title || 'Day ' + day.day_number}</Text>
                    <Text style={styles.mutedSmall}>{day.trip_date || 'Date not set'}</Text>
                    {!!day.notes && <Text style={styles.mutedSmall}>📝 {day.notes}</Text>}
                  </View>
                  {isAdmin && (
                    <TouchableOpacity style={styles.smallButton} onPress={() => openCreateStage(day.day_number)}>
                      <Text style={styles.smallButtonText}>＋ Add stage</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Stages in this day */}
                {dayStages.length > 0 && (
                  <View style={{ marginTop: 10, gap: 8 }}>
                    <Text style={styles.stageSectionHeader}>RIDING STAGES ({dayStages.length})</Text>
                    {dayStages.map(stage => renderStageCard(stage))}
                  </View>
                )}

                {/* Stops in this day */}
                {dayWaypoints.length > 0 && (
                  <View style={{ marginTop: 10 }}>
                    <Text style={styles.stageSectionHeader}>PLANNED STOPS ({dayWaypoints.length})</Text>
                    {dayWaypoints.map(wp => (
                      <View key={wp.id} style={styles.dayStopRow}>
                        <Text style={styles.dayStopText}>
                          {wp.waypoint_type.toUpperCase()}: {wp.name}
                          {wp.notes ? ` · 📝 ${wp.notes}` : ''}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Stays in this day */}
                {dayStays.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    {dayStays.map(st => (
                      <Text key={st.id} style={styles.dayStayText}>🏨 Overnight: {st.name}</Text>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}
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
      <Modal visible={stageModalVisible} transparent animationType="slide" onRequestClose={() => setStageModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.editModal} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.section}>Add Riding Stage</Text>
            <Text style={styles.mutedSmall}>Divide this day's ride into a focused stage with start and finish milestones.</Text>
            
            <Text style={styles.label}>Stage Name *</Text>
            <TextInput style={styles.input} value={stageName} onChangeText={setStageName} placeholder="e.g. Morning Ghat Pass" placeholderTextColor={theme.subtle} />
            
            <Text style={styles.label}>Start Location *</Text>
            <TextInput style={styles.input} value={stageStart} onChangeText={setStageStart} placeholder="Start city / town" placeholderTextColor={theme.subtle} />
            
            <Text style={styles.label}>Destination *</Text>
            <TextInput style={styles.input} value={stageDestination} onChangeText={setStageDestination} placeholder="Destination city / town" placeholderTextColor={theme.subtle} />

            <View style={styles.row}>
              <View style={styles.half}>
                <Text style={styles.label}>Start coords (lng, lat)</Text>
                <TextInput style={styles.input} value={stageStartCoords} onChangeText={setStageStartCoords} placeholder="77.59, 12.97" placeholderTextColor={theme.subtle} />
              </View>
              <View style={styles.half}>
                <Text style={styles.label}>Dest coords (lng, lat)</Text>
                <TextInput style={styles.input} value={stageDestCoords} onChangeText={setStageDestCoords} placeholder="75.78, 13.31" placeholderTextColor={theme.subtle} />
              </View>
            </View>

            <Text style={styles.label}>Assign to Day Number (1–{Math.max(days.length, 1)})</Text>
            <TextInput style={styles.input} value={stageDayNumber} onChangeText={setStageDayNumber} keyboardType="number-pad" placeholder="1" placeholderTextColor={theme.subtle} />

            <Text style={styles.label}>Road conditions & stage notes (optional)</Text>
            <TextInput style={styles.input} value={stageNotes} onChangeText={setStageNotes} placeholder="e.g. Steep descent, hairpins, beware of oncoming buses" placeholderTextColor={theme.subtle} multiline />

            <TouchableOpacity style={styles.primaryWide} disabled={saving} onPress={() => void saveStage()}>
              <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save Riding Stage'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => setStageModalVisible(false)}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
      <Modal visible={editTripVisible} transparent animationType="slide" onRequestClose={() => setEditTripVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.editModal} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.section}>Edit trip details</Text>
            <Text style={styles.mutedSmall}>You can update the plan even after the ride has started. Changes are saved to the shared trip.</Text>
            <Text style={styles.label}>Trip name</Text>
            <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="Trip name" placeholderTextColor={theme.subtle} />
            <Text style={styles.label}>Description</Text>
            <TextInput style={styles.input} value={editDescription} onChangeText={setEditDescription} placeholder="Description (optional)" placeholderTextColor={theme.subtle} multiline />
            <TouchableOpacity style={styles.primaryWide} disabled={saving} onPress={() => void saveTripDetails()}><Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save trip changes'}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => setEditTripVisible(false)}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
      <Modal visible={journalModalVisible} transparent animationType="slide" onRequestClose={() => setJournalModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.editModal} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.section}>Trip Journal & Photos</Text>
            <Text style={styles.mutedSmall}>Preserve your personal memories, road observations, and photo links for this tour.</Text>
            <Text style={styles.label}>Journal title</Text>
            <TextInput style={styles.input} value={journalTitle} onChangeText={setJournalTitle} placeholder="e.g. Monsoon Ghats Ride" placeholderTextColor={theme.subtle} />
            <Text style={styles.label}>Touring highlights</Text>
            <TextInput style={styles.input} value={journalHighlights} onChangeText={setJournalHighlights} placeholder="e.g. Winding twisties, chai stall at mountain pass" placeholderTextColor={theme.subtle} />
            <Text style={styles.label}>Trip rating (1 to 5 stars)</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginVertical: 6 }}>
              {['1', '2', '3', '4', '5'].map(star => (
                <TouchableOpacity
                  key={star}
                  style={[styles.smallButton, journalRating === star && styles.roleSelected]}
                  onPress={() => setJournalRating(star)}
                >
                  <Text style={[styles.smallButtonText, { fontSize: 13 }]}>{star} ★</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>Personal recollections & road notes</Text>
            <TextInput
              style={[styles.input, { height: 75, textAlignVertical: 'top' }]}
              value={journalNotes}
              onChangeText={setJournalNotes}
              multiline
              placeholder="Record road surface, memorable encounters, weather..."
              placeholderTextColor={theme.subtle}
            />
            <Text style={[styles.label, { marginTop: 14 }]}>Attach photo (image URL)</Text>
            <TextInput style={styles.input} value={journalPhotoUrl} onChangeText={setJournalPhotoUrl} autoCapitalize="none" keyboardType="url" placeholder="https://... photo link" placeholderTextColor={theme.subtle} />
            <TextInput style={styles.input} value={journalPhotoCaption} onChangeText={setJournalPhotoCaption} placeholder="Caption (optional)" placeholderTextColor={theme.subtle} />
            <TouchableOpacity style={[styles.secondary, { marginTop: 8, alignItems: 'center' }]} onPress={addPhotoToJournal}>
              <Text style={styles.secondaryText}>＋ Attach photo ({journalPhotos.length} attached)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.primaryWide} disabled={saving} onPress={() => void saveJournal()}>
              <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save journal entry'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.secondary, { marginTop: 8, alignItems: 'center' }]} onPress={() => setJournalModalVisible(false)}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Text style={styles.footer}>Trip planning is separate from the actual GPS session. Starting the tracker records what happened, while this workspace keeps the planned journey.</Text>
    </ScrollView>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  editTripButton: { borderWidth: 1, borderColor: c.accent, backgroundColor: c.accentSoft, borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 12 }, editTripText: { color: c.text, fontSize: 13, fontWeight: '800' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' }, editModal: { maxHeight: '90%', backgroundColor: c.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20 },
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
  stageCard: { backgroundColor: c.background, borderColor: c.border, borderWidth: 1, borderRadius: 8, padding: 12, marginTop: 6 },
  stageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  stageTitle: { color: c.text, fontSize: 13, fontWeight: '800' },
  stageEndpoints: { color: c.muted, fontSize: 11, marginTop: 2 },
  stageMetaText: { color: c.accent, fontSize: 10, fontWeight: '700', marginTop: 3 },
  stageStatusPill: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  stageStatusText: { fontSize: 10, fontWeight: '800' },
  stageNotes: { color: c.text, fontSize: 11, lineHeight: 15, marginTop: 6, fontStyle: 'italic' },
  stageActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  stageSectionHeader: { color: c.subtle, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: 8, marginBottom: 4 },
  dayStopRow: { paddingVertical: 2 },
  dayStopText: { color: c.text, fontSize: 11 },
  dayStayText: { color: c.accent, fontSize: 11, fontWeight: '600', marginTop: 4 },
  remove: { color: c.danger, fontSize: 11, fontWeight: '700' },
  half: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  dangerButton: { borderWidth: 1, borderColor: c.danger, backgroundColor: c.surface, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 4 }, dangerText: { color: c.danger, fontWeight: '900', fontSize: 12 },
  error: { color: c.danger, marginTop: 12 }, footer: { color: c.subtle, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 18 },
  intelBlock: { marginBottom: 14 },
  intelTitle: { color: c.text, fontSize: 14, fontWeight: '800', marginBottom: 8 },
  fuelRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: c.surfaceRaised, borderRadius: 12, padding: 10, marginBottom: 8 },
  fuelStat: { alignItems: 'center' },
  fuelStatValue: { color: c.text, fontSize: 15, fontWeight: '800' },
  fuelStatLabel: { color: c.muted, fontSize: 8, fontWeight: '800', letterSpacing: 0.8, marginTop: 2 },
  fuelCostText: { color: c.accent, fontSize: 12, fontWeight: '700', marginBottom: 4 },
  weatherCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surfaceRaised, borderRadius: 12, padding: 10 },
  advisoryItem: { borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1 },
  advisoryTitle: { color: c.text, fontSize: 12, fontWeight: '800', marginBottom: 2 },
  advisoryDesc: { color: c.muted, fontSize: 11, lineHeight: 16 },
  advisoryWarning: { backgroundColor: c.accentSoft, borderColor: c.danger },
  advisoryCaution: { backgroundColor: '#FEF9C3', borderColor: '#CA8A04' },
  advisoryInfo: { backgroundColor: c.surfaceRaised, borderColor: c.border },
});
