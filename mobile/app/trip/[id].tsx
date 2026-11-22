import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  buildGoogleMapsNavigationUrl,
  type TripStage,
  type StageStatus,
  calculateMotorcycleFuelPlan,
  generateTouringAdvisories,
  getWeatherConditionFromCode,
  type RouteWeatherPoint,
  type TripJournalEntry,
  type JournalPhoto,
  formatShareableRideCard,
  ROLE_LABELS,
  CHECKLIST_CATEGORY_LABELS,
  type TripChecklistItem,
  type RideParticipantRole,
  type TripChecklistCategory,
  exportTripToGpx,
  calculateExpenseSettlement,
  EXPENSE_CATEGORY_META,
  type TripExpense,
  type TripExpenseCategory,
  type TripExpenseSummary,
  type AttendanceStatus,
  ATTENDANCE_STATUS_LABELS,
} from '@ridentrack/shared';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, RidePalette } from '../../src/theme';
import { saveCachedTrip, getCachedTrip, clearCachedTrip } from '../../src/lib/tripCache';
import { stopBackgroundLocationUpdates } from '../../src/services/backgroundLocation';
import {
  Avatar,
  AvatarStack,
  Card,
  FallbackTripCover,
  LiveDot,
  RouteLine,
  StatusBadge,
} from '../../src/components/ui';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

type Trip = {
  id: string;
  name: string;
  description?: string | null;
  origin: string;
  destination: string;
  origin_coords?: [number, number] | null;
  destination_coords?: [number, number] | null;
  status: string;
  trip_type?: string;
  start_date?: string | null;
  end_date?: string | null;
  estimated_distance_meters?: number | null;
  estimated_duration_seconds?: number | null;
  expense_currency: string;
  ride_code: string;
  admin_id: string;
  route_deviation_threshold_meters: number;
  rider_behind_threshold_meters: number;
  visibility?: 'private' | 'invite_only' | 'public';
  max_participants?: number | null;
  ride_rules?: string | null;
};

type Waypoint = {
  id: string;
  sequence: number;
  waypoint_type: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  provider_place_id?: string | null;
  notes?: string;
  trip_day_id?: string | null;
};

type Day = {
  id: string;
  day_number: number;
  trip_date?: string;
  title?: string;
  notes?: string;
};

type Regroup = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  sequence: number;
  target_arrival: string | null;
  notes: string | null;
  arrived_count: number;
  my_arrived: boolean;
  status?: string;
  closed_at?: string | null;
};

type Rider = {
  user_id: string;
  display_name: string;
  role: RideParticipantRole;
  is_active: boolean;
  last_seen: string | null;
  attendance_status?: AttendanceStatus;
  motorcycle_model?: string;
};

type Stay = {
  id: string;
  name: string;
  stay_type: string;
  address?: string;
  check_in?: string;
  check_out?: string;
  price_amount?: number;
  price_currency: string;
  trip_day_id?: string | null;
};

export default function TripWorkspaceScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
  const [inviteRole, setInviteRole] = useState<RideParticipantRole>('member');
  const [checklists, setChecklists] = useState<TripChecklistItem[]>([]);
  const [selectedRider, setSelectedRider] = useState<Rider | null>(null);
  const [riderRoleModalVisible, setRiderRoleModalVisible] = useState(false);
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
  const [editVisibility, setEditVisibility] = useState<'private' | 'invite_only' | 'public'>('invite_only');
  const [editMaxParticipants, setEditMaxParticipants] = useState('');
  const [editRideRules, setEditRideRules] = useState('');

  // UX redesign states
  const [activeTab, setActiveTab] = useState<'details' | 'live'>('details');
  const [rosterExpanded, setRosterExpanded] = useState(false);
  const [participantSearch, setParticipantSearch] = useState('');

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

  const [expenses, setExpenses] = useState<TripExpense[] | null>(null);
  const [expenseSummary, setExpenseSummary] = useState<TripExpenseSummary | null>(null);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [expenseModal, setExpenseModal] = useState(false);
  const [newExpenseTitle, setNewExpenseTitle] = useState('');
  const [newExpenseAmount, setNewExpenseAmount] = useState('');
  const [newExpenseCategory, setNewExpenseCategory] = useState<TripExpenseCategory>('fuel');
  const [newExpenseSplitUsers, setNewExpenseSplitUsers] = useState<string[]>([]);
  const [newExpenseNotes, setNewExpenseNotes] = useState('');

  const settlements = useMemo(() => {
    return calculateExpenseSettlement(expenseSummary?.participant_balances || [], expenseSummary?.currency);
  }, [expenseSummary]);

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
    setExpenses(null); setExpenseSummary(null); setExpenseError(null);
    try {
      const [tripResult, waypointResult, dayResult, stayResult, rosterResult, regroupResult, stageResult, checklistResult, expensesResult, expenseSummaryResult] = await Promise.all([
        supabase.from('rides').select('*').eq('id', id).single(),
        supabase.from('trip_waypoints').select('*').eq('ride_id', id).order('sequence'),
        supabase.from('trip_days').select('*').eq('ride_id', id).order('day_number'),
        supabase.from('trip_stays').select('*').eq('ride_id', id).order('check_in'),
        supabase.rpc('get_trip_roster', { p_ride_id: id }),
        supabase.rpc('get_regroup_points', { p_ride_id: id }),
        supabase.rpc('get_trip_stages', { p_ride_id: id }),
        supabase.rpc('get_trip_checklists', { p_ride_id: id }),
        supabase.rpc('get_trip_expenses', { p_ride_id: id }),
        supabase.rpc('get_trip_expense_summary', { p_ride_id: id }),
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
      const list = expensesResult.error ? null : expensesResult.data as TripExpense[] | null;
      const summary = expenseSummaryResult.error ? null : expenseSummaryResult.data as TripExpenseSummary | null;
      setExpenses(list);
      setExpenseSummary(summary);
      setExpenseError([
        !list && (expensesResult.error?.message || 'Expense list unavailable.'),
        !summary && (expenseSummaryResult.error?.message || 'Expense balances unavailable.'),
      ].filter(Boolean).join(' · ') || null);
      setDeviationLimit(String((tripResult.data as Trip).route_deviation_threshold_meters || 500));
      setBehindLimit(String((tripResult.data as Trip).rider_behind_threshold_meters || 1000));

      let clData = (checklistResult.data || []) as TripChecklistItem[];
      if (clData.length === 0 && tripResult.data?.admin_id === user?.id) {
        await supabase.rpc('seed_default_trip_checklists', { p_ride_id: id });
        const { data: refetched } = await supabase.rpc('get_trip_checklists', { p_ride_id: id });
        if (refetched) clData = refetched as TripChecklistItem[];
      }
      setChecklists(clData);

      if (generation === loadGeneration.current && user?.id) {
        void saveCachedTrip(id, {
          trip: tripResult.data as any,
          waypoints: (waypointResult.data || []) as any,
          stages: (stageResult.data || []) as any,
          days: (dayResult.data || []) as any,
          stays: (stayResult.data || []) as any,
        }, user.id);
      }

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
      return !!summary && generation === loadGeneration.current;
    } catch (e: any) {
      if (generation === loadGeneration.current) {
        setExpenses(null); setExpenseSummary(null); setExpenseError('Expense data unavailable.');
        const isAuthOrPermissionError = e?.status === 401 || e?.status === 403 || e?.code === '42501' || e?.code === 'PGRST116' || /permission|unauthorized|not found/i.test(e?.message || '');
        if (isAuthOrPermissionError) {
          void clearCachedTrip(id, user?.id);
          setTrip(null);
          setError(e?.message || 'You do not have permission to view this trip.');
        } else {
          const cached = await getCachedTrip(id, user?.id);
          if (cached?.trip) {
            setTrip(cached.trip as any);
            setWaypoints(cached.waypoints as any);
            setDays(cached.days as any);
            setStays(cached.stays as any);
            setStages(cached.stages as any);
            setError('Offline Mode: Showing cached trip itinerary.');
          } else {
            setError(e?.message || 'Could not load this trip.');
          }
        }
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [id, user?.id]);

  useFocusEffect(useCallback(() => { void load(); return () => { ++loadGeneration.current; }; }, [load]));
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);

  // Live Tracker tab visibility rule: Planned or Ongoing/Active only; hidden for Completed and Cancelled/Archived
  const canShowLiveTracker = useMemo(() => {
    if (!trip) return false;
    const s = trip.status.toLowerCase();
    return s === 'active' || s === 'planned' || s === 'ongoing';
  }, [trip]);

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
    setEditVisibility(trip.visibility || 'invite_only');
    setEditMaxParticipants(trip.max_participants ? String(trip.max_participants) : '');
    setEditRideRules(trip.ride_rules || '');
    setEditTripVisible(true);
  }

  async function saveTripDetails() {
    if (!editName.trim()) { Alert.alert('Trip name required', 'Enter a name for this trip.'); return; }
    const maxPartNum = editMaxParticipants.trim() ? Number(editMaxParticipants) : null;
    if (maxPartNum != null && (!Number.isInteger(maxPartNum) || maxPartNum < 2 || maxPartNum > 500)) {
      Alert.alert('Invalid pack capacity', 'Pack size must be a whole number between 2 and 500 riders.'); return;
    }
    setSaving(true); setError('');
    try {
      const { error: updateError } = await supabase.from('rides').update({
        name: editName.trim(),
        description: editDescription.trim() || null,
        visibility: editVisibility,
        max_participants: maxPartNum,
        ride_rules: editRideRules.trim() || null,
      }).eq('id', id);
      if (updateError) throw updateError;
      setEditTripVisible(false);
      await load();
      Alert.alert('Trip updated', 'Your trip settings, capacity, and rules have been saved.');
    } catch (e: any) {
      setError(e?.message || 'Could not update trip details.');
    } finally { setSaving(false); }
  }

  const [updatingAttendance, setUpdatingAttendance] = useState(false);

  async function handleUpdateAttendance(status: AttendanceStatus, targetUserId?: string): Promise<boolean> {
    if (updatingAttendance) return false;
    setUpdatingAttendance(true);
    try {
      const { error: attError } = await supabase.rpc('update_participant_attendance', {
        p_ride_id: id,
        p_status: status,
        p_target_user_id: targetUserId || null,
      });
      if (attError) throw attError;
      setRoster(prev => prev.map(r => {
        if (targetUserId ? r.user_id === targetUserId : r.user_id === user?.id) {
          return { ...r, attendance_status: status };
        }
        return r;
      }));
      return true;
    } catch (e: any) {
      Alert.alert('Could not update attendance', e?.message || 'Please try again.');
      return false;
    } finally {
      setUpdatingAttendance(false);
    }
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
      await stopBackgroundLocationUpdates(id).catch(() => {});
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e?.message || 'Could not delete this trip.');
      setSaving(false);
    }
  }

  function duplicateTrip() {
    if (!trip) return;
    Alert.alert(
      'Duplicate Trip?',
      'Clone “' + trip.name + '” with all its stops, days, and stages into a new planned trip?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Duplicate',
          onPress: async () => {
            setSaving(true);
            try {
              const { data, error: dupError } = await supabase.rpc('duplicate_trip', { p_ride_id: trip.id });
              if (dupError) throw dupError;
              Alert.alert('Trip Cloned', 'Your cloned trip is ready.', [
                { text: 'Open Copy', onPress: () => router.push(`/trip/${data}`) },
                { text: 'Stay Here', style: 'cancel' },
              ]);
            } catch (e: any) {
              Alert.alert('Could not duplicate', e?.message || 'Please try again.');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  async function toggleArchiveTrip() {
    if (!trip || !isAdmin) return;
    const isArchived = trip.status === 'archived';
    setSaving(true);
    try {
      const rpcName = isArchived ? 'unarchive_trip' : 'archive_trip';
      const { error: archError } = await supabase.rpc(rpcName, { p_ride_id: trip.id });
      if (archError) throw archError;
      setTrip(prev => prev ? { ...prev, status: isArchived ? 'planned' : 'archived' } : null);
      Alert.alert(isArchived ? 'Trip Restored' : 'Trip Archived', isArchived ? 'Trip is restored to active planning.' : 'Trip has been archived.');
    } catch (e: any) {
      Alert.alert('Action failed', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function exportGpxFile() {
    if (!trip) return;
    try {
      const gpxContent = exportTripToGpx({
        tripName: trip.name,
        description: trip.description,
        waypoints: waypoints.map(w => ({
          name: w.name,
          latitude: w.latitude,
          longitude: w.longitude,
          waypoint_type: w.waypoint_type,
          notes: w.notes,
        })),
        routeCoordinates: (trip as any).route_geometry?.geometry?.coordinates,
      });

      const cleanName = trip.name.replace(/[^a-zA-Z0-9_-]/g, '_');

      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && typeof document !== 'undefined') {
          const blob = new Blob([gpxContent], { type: 'application/gpx+xml;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${cleanName}.gpx`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          return;
        }
        throw new Error('File downloads are unavailable in this browser.');
      }

      const fileUri = `${FileSystem.cacheDirectory}${cleanName}.gpx`;
      await FileSystem.writeAsStringAsync(fileUri, gpxContent, { encoding: FileSystem.EncodingType.UTF8 });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/gpx+xml',
          dialogTitle: `Export ${trip.name}.gpx`,
          UTI: 'com.topografix.gpx',
        });
      } else {
        throw new Error('File sharing is unavailable on this device.');
      }
    } catch (err: any) {
      Alert.alert('Could not export GPX', err?.message || 'Please try again.');
    }
  }

  async function handleAddExpense() {
    if (!newExpenseTitle.trim()) {
      Alert.alert('Required', 'Please enter an expense title.');
      return;
    }
    const parsedAmount = parseFloat(newExpenseAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Required', 'Please enter a valid expense amount.');
      return;
    }
    if (newExpenseSplitUsers.length === 0) {
      Alert.alert('Required', 'Please select at least one rider to share this expense.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('add_trip_expense', {
        p_ride_id: id,
        p_title: newExpenseTitle.trim(),
        p_amount: parsedAmount,
        p_category: newExpenseCategory,
        p_split_user_ids: newExpenseSplitUsers,
        p_notes: newExpenseNotes.trim() || null,
      });
      if (error) throw error;
      setExpenseModal(false);
      setNewExpenseTitle('');
      setNewExpenseAmount('');
      setNewExpenseNotes('');
      const refreshed = await load();
      Alert.alert('Expense Added', refreshed ? 'Group expense recorded and split calculated.' : 'Expense saved. Balances could not be refreshed.');
    } catch (err: any) {
      Alert.alert('Could not save expense', err?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleDeleteExpense(expenseId: string, title: string) {
    Alert.alert(
      'Delete Expense?',
      `Remove "${title}" from trip expenses?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const { error } = await supabase.rpc('delete_trip_expense', { p_expense_id: expenseId });
              if (error) throw error;
              await load();
            } catch (err: any) {
              Alert.alert('Could not delete expense', err?.message || 'Please try again.');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
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
      await stopBackgroundLocationUpdates(id).catch(() => {});
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e?.message || 'Could not leave this ride.');
      setSaving(false);
    }
  }

  async function toggleChecklist(item: TripChecklistItem) {
    const nextCompleted = !item.my_completed;
    setChecklists(prev => prev.map(c => c.id === item.id
      ? { ...c, my_completed: nextCompleted, completed_count: nextCompleted ? c.completed_count + 1 : Math.max(0, c.completed_count - 1) }
      : c
    ));
    try {
      const { error } = await supabase.rpc('toggle_trip_checklist_item', {
        p_checklist_id: item.id,
        p_completed: nextCompleted,
      });
      if (error) throw error;
    } catch (e: any) {
      setChecklists(prev => prev.map(c => c.id === item.id ? item : c));
      Alert.alert('Checklist update failed', e?.message || 'Please try again.');
    }
  }

  async function updateRiderRole(targetRole: RideParticipantRole) {
    if (!selectedRider || !isAdmin) return;
    setSaving(true);
    try {
      const { error: roleError } = await supabase.rpc('set_trip_participant_role', {
        p_ride_id: id,
        p_user_id: selectedRider.user_id,
        p_role: targetRole,
      });
      if (roleError) throw roleError;
      setRoster(prev => prev.map(r => r.user_id === selectedRider.user_id ? { ...r, role: targetRole } : r));
      setRiderRoleModalVisible(false);
      setSelectedRider(null);
    } catch (e: any) {
      Alert.alert('Role update failed', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function transferLeadership(rider: Rider) {
    if (!isAdmin) return;
    Alert.alert(
      'Transfer Captaincy?',
      `Make "${rider.display_name}" the Captain of this trip? You will become Co-Captain.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Transfer',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const { error: xferError } = await supabase.rpc('transfer_trip_leadership', {
                p_ride_id: id,
                p_new_admin_id: rider.user_id,
              });
              if (xferError) throw xferError;
              setRiderRoleModalVisible(false);
              setSelectedRider(null);
              await load();
              Alert.alert('Captain Transferred', `${rider.display_name} is now the trip captain.`);
            } catch (e: any) {
              Alert.alert('Transfer failed', e?.message || 'Please try again.');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  async function removeParticipant(rider: Rider) {
    if (!isAdmin) return;
    Alert.alert(
      'Remove Rider?',
      `Remove "${rider.display_name}" from this group ride?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const { error: remError } = await supabase.rpc('remove_trip_participant', {
                p_ride_id: id,
                p_user_id: rider.user_id,
              });
              if (remError) throw remError;
              setRoster(prev => prev.filter(r => r.user_id !== rider.user_id));
              setRiderRoleModalVisible(false);
              setSelectedRider(null);
            } catch (e: any) {
              Alert.alert('Could not remove rider', e?.message || 'Please try again.');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
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

  async function closeRegroupPoint(pointId: string) {
    setSaving(true); setError('');
    try {
      const { error: closeError } = await supabase.rpc('close_regroup_point', { p_regroup_point_id: pointId });
      if (closeError) throw closeError;
      await load();
      Alert.alert('Regroup Point Closed', 'The regroup point has been closed and the pack notified.');
    } catch (e: any) { setError(e?.message || 'Could not close regroup point.'); }
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

  function openCreateStage(dayNumber: number) {
    setStageName('');
    setStageStart(trip?.origin || '');
    setStageDestination(trip?.destination || '');
    setStageStartCoords('');
    setStageDestCoords('');
    setStageDayNumber(String(dayNumber));
    setStageNotes('');
    setStageModalVisible(true);
  }

  async function saveStage() {
    if (!stageName.trim() || !stageStart.trim() || !stageDestination.trim()) {
      Alert.alert('Required fields', 'Stage name, start, and destination are required.');
      return;
    }
    setSaving(true);
    try {
      const { error: stageError } = await supabase.rpc('save_trip_stage', {
        p_ride_id: id,
        p_stage: {
          name: stageName.trim(),
          start_name: stageStart.trim(),
          destination_name: stageDestination.trim(),
          day_number: Number(stageDayNumber) || 1,
          notes: stageNotes.trim() || null,
          status: 'planned',
        },
      });
      if (stageError) throw stageError;
      setStageModalVisible(false);
      await load();
    } catch (e: any) {
      Alert.alert('Could not save stage', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
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

  // Large groups / roster filtering & sorting
  // Pin Leader, Sweep, and riders with active alerts at top
  const { pinnedRoster, otherRoster, activeRosterCount } = useMemo(() => {
    const query = participantSearch.trim().toLowerCase();
    const filtered = roster.filter(r => {
      if (!query) return true;
      return (
        r.display_name.toLowerCase().includes(query) ||
        r.role.toLowerCase().includes(query) ||
        (r.motorcycle_model && r.motorcycle_model.toLowerCase().includes(query))
      );
    });

    const activeCount = roster.filter(r => r.is_active).length;

    const pinned: Rider[] = [];
    const regular: Rider[] = [];

    for (const r of filtered) {
      const isLeader = r.user_id === trip?.admin_id || r.role === 'captain' || r.role === 'co-captain';
      const isSweep = r.role === 'sweeper';
      const age = r.last_seen ? now - Date.parse(r.last_seen) : Number.POSITIVE_INFINITY;
      const hasAlert = r.is_active && (age > 120000 || age > 30000);

      if (isLeader || isSweep || hasAlert) {
        pinned.push(r);
      } else {
        regular.push(r);
      }
    }

    return {
      pinnedRoster: pinned,
      otherRoster: regular,
      activeRosterCount: activeCount,
    };
  }, [roster, participantSearch, trip?.admin_id, now]);

  if (loading && !trip) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
        <Text style={styles.muted}>Loading trip workspace…</Text>
      </View>
    );
  }

  if (!trip) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Trip unavailable</Text>
        <Text style={styles.muted}>{error || 'You may not have access to this trip.'}</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isTripOngoing = trip.status === 'active' || trip.status === 'ongoing';

  return (
    <View style={styles.screenWrapper}>
      {/* Top Header Bar */}
      <View style={[styles.topHeader, { paddingTop: Math.max(insets.top, 14) }]}>
        <View style={styles.topHeaderInner}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <View style={styles.topHeaderTitleContainer}>
            <Text style={styles.topHeaderEyebrow}>LIVE NAVIGATION</Text>
            <Text style={styles.topHeaderTitle} numberOfLines={1}>{trip.name}</Text>
          </View>
          <View style={styles.topHeaderRight}>
            <Avatar
              name={profile?.display_name || user?.email || 'Rider'}
              size={34}
            />
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.accent} />}
      >
        {/* Trip Hero Visual Module */}
        <View style={styles.heroCoverWrapper}>
          <FallbackTripCover
            tripId={trip.id}
            name={trip.name}
            status={trip.status}
            stageInfo={stages.length > 0 ? `Stage 1 of ${stages.length}` : undefined}
            elevation={trip.estimated_distance_meters ? `${Math.round(trip.estimated_distance_meters / 1000)} km` : null}
            timeTag={trip.start_date || undefined}
          />
          {/* Hero Overlay Details */}
          <View style={styles.heroOverlayContent}>
            <View style={styles.heroTopRow}>
              <StatusBadge status={trip.status} />
              <TouchableOpacity
                style={styles.heroActionBtn}
                onPress={() => void exportGpxFile()}
                accessibilityLabel="Export GPX route"
              >
                <Text style={styles.heroActionBtnText}>📥 GPX</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.heroBottomBlock}>
              <View style={styles.heroEyebrowRow}>
                <Text style={styles.heroEyebrowText}>EXPEDITION WORKSPACE</Text>
                <Text style={styles.heroDot}>•</Text>
                <Text style={styles.heroEyebrowMuted}>RAID MODE</Text>
              </View>
              <Text style={styles.heroTripName} numberOfLines={2}>{trip.name}</Text>
              <View style={styles.heroRouteRow}>
                <Text style={styles.heroRouteText} numberOfLines={1}>{trip.origin}</Text>
                <Text style={styles.heroRouteArrow}>→</Text>
                <Text style={styles.heroRouteText} numberOfLines={1}>{trip.destination}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Quick Stats Telemetry Strip */}
        <View style={styles.telemetryStrip}>
          <View style={styles.telemetryCol}>
            <Text style={styles.telemetryLabel}>TIMELINE</Text>
            <Text style={styles.telemetryValue}>
              {trip.start_date
                ? `${new Date(trip.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${trip.end_date ? ` - ${new Date(trip.end_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}`
                : `${days.length > 0 ? `${days.length} Days` : 'Date TBD'}`}
            </Text>
          </View>
          <View style={styles.telemetryDivider} />
          <View style={styles.telemetryCol}>
            <Text style={styles.telemetryLabel}>DISTANCE DELTA</Text>
            <Text style={styles.telemetryValue}>
              {distance} <Text style={styles.telemetrySub}>({duration})</Text>
            </Text>
          </View>
        </View>

        {/* Sticky Section Switcher (Details | Live Tracker) */}
        {/* Shown ONLY for Planned or Ongoing trips; hidden for Completed and Cancelled */}
        {canShowLiveTracker && (
          <View style={styles.stickySwitcherContainer}>
            <View style={styles.segmentedWrapper}>
              <TouchableOpacity
                style={[styles.segmentBtn, activeTab === 'details' && styles.segmentBtnActive]}
                onPress={() => setActiveTab('details')}
              >
                <Text style={[styles.segmentBtnText, activeTab === 'details' && styles.segmentBtnTextActive]}>
                  📋 Details
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segmentBtn, activeTab === 'live' && styles.segmentBtnActive]}
                onPress={() => setActiveTab('live')}
              >
                <View style={styles.liveSegmentInner}>
                  <LiveDot pulse={isTripOngoing} size={8} />
                  <Text style={[styles.segmentBtnText, activeTab === 'live' && styles.segmentBtnTextActive]}>
                    Live Tracker
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ================= LIVE TRACKER VIEW ================= */}
        {activeTab === 'live' && canShowLiveTracker && (
          <View style={styles.liveRadarContainer}>
            <Card style={styles.liveRadarCard} variant="raised">
              <View style={styles.liveRadarHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <LiveDot pulse={isTripOngoing} />
                  <Text style={styles.liveRadarTitle}>
                    {isTripOngoing ? 'LIVE SATELLITE RADAR' : 'LIVE TRACKING PREPARATION'}
                  </Text>
                </View>
                <StatusBadge status={trip.status} />
              </View>

              <Text style={styles.liveRadarDescription}>
                {isTripOngoing
                  ? 'Active group telemetry is syncing. Tap below to enter dedicated helmet & glove-operable Ride Mode.'
                  : 'Planned trip route locked. Start tracking when your motorcycle hits the highway.'}
              </Text>

              <RouteLine
                origin={trip.origin}
                destination={trip.destination}
                stopsCount={waypoints.length}
                style={{ marginVertical: 14 }}
              />

              <View style={styles.liveRadarStatsRow}>
                <View style={styles.liveRadarStat}>
                  <Text style={styles.liveRadarStatValue}>{activeRosterCount} / {roster.length}</Text>
                  <Text style={styles.liveRadarStatLabel}>RIDERS ONLINE</Text>
                </View>
                <View style={styles.liveRadarStat}>
                  <Text style={styles.liveRadarStatValue}>{distance}</Text>
                  <Text style={styles.liveRadarStatLabel}>TOTAL EXPEDITION</Text>
                </View>
                <View style={styles.liveRadarStat}>
                  <Text style={styles.liveRadarStatValue}>{waypoints.length}</Text>
                  <Text style={styles.liveRadarStatLabel}>WAYPOINTS</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.launchRideModeBtn}
                onPress={() => router.push('/ride/' + trip.id)}
              >
                <Text style={styles.launchRideModeBtnText}>
                  {isTripOngoing ? 'Launch Ride Mode HUD →' : 'Start Live Ride Session →'}
                </Text>
              </TouchableOpacity>
            </Card>
          </View>
        )}

        {/* ================= DETAILS SECTION ================= */}
        {activeTab === 'details' && (
          <>
            {/* Elevation & Technical Surface Profile Card */}
            <Card style={styles.cardSection}>
              <View style={styles.sectionHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.sectionTitle}>Route Difficulty & Surface Profile</Text>
                </View>
                <View style={styles.tierPill}>
                  <Text style={styles.tierPillText}>Tier 4 Expedition</Text>
                </View>
              </View>

              {/* Topographic Elevation Profile Representation */}
              <View style={styles.elevationSparklineBox}>
                <View style={styles.elevationBarGraph}>
                  {[35, 45, 60, 50, 75, 95, 80, 100, 70, 85, 90, 65, 40].map((h, idx) => (
                    <View key={idx} style={[styles.elevationBar, { height: `${h}%` }]} />
                  ))}
                </View>
                <View style={styles.elevationGradientFill} />
              </View>

              <View style={styles.elevationStatsRow}>
                <View style={styles.elevationStatBlock}>
                  <Text style={styles.elevationStatLabel}>MAX ALTITUDE</Text>
                  <Text style={styles.elevationStatValue}>5,359 m</Text>
                </View>
                <View style={styles.elevationStatBlock}>
                  <Text style={styles.elevationStatLabel}>OFF-ROAD</Text>
                  <Text style={[styles.elevationStatValue, { color: theme.accent }]}>35% Slag</Text>
                </View>
                <View style={styles.elevationStatBlock}>
                  <Text style={styles.elevationStatLabel}>CURRENT PACK</Text>
                  <Text style={[styles.elevationStatValue, { color: theme.green }]}>4,530 m</Text>
                </View>
              </View>
            </Card>

            {/* Participants & Formation Roster Section */}
            <Card style={styles.cardSection}>
              <View style={styles.sectionHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.sectionTitle}>Participants</Text>
                  <View style={styles.counterBadge}>
                    <Text style={styles.counterBadgeText}>{roster.length} RIDERS</Text>
                  </View>
                </View>
                <View style={styles.activePill}>
                  <View style={styles.greenPulseDot} />
                  <Text style={styles.activePillText}>{activeRosterCount} Active on Radar</Text>
                </View>
              </View>

              {/* Collapsed State: AvatarStack + Summary */}
              {!rosterExpanded && (
                <View style={styles.collapsedRosterContainer}>
                  <View style={styles.collapsedRosterTop}>
                    <AvatarStack
                      users={roster.slice(0, 4).map(r => ({ name: r.display_name }))}
                      maxDisplay={4}
                      totalCount={roster.length}
                      size={44}
                    />
                    <View style={styles.collapsedRosterSummary}>
                      <Text style={styles.collapsedRosterTitle}>Formation Pack</Text>
                      <Text style={styles.collapsedRosterSub}>
                        {activeRosterCount} online now · {roster.length} confirmed
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.expandRosterBtn}
                    onPress={() => setRosterExpanded(true)}
                  >
                    <Text style={styles.expandRosterBtnText}>
                      +{Math.max(0, roster.length - 4)} more riders in pack (Tap to view formation) ▼
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Expanded State: Search + Pinned Leader/Sweep/Alerts + Virtualized List */}
              {rosterExpanded && (
                <View style={styles.expandedRosterContainer}>
                  {/* Search Bar */}
                  <View style={styles.searchBarBox}>
                    <Text style={styles.searchIcon}>🔍</Text>
                    <TextInput
                      style={styles.searchInput}
                      value={participantSearch}
                      onChangeText={setParticipantSearch}
                      placeholder="Filter riders, callsigns, or motorcycle models..."
                      placeholderTextColor={theme.subtle}
                    />
                    {participantSearch.length > 0 && (
                      <TouchableOpacity onPress={() => setParticipantSearch('')}>
                        <Text style={styles.searchClear}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Pinned & Regular Riders */}
                  <View style={styles.rosterList}>
                    {[...pinnedRoster, ...otherRoster].map(rider => {
                      const isLeader = rider.user_id === trip.admin_id || rider.role === 'captain' || rider.role === 'co-captain';
                      const isSweep = rider.role === 'sweeper';
                      const age = rider.last_seen ? now - Date.parse(rider.last_seen) : Number.POSITIVE_INFINITY;
                      const hasAlert = rider.is_active && (age > 120000 || age > 30000);
                      const roleMeta = ROLE_LABELS[rider.role] || { title: rider.role, icon: '🏍️' };
                      const attMeta = rider.attendance_status ? ATTENDANCE_STATUS_LABELS[rider.attendance_status] : null;

                      return (
                        <View key={rider.user_id} style={[styles.riderRowItem, hasAlert && styles.riderRowAlert]}>
                          <View style={styles.riderRowLeft}>
                            <Avatar name={rider.display_name} size={42} />
                            <View style={styles.riderRowMeta}>
                              <View style={styles.riderRowNameLine}>
                                <Text style={styles.riderName} numberOfLines={1}>
                                  {rider.display_name}{rider.user_id === user?.id ? ' (You)' : ''}
                                </Text>
                                {isLeader ? (
                                  <View style={styles.leaderPill}><Text style={styles.leaderPillText}>★ LEADER</Text></View>
                                ) : isSweep ? (
                                  <View style={styles.sweepPill}><Text style={styles.sweepPillText}>▼ SWEEP</Text></View>
                                ) : hasAlert ? (
                                  <View style={styles.alertPill}><Text style={styles.alertPillText}>! ALERT</Text></View>
                                ) : null}
                              </View>
                              <Text style={styles.riderBikeText} numberOfLines={1}>
                                {rider.motorcycle_model || roleMeta.title}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.riderRowRight}>
                            <Text style={[styles.riderStatusText, rider.is_active ? { color: theme.green } : { color: theme.subtle }]}>
                              {rider.is_active ? 'CONNECTED' : 'OFFLINE'}
                            </Text>
                            {isAdmin && rider.user_id !== user?.id && (
                              <TouchableOpacity
                                style={styles.manageRiderBtn}
                                onPress={() => {
                                  setSelectedRider(rider);
                                  setRiderRoleModalVisible(true);
                                }}
                              >
                                <Text style={styles.manageRiderBtnText}>Manage ⚙</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>

                  <TouchableOpacity
                    style={styles.collapseRosterBtn}
                    onPress={() => setRosterExpanded(false)}
                  >
                    <Text style={styles.collapseRosterBtnText}>▲ Collapse formation roster</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Attendance RSVP Selector for Current User */}
              {roster.some(r => r.user_id === user?.id && r.is_active) && (
                <View style={styles.rsvpBox}>
                  <Text style={styles.rsvpTitle}>Your Attendance RSVP</Text>
                  <View style={styles.rsvpButtonsRow}>
                    {(['confirmed', 'tentative', 'declined'] as const).map(status => {
                      const myRider = roster.find(r => r.user_id === user?.id);
                      const isSelected = (myRider?.attendance_status || 'confirmed') === status;
                      const meta = ATTENDANCE_STATUS_LABELS[status];
                      return (
                        <TouchableOpacity
                          key={status}
                          disabled={updatingAttendance}
                          style={[styles.rsvpBtn, isSelected && styles.rsvpBtnSelected]}
                          onPress={() => void handleUpdateAttendance(status)}
                        >
                          <Text style={[styles.rsvpBtnText, isSelected && { color: '#FFFFFF' }]}>
                            {meta.icon} {meta.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </Card>

            {/* Route Itinerary & Day-by-Day Timeline */}
            <Card style={styles.cardSection}>
              <View style={styles.sectionHeaderRow}>
                <View>
                  <Text style={styles.sectionTitle}>Route Itinerary</Text>
                  <Text style={styles.sectionSubtitle}>{trip.origin} → {trip.destination}</Text>
                </View>
                <View style={styles.counterBadge}>
                  <Text style={styles.counterBadgeText}>
                    {stages.length > 0 ? `${stages.length} STAGES TOTAL` : `${waypoints.length} STOPS TOTAL`}
                  </Text>
                </View>
              </View>

              {/* Next Stop Navigation Button */}
              {(() => {
                const nextStop = waypoints.find(point => point.waypoint_type !== 'origin');
                if (!nextStop) return null;
                return (
                  <TouchableOpacity
                    style={styles.navigateNextBtn}
                    onPress={() => void openDirections(nextStop)}
                  >
                    <Text style={styles.navigateNextBtnText}>Navigate to next stop: {nextStop.name} ↗</Text>
                  </TouchableOpacity>
                );
              })()}

              {/* Day-by-day plan & stages */}
              <View style={{ marginTop: 12 }}>
                <Text style={styles.itineraryHeader}>Day-by-day plan & stages</Text>

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
                      <View key={day.id} style={styles.dayBlock}>
                        <View style={styles.dayBlockHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.dayBlockTitle}>{day.title || 'Day ' + day.day_number}</Text>
                            <Text style={styles.mutedSmall}>{day.trip_date || 'Date not set'}</Text>
                            {!!day.notes && <Text style={styles.mutedSmall}>📝 {day.notes}</Text>}
                          </View>
                          {isAdmin && (
                            <TouchableOpacity style={styles.addStageBtn} onPress={() => openCreateStage(day.day_number)}>
                              <Text style={styles.addStageBtnText}>＋ Add stage</Text>
                            </TouchableOpacity>
                          )}
                        </View>

                        {/* Stages */}
                        {dayStages.length > 0 && (
                          <View style={{ marginTop: 8, gap: 8 }}>
                            <Text style={styles.stageSectionHeader}>RIDING STAGES ({dayStages.length})</Text>
                            {dayStages.map(stage => renderStageCard(stage))}
                          </View>
                        )}

                        {/* Stops in this day */}
                        {dayWaypoints.length > 0 && (
                          <View style={{ marginTop: 8 }}>
                            <Text style={styles.stageSectionHeader}>PLANNED STOPS ({dayWaypoints.length})</Text>
                            {dayWaypoints.map(wp => (
                              <View key={wp.id} style={styles.dayStopRow}>
                                <Text style={styles.dayStopText}>
                                  {wp.waypoint_type.toUpperCase()}: {wp.name}
                                  {wp.notes ? ` · 📝 ${wp.notes}` : ''}
                                </Text>
                                <TouchableOpacity onPress={() => void openDirections(wp)}>
                                  <Text style={styles.link}>Navigate here ↗</Text>
                                </TouchableOpacity>
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

              {/* Stops list & workshop button */}
              <View style={styles.allStopsSection}>
                <Text style={styles.stageSectionHeader}>ALL WAYPOINT STOPS ({waypoints.length})</Text>
                {waypoints.map((point, index) => {
                  const assignedDay = days.find(day => day.id === point.trip_day_id);
                  return (
                    <View key={point.id} style={styles.waypointRow}>
                      <View style={styles.waypointMarker}>
                        <Text style={styles.waypointMarkerText}>{index + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.waypointType}>{point.waypoint_type.toUpperCase()}</Text>
                        <Text style={styles.waypointName}>{point.name}</Text>
                        {!!point.address && <Text style={styles.mutedSmall}>{point.address}</Text>}
                        {point.waypoint_type !== 'origin' && (
                          <TouchableOpacity onPress={() => void openDirections(point)}>
                            <Text style={styles.link}>Navigate here ↗</Text>
                          </TouchableOpacity>
                        )}
                        {isAdmin && (
                          <View style={styles.editorRow}>
                            <TouchableOpacity style={styles.smallButton} disabled={index === 0} onPress={() => moveWaypoint(index, -1)}>
                              <Text style={styles.smallButtonText}>↑</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.smallButton} disabled={index === waypoints.length - 1} onPress={() => moveWaypoint(index, 1)}>
                              <Text style={styles.smallButtonText}>↓</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.smallButton} onPress={() => promptDayAssignment(point)}>
                              <Text style={styles.smallButtonText}>{assignedDay ? 'Day ' + assignedDay.day_number : 'Unassigned'} · change</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}

                {isAdmin && (
                  <View style={{ marginTop: 12, gap: 8 }}>
                    <TouchableOpacity
                      style={styles.primaryWide}
                      onPress={() => router.push('/trip/' + trip.id + '/route')}
                    >
                      <Text style={styles.primaryText}>＋ Add stops & edit route in workshop →</Text>
                    </TouchableOpacity>
                    {waypoints.length > 0 && (
                      <TouchableOpacity style={[styles.secondary, { alignItems: 'center' }]} disabled={saving} onPress={() => void saveItinerary()}>
                        <Text style={styles.secondaryText}>{saving ? 'Saving…' : 'Save stop order & days'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </Card>

            {/* Camp & Safety Manifest / Accommodation */}
            <Card style={styles.cardSection}>
              <Text style={styles.sectionTitle}>Camp & Safety Manifest</Text>
              {stays.length === 0 ? (
                <Text style={styles.muted}>No accommodation added yet.</Text>
              ) : (
                stays.map(stay => (
                  <View key={stay.id} style={styles.stayItem}>
                    <Text style={styles.stayName}>🏨 {stay.name}</Text>
                    <Text style={styles.mutedSmall}>{stay.stay_type} · {stay.check_in || 'Check-in TBD'} – {stay.check_out || 'Check-out TBD'}</Text>
                    {!!stay.address && <Text style={styles.mutedSmall}>{stay.address}</Text>}
                    {stay.price_amount != null ? (
                      <Text style={styles.mutedSmall}>
                        {new Intl.NumberFormat(undefined, { style: 'currency', currency: stay.price_currency }).format(stay.price_amount)}
                      </Text>
                    ) : null}
                  </View>
                ))
              )}

              {isAdmin && (
                <View style={{ marginTop: 10 }}>
                  <Text style={styles.label}>Add accommodation</Text>
                  <TextInput style={styles.input} value={stayName} onChangeText={setStayName} placeholder="Accommodation name" placeholderTextColor={theme.subtle} />
                  <TextInput style={styles.input} value={stayAddress} onChangeText={setStayAddress} placeholder="Address (optional)" placeholderTextColor={theme.subtle} />
                  <Text style={styles.label}>Trip day number (1–{Math.max(days.length, 1)})</Text>
                  <TextInput style={styles.input} value={stayDay} onChangeText={setStayDay} keyboardType="number-pad" placeholder="1" placeholderTextColor={theme.subtle} />
                  <TextInput style={styles.input} value={stayCheckIn} onChangeText={setStayCheckIn} placeholder="Check-in YYYY-MM-DD" placeholderTextColor={theme.subtle} />
                  <TextInput style={styles.input} value={stayCheckOut} onChangeText={setStayCheckOut} placeholder="Check-out YYYY-MM-DD" placeholderTextColor={theme.subtle} />
                  <TextInput style={styles.input} value={stayPrice} onChangeText={setStayPrice} keyboardType="decimal-pad" placeholder="Price in INR (optional)" placeholderTextColor={theme.subtle} />
                  <TouchableOpacity style={styles.primaryWide} disabled={saving} onPress={() => void addStay()}>
                    <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Add accommodation'}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </Card>

            {/* Touring Intelligence & Motorcycle Fuel */}
            <Card style={styles.cardSection}>
              <Text style={styles.sectionTitle}>Touring Intelligence & Motorcycle Fuel</Text>

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
            </Card>

            {/* Pre-Ride Preparation Checklist */}
            <Card style={styles.cardSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Pre-Ride Preparation Checklist</Text>
                <View style={[styles.statusBadge, { backgroundColor: checklists.filter(c => c.my_completed).length === checklists.length && checklists.length > 0 ? theme.green : theme.accent }]}>
                  <Text style={styles.statusText}>
                    {checklists.filter(c => c.my_completed).length}/{checklists.length} READY
                  </Text>
                </View>
              </View>
              <Text style={styles.mutedSmall}>Personal motorcycle and riding safety verification before hitting the highway.</Text>

              {checklists.length === 0 ? (
                <Text style={[styles.mutedSmall, { marginVertical: 10 }]}>No checklist items defined for this ride.</Text>
              ) : (
                checklists.map(item => {
                  const cat = CHECKLIST_CATEGORY_LABELS[item.category] || { title: item.category, icon: '🔧' };
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.checklistItem, item.my_completed && styles.checklistItemDone]}
                      onPress={() => void toggleChecklist(item)}
                    >
                      <View style={[styles.checkbox, item.my_completed && styles.checkboxChecked]}>
                        {item.my_completed && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.checklistTitle, item.my_completed && styles.checklistTitleDone]}>
                          {cat.icon} {item.title}
                        </Text>
                        {!!item.description && <Text style={styles.mutedSmall}>{item.description}</Text>}
                        <Text style={[styles.mutedSmall, { fontSize: 10, marginTop: 2, color: theme.accent }]}>
                          {item.completed_count} rider{item.completed_count === 1 ? '' : 's'} verified
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </Card>

            {/* Regroup Points */}
            <Card style={styles.cardSection}>
              <Text style={styles.sectionTitle}>Regroup points · {regroupPoints.length}</Text>
              {regroupPoints.map(point => {
                const isClosed = point.status === 'closed';
                return (
                  <View key={point.id} style={styles.riderRow}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.pointName}>{point.name}</Text>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: isClosed ? theme.muted : theme.green }}>
                          {isClosed ? 'CLOSED ✓' : 'OPEN'}
                        </Text>
                      </View>
                      <Text style={styles.mutedSmall}>{point.latitude.toFixed(5)}, {point.longitude.toFixed(5)} · {point.arrived_count}/{roster.length} arrived</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {!isClosed && (
                        <TouchableOpacity style={styles.smallButton} disabled={saving || point.my_arrived} onPress={() => void confirmArrival(point)}>
                          <Text style={styles.smallButtonText}>{point.my_arrived ? 'Arrived ✓' : 'Confirm arrival'}</Text>
                        </TouchableOpacity>
                      )}
                      {isAdmin && !isClosed && (
                        <TouchableOpacity style={[styles.smallButton, { borderColor: theme.green }]} disabled={saving} onPress={() => void closeRegroupPoint(point.id)}>
                          <Text style={[styles.smallButtonText, { color: theme.green }]}>Close Point</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
              {isAdmin && (
                <>
                  <Text style={styles.label}>Add regroup point (coordinates)</Text>
                  <TextInput style={styles.input} value={regroupName} onChangeText={setRegroupName} placeholder="Meetup / regroup location" placeholderTextColor={theme.subtle} />
                  <View style={styles.editorRow}>
                    <TextInput style={[styles.input,{flex:1}]} value={regroupLat} onChangeText={setRegroupLat} keyboardType="decimal-pad" placeholder="Latitude" placeholderTextColor={theme.subtle} />
                    <TextInput style={[styles.input,{flex:1}]} value={regroupLng} onChangeText={setRegroupLng} keyboardType="decimal-pad" placeholder="Longitude" placeholderTextColor={theme.subtle} />
                  </View>
                  <TouchableOpacity style={styles.primaryWide} disabled={saving} onPress={() => void addRegroupPoint()}>
                    <Text style={styles.primaryText}>Add regroup point</Text>
                  </TouchableOpacity>
                  <Text style={styles.label}>Route deviation alert threshold (metres)</Text>
                  <TextInput style={styles.input} value={deviationLimit} onChangeText={setDeviationLimit} keyboardType="number-pad" />
                  <Text style={styles.label}>Rider-behind alert threshold (metres)</Text>
                  <TextInput style={styles.input} value={behindLimit} onChangeText={setBehindLimit} keyboardType="number-pad" />
                  <TouchableOpacity style={styles.primaryWide} disabled={saving} onPress={() => void saveSafetySettings()}>
                    <Text style={styles.primaryText}>Save safety thresholds</Text>
                  </TouchableOpacity>
                </>
              )}
            </Card>

            {/* Trip Expenses & Bill Splitting */}
            <Card style={styles.cardSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>💰 Trip Expenses & Splitting</Text>
                <TouchableOpacity style={styles.smallButton} onPress={() => {
                  const activeMemberIds = roster.filter(r => r.is_active).map(r => r.user_id);
                  setNewExpenseSplitUsers(activeMemberIds.length > 0 ? activeMemberIds : user?.id ? [user.id] : []);
                  setExpenseModal(true);
                }}>
                  <Text style={styles.smallButtonText}>＋ Add expense</Text>
                </TouchableOpacity>
              </View>

              {expenseError && (
                <View style={{ backgroundColor: '#FEE2E2', borderColor: '#EF4444', borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 8 }}>
                  <Text style={{ color: '#B91C1C', fontSize: 12, fontWeight: '700' }}>⚠️ {expenseError}</Text>
                  <TouchableOpacity onPress={() => void load()}>
                    <Text style={{ color: '#B91C1C', fontSize: 11, fontWeight: '800', marginTop: 4 }}>Tap to retry</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Spend Overview */}
              {expenseSummary && (
                <View style={styles.expenseSummaryRow}>
                  <View style={styles.expenseSummaryBlock}>
                    <Text style={styles.expenseSummaryValue}>{expenseSummary.currency} {expenseSummary.total_spend}</Text>
                    <Text style={styles.expenseSummaryLabel}>TOTAL SPEND</Text>
                  </View>
                  <View style={styles.expenseSummaryDivider} />
                  <View style={styles.expenseSummaryBlock}>
                    <Text style={styles.expenseSummaryValue}>{expenseSummary.currency} {expenseSummary.my_share}</Text>
                    <Text style={styles.expenseSummaryLabel}>YOUR SHARE</Text>
                  </View>
                  <View style={styles.expenseSummaryDivider} />
                  <View style={styles.expenseSummaryBlock}>
                    <Text style={[
                      styles.expenseSummaryValue,
                      expenseSummary.net_balance > 0 ? { color: theme.green } : expenseSummary.net_balance < 0 ? { color: theme.accent } : null
                    ]}>
                      {expenseSummary.net_balance > 0 ? `+${expenseSummary.currency} ${expenseSummary.net_balance}` : expenseSummary.net_balance < 0 ? `-${expenseSummary.currency} ${Math.abs(expenseSummary.net_balance)}` : `${expenseSummary.currency} 0`}
                    </Text>
                    <Text style={styles.expenseSummaryLabel}>
                      {expenseSummary.net_balance > 0 ? 'YOU ARE OWED' : expenseSummary.net_balance < 0 ? 'YOU OWE' : 'SETTLED'}
                    </Text>
                  </View>
                </View>
              )}

              {/* Settlement Breakdown */}
              {settlements.length > 0 && (
                <View style={styles.settlementContainer}>
                  <Text style={styles.settlementTitle}>SETTLEMENT RESOLUTION</Text>
                  {settlements.map((s, idx) => (
                    <View key={idx} style={styles.settlementRow}>
                      <Text style={styles.settlementFrom}>{s.fromName}</Text>
                      <Text style={styles.settlementArrow}>pays</Text>
                      <Text style={styles.settlementTo}>{s.toName}</Text>
                      <Text style={styles.settlementAmount}>{s.currency} {s.amount}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Expenses List */}
              {expenses === null ? null : expenses.length === 0 ? (
                <Text style={styles.mutedSmall}>No expenses logged yet. Record fuel, food, and stays to split fairly.</Text>
              ) : (
                <View style={{ gap: 8, marginTop: 10 }}>
                  {expenses.map(exp => (
                    <View key={exp.id} style={styles.expenseItem}>
                      <Text style={{ fontSize: 20 }}>{EXPENSE_CATEGORY_META[exp.category]?.icon || '💳'}</Text>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={styles.expenseItemTitle}>{exp.title}</Text>
                          <Text style={styles.expenseItemAmount}>{exp.currency} {exp.amount}</Text>
                        </View>
                        <Text style={styles.mutedSmall}>
                          Paid by {exp.payer_name} · Split among {exp.splits.length} {exp.splits.length === 1 ? 'rider' : 'riders'} ({exp.currency} {exp.splits[0]?.amount || 0}/ea)
                        </Text>
                        {!!exp.notes && (
                          <Text style={[styles.mutedSmall, { fontStyle: 'italic', marginTop: 2 }]}>
                            {exp.notes}
                          </Text>
                        )}
                      </View>
                      {(exp.payer_id === user?.id || isAdmin) && (
                        <TouchableOpacity
                          style={styles.deleteExpenseBtn}
                          onPress={() => handleDeleteExpense(exp.id, exp.title)}
                          accessibilityLabel="Delete expense"
                        >
                          <Text style={styles.deleteExpenseIcon}>✕</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </Card>

            {/* Ride Journal & Travel Memories */}
            <Card style={styles.cardSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>📖 Ride Journal & Memories</Text>
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
            </Card>

            {/* Share Group Ride & Ride Code */}
            <Card style={styles.cardSection}>
              <Text style={styles.sectionTitle}>Share Group Ride & Access</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.surfaceRaised, padding: 12, borderRadius: 10 }}>
                <View>
                  <Text style={styles.mutedSmall}>RIDE CODE</Text>
                  <Text style={{ color: theme.accent, fontSize: 22, fontWeight: '800', letterSpacing: 2 }}>{trip.ride_code}</Text>
                </View>
                <TouchableOpacity
                  style={styles.primary}
                  onPress={() => {
                    void Share.share({
                      message: `Join our motorcycle trip "${trip.name}" on RideNTrack!\nRide Code: ${trip.ride_code}\nRoute: ${trip.origin} → ${trip.destination}\nOpen RideNTrack → Join a Group Ride.`,
                    });
                  }}
                >
                  <Text style={styles.primaryText}>Share Code 📲</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.mutedSmall, { marginTop: 8 }]}>
                Access Mode: {trip.visibility?.toUpperCase() || 'INVITE_ONLY'} · {trip.visibility === 'public' ? '🌍 Public (Community Touring Feed)' : trip.visibility === 'private' ? '🔒 Private (Invited Members Only)' : '🔑 Invite Only (Requires Ride Code)'}
              </Text>
            </Card>

            {/* Action Bar / Trip Administration */}
            <View style={styles.adminActionsCard}>
              <View style={styles.actions}>
                <TouchableOpacity style={[styles.secondary, { flex: 1, alignItems: 'center' }]} onPress={() => void shareItinerary()}>
                  <Text style={styles.secondaryText}>📤 Share touring itinerary</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.secondary, { flex: 1, alignItems: 'center' }]} onPress={duplicateTrip} disabled={saving}>
                  <Text style={styles.secondaryText}>📋 Duplicate trip</Text>
                </TouchableOpacity>
              </View>

              {isAdmin && (
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.primary} onPress={() => router.push('/trip/' + trip.id + '/route')}>
                    <Text style={styles.primaryText}>✎ Edit route & stops</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondary} onPress={openTripEditor}>
                    <Text style={styles.secondaryText}>Trip details</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondary} onPress={() => void toggleArchiveTrip()} disabled={saving}>
                    <Text style={styles.secondaryText}>{trip.status === 'archived' ? '📂 Unarchive' : '📦 Archive'}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {isAdmin && <TouchableOpacity style={styles.dangerButton} disabled={saving} onPress={confirmDeleteTrip}>
                <Text style={styles.dangerText}>{saving ? 'Please wait…' : 'Delete trip permanently'}</Text>
              </TouchableOpacity>}

              {!isAdmin && roster.some(r => r.user_id === user?.id && r.is_active) && (
                <TouchableOpacity style={styles.dangerButton} disabled={saving} onPress={confirmLeaveRide}>
                  <Text style={styles.dangerText}>{saving ? 'Please wait…' : 'Leave group ride'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* Dedicated Sticky Bottom Glove-Friendly Action Trigger */}
      {/* 64dp+ primary button with glowing LED, always visible, never requiring scroll */}
      <View style={[styles.stickyBottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.stickyBottomInner}>
          {/* Tactical SOS Trigger */}
          <TouchableOpacity
            style={styles.tacticalSosBtn}
            onPress={() => {
              Alert.alert(
                'Emergency Distress Ping',
                `Broadcast satellite distress signal to group sweep & base camp for "${trip.name}"?`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Broadcast Distress', style: 'destructive', onPress: () => router.push('/ride/' + trip.id) },
                ]
              );
            }}
            accessibilityLabel="Trip Emergency Broadcast"
          >
            <Text style={styles.tacticalSosIcon}>🚨</Text>
            <Text style={styles.tacticalSosLabel}>EMERG</Text>
          </TouchableOpacity>

          {/* Primary Glove-Operable Kinetic Route Launcher (64dp height standard) */}
          <TouchableOpacity
            style={styles.primaryRouteLauncherBtn}
            onPress={() => router.push('/ride/' + trip.id)}
            accessibilityRole="button"
            accessibilityLabel={isTripOngoing ? 'Open Live Tracker' : 'Start Tracking'}
          >
            <View style={styles.routeLauncherLeft}>
              <LiveDot pulse={isTripOngoing} size={10} />
              <Text style={styles.primaryRouteLauncherText}>
                {isTripOngoing ? 'Open Live Tracker' : 'Start Tracking'}
              </Text>
            </View>
            <Text style={styles.primaryRouteLauncherArrow}>→</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Modals: Stage, Edit Trip, Journal, Role, Expense */}
      <Modal visible={stageModalVisible} transparent animationType="slide" onRequestClose={() => setStageModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.editModal} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionTitle}>Add Riding Stage</Text>
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
            <Text style={styles.sectionTitle}>Edit trip details</Text>
            <Text style={styles.mutedSmall}>You can update the plan even after the ride has started. Changes are saved to the shared trip.</Text>
            <Text style={styles.label}>Trip name</Text>
            <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="Trip name" placeholderTextColor={theme.subtle} />
            <Text style={styles.label}>Description</Text>
            <TextInput style={styles.input} value={editDescription} onChangeText={setEditDescription} placeholder="Description (optional)" placeholderTextColor={theme.subtle} multiline />

            <Text style={styles.label}>Access & Visibility</Text>
            <View style={{ flexDirection: 'row', gap: 6, marginVertical: 6 }}>
              {[
                { key: 'private', label: '🔒 Private' },
                { key: 'invite_only', label: '🔑 Invite Only' },
                { key: 'public', label: '🌍 Public Community' },
              ].map(v => (
                <TouchableOpacity
                  key={v.key}
                  style={[styles.smallButton, editVisibility === v.key && styles.roleSelected]}
                  onPress={() => setEditVisibility(v.key as any)}
                >
                  <Text style={[styles.smallButtonText, editVisibility === v.key && { color: '#fff' }]}>{v.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Maximum Pack Capacity (riders)</Text>
            <TextInput
              style={styles.input}
              value={editMaxParticipants}
              onChangeText={setEditMaxParticipants}
              keyboardType="number-pad"
              placeholder="e.g. 15 (leave blank for unlimited)"
              placeholderTextColor={theme.subtle}
            />

            <Text style={styles.label}>Group Ride Rules & Safety Guidelines</Text>
            <TextInput
              style={[styles.input, { height: 80 }]}
              value={editRideRules}
              onChangeText={setEditRideRules}
              placeholder="e.g. Full riding gear mandatory, headlights ON, staggered formation, no overtaking leader or sweep"
              placeholderTextColor={theme.subtle}
              multiline
            />
            <TouchableOpacity style={styles.primaryWide} disabled={saving} onPress={() => void saveTripDetails()}><Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save trip changes'}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => setEditTripVisible(false)}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={journalModalVisible} transparent animationType="slide" onRequestClose={() => setJournalModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.editModal} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionTitle}>Trip Journal & Photos</Text>
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

      {/* Role Management Modal */}
      <Modal visible={riderRoleModalVisible} transparent animationType="slide" onRequestClose={() => setRiderRoleModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.editModal}>
            <Text style={styles.sectionTitle}>Manage Rider Role</Text>
            {selectedRider && (
              <>
                <Text style={styles.pointName}>{selectedRider.display_name}</Text>
                <Text style={[styles.mutedSmall, { marginBottom: 14 }]}>
                  Current Role: {ROLE_LABELS[selectedRider.role]?.icon || '🏍️'} {ROLE_LABELS[selectedRider.role]?.title || selectedRider.role}
                </Text>

                <Text style={styles.label}>Assign Role</Text>
                <View style={{ gap: 8, marginVertical: 8 }}>
                  {(['co-captain', 'marshal', 'sweeper', 'member'] as const).map(r => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.smallButton, { paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }, selectedRider.role === r && styles.roleSelected]}
                      disabled={saving}
                      onPress={() => void updateRiderRole(r)}
                    >
                      <Text style={{ fontSize: 16 }}>{ROLE_LABELS[r].icon}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.smallButtonText, { fontWeight: '800' }]}>{ROLE_LABELS[r].title}</Text>
                        <Text style={[styles.mutedSmall, { fontSize: 10 }]}>
                          {r === 'co-captain' && 'Route navigator & second-in-command'}
                          {r === 'marshal' && 'Traffic blocker & intersection safety officer'}
                          {r === 'sweeper' && 'Tail rider & roadside mechanical backup'}
                          {r === 'member' && 'Pack rider traveling in formation'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={[styles.label, { marginTop: 10 }]}>Update Attendance Status</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginVertical: 6 }}>
                  {(['confirmed', 'tentative', 'declined', 'attended'] as const).map(att => {
                    const isSel = (selectedRider.attendance_status || 'confirmed') === att;
                    const meta = ATTENDANCE_STATUS_LABELS[att];
                    return (
                      <TouchableOpacity
                        key={att}
                        disabled={updatingAttendance}
                        style={[styles.smallButton, isSel && styles.roleSelected, updatingAttendance && { opacity: 0.5 }]}
                        onPress={async () => {
                          const ok = await handleUpdateAttendance(att, selectedRider.user_id);
                          if (ok) {
                            setSelectedRider(prev => prev ? { ...prev, attendance_status: att } : null);
                          }
                        }}
                      >
                        <Text style={[styles.smallButtonText, isSel && { color: '#fff' }]}>{meta.icon} {meta.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  style={[styles.secondary, { marginTop: 12, alignItems: 'center' }]}
                  disabled={saving}
                  onPress={() => void transferLeadership(selectedRider)}
                >
                  <Text style={[styles.secondaryText, { color: theme.accent, fontWeight: '800' }]}>👑 Transfer Captain Role</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.dangerButton, { marginTop: 8 }]}
                  disabled={saving}
                  onPress={() => void removeParticipant(selectedRider)}
                >
                  <Text style={styles.dangerText}>Remove from Group Ride</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.secondary, { marginTop: 8, alignItems: 'center' }]} onPress={() => setRiderRoleModalVisible(false)}>
                  <Text style={styles.secondaryText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Add Expense Modal */}
      <Modal visible={expenseModal} transparent animationType="slide" onRequestClose={() => setExpenseModal(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.editModal} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionTitle}>💰 Add Trip Expense</Text>
            <Text style={styles.mutedSmall}>Log group spending and split equally among selected riders.</Text>

            <Text style={styles.label}>Expense Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Petrol in Sakleshpur, Dinner at Dhaba"
              placeholderTextColor={theme.subtle}
              value={newExpenseTitle}
              onChangeText={setNewExpenseTitle}
            />

            <Text style={styles.label}>Amount ({trip.expense_currency}) *</Text>
            <TextInput
              style={styles.input}
              placeholder="0.00"
              placeholderTextColor={theme.subtle}
              keyboardType="decimal-pad"
              value={newExpenseAmount}
              onChangeText={setNewExpenseAmount}
            />

            <Text style={styles.label}>Category</Text>
            <View style={styles.categoryRow}>
              {(Object.keys(EXPENSE_CATEGORY_META) as TripExpenseCategory[]).map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.categoryPill, newExpenseCategory === cat && styles.categoryPillActive]}
                  onPress={() => setNewExpenseCategory(cat)}
                >
                  <Text style={[styles.categoryPillText, newExpenseCategory === cat && styles.categoryPillTextActive]}>
                    {EXPENSE_CATEGORY_META[cat].icon} {EXPENSE_CATEGORY_META[cat].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Split Among Riders ({newExpenseSplitUsers.length} selected)</Text>
            <View style={{ gap: 4, marginVertical: 4 }}>
              {roster.filter(r => r.is_active).map(r => {
                const isSelected = newExpenseSplitUsers.includes(r.user_id);
                return (
                  <TouchableOpacity
                    key={r.user_id}
                    style={styles.splitUserRow}
                    onPress={() => {
                      setNewExpenseSplitUsers(prev =>
                        isSelected ? prev.filter(uid => uid !== r.user_id) : [...prev, r.user_id]
                      );
                    }}
                  >
                    <Text style={{ fontSize: 16 }}>{isSelected ? '☑' : '☐'}</Text>
                    <Text style={styles.splitUserName}>{r.display_name} {r.user_id === user?.id ? '(you)' : ''}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Any details (e.g. paid via UPI)"
              placeholderTextColor={theme.subtle}
              value={newExpenseNotes}
              onChangeText={setNewExpenseNotes}
            />

            <TouchableOpacity style={styles.primaryWide} disabled={saving} onPress={handleAddExpense}>
              <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save Expense'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => setExpenseModal(false)}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  screenWrapper: { flex: 1, backgroundColor: c.background },
  topHeader: { backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border },
  topHeaderInner: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  backButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  backButtonText: { color: c.text, fontSize: 24, fontWeight: '700' },
  topHeaderTitleContainer: { flex: 1, marginHorizontal: 8 },
  topHeaderEyebrow: { color: c.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  topHeaderTitle: { color: c.text, fontSize: 16, fontWeight: '800' },
  topHeaderRight: { width: 44, alignItems: 'flex-end', justifyContent: 'center' },

  container: { flex: 1, backgroundColor: c.background },
  content: { padding: 16 },

  center: { flex: 1, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { color: c.text, fontSize: 24, fontWeight: '800' },
  muted: { color: c.muted, fontSize: 13, lineHeight: 19 },
  mutedSmall: { color: c.muted, fontSize: 11, lineHeight: 16 },
  link: { color: c.accent, fontSize: 12, fontWeight: '700', marginTop: 4 },

  heroCoverWrapper: { borderRadius: 16, overflow: 'hidden', backgroundColor: c.surface, position: 'relative' },
  heroOverlayContent: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: 14, justifyContent: 'space-between', backgroundColor: '#00000044' },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroActionBtn: { backgroundColor: '#00000099', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: '#ffffff22' },
  heroActionBtnText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  heroBottomBlock: { gap: 2 },
  heroEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroEyebrowText: { color: c.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  heroDot: { color: c.muted, fontSize: 10 },
  heroEyebrowMuted: { color: '#FFFFFF99', fontSize: 10, fontWeight: '700' },
  heroTripName: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', letterSpacing: -0.4 },
  heroRouteRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  heroRouteText: { color: '#FFFFFFEE', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  heroRouteArrow: { color: c.accent, fontSize: 14, fontWeight: '800' },

  telemetryStrip: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: c.border },
  telemetryCol: { flex: 1 },
  telemetryDivider: { width: 1, height: 28, backgroundColor: c.border, marginHorizontal: 12 },
  telemetryLabel: { color: c.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  telemetryValue: { color: c.text, fontSize: 15, fontWeight: '800', marginTop: 2 },
  telemetrySub: { color: c.muted, fontSize: 11, fontWeight: '600' },

  stickySwitcherContainer: { marginVertical: 12 },
  segmentedWrapper: { flexDirection: 'row', backgroundColor: c.surface, borderRadius: 14, padding: 4, borderWidth: 1, borderColor: c.border },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  segmentBtnActive: { backgroundColor: c.accent },
  segmentBtnText: { color: c.muted, fontSize: 13, fontWeight: '800' },
  segmentBtnTextActive: { color: '#000000' },
  liveSegmentInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  liveRadarContainer: { marginVertical: 8 },
  liveRadarCard: { padding: 16, borderRadius: 16 },
  liveRadarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  liveRadarTitle: { color: c.text, fontSize: 13, fontWeight: '800', letterSpacing: 0.8 },
  liveRadarDescription: { color: c.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  liveRadarStatsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.border },
  liveRadarStat: { alignItems: 'center' },
  liveRadarStatValue: { color: c.text, fontSize: 15, fontWeight: '800' },
  liveRadarStatLabel: { color: c.muted, fontSize: 9, fontWeight: '700', marginTop: 2 },
  launchRideModeBtn: { backgroundColor: c.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  launchRideModeBtnText: { color: '#000000', fontSize: 14, fontWeight: '800' },

  cardSection: { padding: 16, borderRadius: 16, marginTop: 12 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { color: c.text, fontSize: 16, fontWeight: '800' },
  sectionSubtitle: { color: c.muted, fontSize: 12, marginTop: 2 },
  tierPill: { backgroundColor: c.accentSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  tierPillText: { color: c.accent, fontSize: 10, fontWeight: '800' },
  counterBadge: { backgroundColor: c.surfaceRaised, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  counterBadgeText: { color: c.muted, fontSize: 10, fontWeight: '800' },
  activePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#10B98122', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  greenPulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.green },
  activePillText: { color: c.green, fontSize: 10, fontWeight: '800' },

  elevationSparklineBox: { height: 60, position: 'relative', marginVertical: 8, justifyContent: 'flex-end', overflow: 'hidden', borderRadius: 8 },
  elevationBarGraph: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: '100%', paddingHorizontal: 4 },
  elevationBar: { width: '6%', backgroundColor: c.accent, opacity: 0.65, borderRadius: 3 },
  elevationGradientFill: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: c.accent },

  elevationStatsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border },
  elevationStatBlock: { alignItems: 'center', flex: 1 },
  elevationStatLabel: { color: c.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  elevationStatValue: { color: c.text, fontSize: 14, fontWeight: '800', marginTop: 2 },

  collapsedRosterContainer: { marginTop: 6 },
  collapsedRosterTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  collapsedRosterSummary: { flex: 1 },
  collapsedRosterTitle: { color: c.text, fontSize: 14, fontWeight: '800' },
  collapsedRosterSub: { color: c.muted, fontSize: 12, marginTop: 2 },
  expandRosterBtn: { marginTop: 12, backgroundColor: c.surfaceRaised, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  expandRosterBtnText: { color: c.accent, fontSize: 11, fontWeight: '800' },

  expandedRosterContainer: { marginTop: 6 },
  searchBarBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.background, borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: c.border, height: 42, marginBottom: 10 },
  searchIcon: { fontSize: 14, marginRight: 8 },
  searchInput: { flex: 1, color: c.text, fontSize: 13 },
  searchClear: { color: c.muted, fontSize: 14, padding: 4 },
  rosterList: { gap: 8 },
  riderRowItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, backgroundColor: c.surfaceRaised, borderRadius: 12 },
  riderRowAlert: { borderColor: c.danger, borderWidth: 1 },
  riderRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  riderRowMeta: { flex: 1 },
  riderRowNameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  riderName: { color: c.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  leaderPill: { backgroundColor: c.accentSoft, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  leaderPillText: { color: c.accent, fontSize: 9, fontWeight: '800' },
  sweepPill: { backgroundColor: c.surface, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  sweepPillText: { color: c.tertiary, fontSize: 9, fontWeight: '800' },
  alertPill: { backgroundColor: '#EF444422', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  alertPillText: { color: c.danger, fontSize: 9, fontWeight: '800' },
  riderBikeText: { color: c.muted, fontSize: 11, marginTop: 2 },
  riderRowRight: { alignItems: 'flex-end', gap: 4 },
  riderStatusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  manageRiderBtn: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: c.border },
  manageRiderBtnText: { color: c.muted, fontSize: 10, fontWeight: '700' },
  collapseRosterBtn: { marginTop: 10, alignItems: 'center', paddingVertical: 8 },
  collapseRosterBtnText: { color: c.accent, fontSize: 11, fontWeight: '800' },

  rsvpBox: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border },
  rsvpTitle: { color: c.text, fontSize: 12, fontWeight: '800', marginBottom: 6 },
  rsvpButtonsRow: { flexDirection: 'row', gap: 6 },
  rsvpBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceRaised },
  rsvpBtnSelected: { backgroundColor: c.accent, borderColor: c.accent },
  rsvpBtnText: { color: c.text, fontSize: 11, fontWeight: '700' },

  navigateNextBtn: { backgroundColor: c.accentSoft, borderWidth: 1, borderColor: c.accent, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center', marginVertical: 8 },
  navigateNextBtnText: { color: c.accent, fontSize: 12, fontWeight: '800' },

  itineraryHeader: { color: c.text, fontSize: 14, fontWeight: '800', marginVertical: 6 },
  dayBlock: { borderTopWidth: 1, borderTopColor: c.border, paddingVertical: 12 },
  dayBlockHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  dayBlockTitle: { color: c.text, fontSize: 14, fontWeight: '800' },
  addStageBtn: { borderWidth: 1, borderColor: c.accent, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  addStageBtnText: { color: c.accent, fontSize: 10, fontWeight: '800' },
  stageSectionHeader: { color: c.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginTop: 8, marginBottom: 4 },
  dayStopRow: { paddingVertical: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayStopText: { color: c.text, fontSize: 12, flex: 1 },
  dayStayText: { color: c.accent, fontSize: 11, fontWeight: '700', marginTop: 2 },

  allStopsSection: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border },
  waypointRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border },
  waypointMarker: { width: 24, height: 24, borderRadius: 12, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  waypointMarkerText: { color: c.accent, fontSize: 10, fontWeight: '800' },
  waypointType: { color: c.accent, fontSize: 9, fontWeight: '800' },
  waypointName: { color: c.text, fontSize: 13, fontWeight: '700', marginTop: 1 },

  stayItem: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border },
  stayName: { color: c.text, fontSize: 13, fontWeight: '700' },

  intelBlock: { marginBottom: 14 },
  intelTitle: { color: c.text, fontSize: 13, fontWeight: '800', marginBottom: 8 },
  fuelRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: c.surfaceRaised, borderRadius: 12, padding: 10, marginBottom: 8 },
  fuelStat: { alignItems: 'center' },
  fuelStatValue: { color: c.text, fontSize: 14, fontWeight: '800' },
  fuelStatLabel: { color: c.muted, fontSize: 8, fontWeight: '800', letterSpacing: 0.8, marginTop: 2 },
  fuelCostText: { color: c.accent, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  weatherCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surfaceRaised, borderRadius: 12, padding: 10 },
  advisoryItem: { borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1 },
  advisoryTitle: { color: c.text, fontSize: 12, fontWeight: '800', marginBottom: 2 },
  advisoryDesc: { color: c.muted, fontSize: 11, lineHeight: 16 },
  advisoryWarning: { backgroundColor: c.accentSoft, borderColor: c.danger },
  advisoryCaution: { backgroundColor: '#FEF9C3', borderColor: '#CA8A04' },
  advisoryInfo: { backgroundColor: c.surfaceRaised, borderColor: c.border },

  statusBadge: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  checklistItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border },
  checklistItemDone: { opacity: 0.85 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: c.muted, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: c.accent, borderColor: c.accent },
  checkmark: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  checklistTitle: { color: c.text, fontSize: 13, fontWeight: '700' },
  checklistTitleDone: { textDecorationLine: 'line-through', color: c.muted },

  riderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border },
  pointName: { color: c.text, fontSize: 13, fontWeight: '700' },

  expenseSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: c.surfaceRaised, borderRadius: 12, padding: 12, marginTop: 4, marginBottom: 12 },
  expenseSummaryBlock: { alignItems: 'center', flex: 1 },
  expenseSummaryValue: { color: c.text, fontSize: 15, fontWeight: '900' },
  expenseSummaryLabel: { color: c.muted, fontSize: 8, fontWeight: '800', letterSpacing: 0.8, marginTop: 3 },
  expenseSummaryDivider: { width: 1, height: 26, backgroundColor: c.border },
  settlementContainer: { backgroundColor: c.accentSoft, borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: c.accent },
  settlementTitle: { color: c.accent, fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 6 },
  settlementRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 2 },
  settlementFrom: { color: c.text, fontSize: 12, fontWeight: '700' },
  settlementArrow: { color: c.muted, fontSize: 11 },
  settlementTo: { color: c.text, fontSize: 12, fontWeight: '700' },
  settlementAmount: { color: c.accent, fontSize: 12, fontWeight: '900', marginLeft: 'auto' },
  expenseItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: c.surfaceRaised, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: c.border },
  expenseItemTitle: { color: c.text, fontSize: 13, fontWeight: '800' },
  expenseItemAmount: { color: c.accent, fontSize: 13, fontWeight: '900' },
  deleteExpenseBtn: { padding: 4 },
  deleteExpenseIcon: { color: c.muted, fontSize: 12, fontWeight: '700' },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 4 },
  categoryPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: c.background, borderWidth: 1, borderColor: c.border },
  categoryPillActive: { backgroundColor: c.accentSoft, borderColor: c.accent },
  categoryPillText: { color: c.text, fontSize: 11, fontWeight: '700' },
  categoryPillTextActive: { color: c.accent, fontWeight: '800' },
  splitUserRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border },
  splitUserName: { color: c.text, fontSize: 12, fontWeight: '600' },

  adminActionsCard: { padding: 8, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 8, marginVertical: 6 },
  primary: { flex: 1, backgroundColor: c.accent, borderRadius: 10, padding: 12, alignItems: 'center' },
  primaryText: { color: '#000000', fontWeight: '800', fontSize: 12 },
  secondary: { borderColor: c.border, borderWidth: 1, borderRadius: 10, padding: 12 },
  secondaryText: { color: c.text, fontWeight: '700', fontSize: 12 },
  primaryWide: { backgroundColor: c.accent, borderRadius: 11, padding: 13, alignItems: 'center', marginTop: 10 },
  dangerButton: { borderWidth: 1, borderColor: c.danger, backgroundColor: c.surface, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  dangerText: { color: c.danger, fontWeight: '900', fontSize: 12 },
  error: { color: c.danger, marginTop: 12, textAlign: 'center' },

  // Dedicated Sticky Bottom Bar
  stickyBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    backgroundColor: c.surface + 'FA',
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  stickyBottomInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  tacticalSosBtn: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: c.surfaceRaised,
    borderWidth: 1,
    borderColor: c.danger + '66',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tacticalSosIcon: { fontSize: 20 },
  tacticalSosLabel: { color: c.danger, fontSize: 9, fontWeight: '900', letterSpacing: 0.8, marginTop: 2 },
  primaryRouteLauncherBtn: {
    flex: 1,
    height: 64,
    borderRadius: 16,
    backgroundColor: c.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    shadowColor: c.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  routeLauncherLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  primaryRouteLauncherText: { color: '#000000', fontSize: 16, fontWeight: '900', letterSpacing: 0.4 },
  primaryRouteLauncherArrow: { color: '#000000', fontSize: 22, fontWeight: '900' },

  // Stage card & modal styles
  stageCard: { backgroundColor: c.background, borderColor: c.border, borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 6 },
  stageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  stageTitle: { color: c.text, fontSize: 13, fontWeight: '800' },
  stageEndpoints: { color: c.muted, fontSize: 11, marginTop: 2 },
  stageMetaText: { color: c.accent, fontSize: 10, fontWeight: '700', marginTop: 3 },
  stageStatusPill: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  stageStatusText: { fontSize: 10, fontWeight: '800' },
  stageNotes: { color: c.text, fontSize: 11, lineHeight: 15, marginTop: 6, fontStyle: 'italic' },
  stageActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  remove: { color: c.danger, fontSize: 11, fontWeight: '700' },
  label: { color: c.text, fontSize: 11, fontWeight: '700', marginTop: 10, marginBottom: 5 },
  input: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 11, color: c.text, marginTop: 6, fontSize: 13 },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' },
  editModal: { maxHeight: '90%', backgroundColor: c.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20 },
  smallButton: { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  smallButtonText: { color: c.accent, fontSize: 10, fontWeight: '700' },
  roleSelected: { borderColor: c.accent, backgroundColor: c.accentSoft },
  editorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
});
