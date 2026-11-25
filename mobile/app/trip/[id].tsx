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
  StatusBar,
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
  type ExternalNavProvider,
  type RoutePoint,
  type TripStage,
  type StageStatus,
  calculateMotorcycleFuelPlan,
  calculatePackFuelPlan,
  evaluateDaylightRisk,
  generateTouringAdvisories,
  getWeatherConditionFromCode,
  type RouteWeatherPoint,
  type TripJournalEntry,
  type JournalPhoto,
  formatShareableRideCard,
  ROLE_LABELS,
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
  estimateBattery,
} from '@ridentrack/shared';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, RidePalette, radius, spacing, typography } from '../../src/theme';
import { saveCachedTrip, getCachedTrip, clearCachedTrip } from '../../src/lib/tripCache';
import {
  formatNavProviderLabel,
  getDefaultNavProvider,
  getPreferredNavProvider,
  openExternalNavLeg,
  setPreferredNavProvider,
} from '../../src/lib/externalNav';
import { stopBackgroundLocationUpdates } from '../../src/services/backgroundLocation';
import { leaveRideSafely } from '../../src/services/leaveRide';
import {
  Avatar,
  AvatarStack,
  Card,
  FallbackTripCover,
  Icon,
  IconName,
  LiveDot,
  RouteLine,
  StatusBadge,
  SheetModal,
} from '../../src/components/ui';
import { ATTENDANCE_ICONS, CHECKLIST_ICONS, EXPENSE_ICONS, ROLE_ICONS, weatherIcon } from '../../src/icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import type { Trip, Waypoint, Day, Regroup, RiderFuelSpec, Rider, Stay } from '../../src/components/trip/types';
import { makeTripStyles as makeStyles } from '../../src/components/trip/tripStyles';
import { TripLiveRadar } from '../../src/components/trip/TripLiveRadar';
import { PackReadinessList, RideReadyCard } from '../../src/components/trip/RideReadyCard';
import { useFamilyContacts } from '../../src/hooks/useFamilyContacts';
import { useBatteryLevel } from '../../src/hooks/useBatteryLevel';
import { useOfflineMaps } from '../../src/hooks/useOfflineMaps';
import { FamilyContactsSheet } from '../../src/components/trip/FamilyContactsSheet';
import { useRideReadiness } from '../../src/hooks/useRideReadiness';

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
  const [navProvider, setNavProvider] = useState<ExternalNavProvider>(getDefaultNavProvider);
  const [navLegIndex, setNavLegIndex] = useState(0);
  const [navLegCount, setNavLegCount] = useState(1);

  useEffect(() => {
    void getPreferredNavProvider().then(setNavProvider);
  }, []);

  async function toggleNavProvider() {
    const next: ExternalNavProvider = navProvider === 'google_maps' ? 'apple_maps' : 'google_maps';
    setNavProvider(next);
    setNavLegIndex(0);
    setNavLegCount(1);
    await setPreferredNavProvider(next);
  }

  async function navigateLeg(points: RoutePoint[], legIndex = 0, trackState = false) {
    try {
      const res = await openExternalNavLeg(points, navProvider, { legIndex });
      if (trackState) {
        setNavLegCount(res.legCount);
        setNavLegIndex(res.legIndex);
      }
    } catch (e: any) {
      Alert.alert('Could not open navigation', e?.message || 'Please check that a maps app is available and try again.');
    }
  }
  const [roster, setRoster] = useState<Rider[]>([]);
  const [fuelSpecs, setFuelSpecs] = useState<Record<string, RiderFuelSpec>>({});
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

  const packFuelPlan = useMemo(() => {
    const distKm = (trip?.estimated_distance_meters || 0) / 1000;
    return calculatePackFuelPlan(
      roster.map(r => {
        // Your own profile is freshest; other riders come from the ride's fuel specs.
        const own = r.user_id === user?.id;
        const spec = fuelSpecs[r.user_id];
        const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
        return {
          id: r.user_id,
          displayName: r.display_name,
          tankLiters: own ? profile?.fuel_tank_capacity_liters : num(spec?.fuel_tank_capacity_liters),
          mileageKmPerL: own ? profile?.mileage_km_per_liter : num(spec?.mileage_km_per_liter),
          reserveLiters: own ? profile?.fuel_reserve_liters : num(spec?.fuel_reserve_liters),
        };
      }),
      distKm,
    );
  }, [trip?.estimated_distance_meters, roster, fuelSpecs, user?.id, profile]);

  const advisories = useMemo(() => {
    const base = generateTouringAdvisories({
      distanceMeters: trip?.estimated_distance_meters || 0,
      fuelPlan,
      weatherPoints,
    });
    if (trip?.start_date && trip?.estimated_duration_seconds) {
      // Judge each riding day against its own departure and sunset. A
      // multi-day trip is not one 07:00 start with the whole route in a day.
      const terrain = trip.trip_type === 'expedition' ? 'ghat' : 'mixed';
      const startMs = Date.parse(`${trip.start_date.slice(0, 10)}T00:00:00`);
      const dayDurations = new Map<number, number>();
      for (const stage of stages) {
        const day = stage.day_number || 1;
        const secs = Number(stage.estimated_duration_seconds) || 0;
        if (secs > 0) dayDurations.set(day, (dayDurations.get(day) || 0) + secs);
      }
      if (dayDurations.size === 0) {
        const endMs = trip.end_date ? Date.parse(`${trip.end_date.slice(0, 10)}T00:00:00`) : startMs;
        const dayCount = Math.max(1, days.length, Number.isFinite(endMs) ? Math.round((endMs - startMs) / 86_400_000) + 1 : 1);
        for (let d = 1; d <= dayCount; d++) dayDurations.set(d, trip.estimated_duration_seconds / dayCount);
      }
      for (const [dayNumber, secs] of [...dayDurations.entries()].sort((a, b) => a[0] - b[0])) {
        const dayStart = new Date(startMs + (dayNumber - 1) * 86_400_000);
        const ymd = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`;
        const daylight = evaluateDaylightRisk(
          new Date(`${ymd}T07:00:00`).toISOString(), secs, new Date(`${ymd}T18:00:00`).toISOString(), terrain,
        );
        if (daylight.advisory) {
          base.unshift(dayDurations.size > 1
            ? { ...daylight.advisory, title: `Day ${dayNumber}: ${daylight.advisory.title}` }
            : daylight.advisory);
          break;
        }
      }
    }
    if (packFuelPlan.limitingRider && packFuelPlan.recommendedFuelStops !== null) {
      const missingCount = packFuelPlan.ridersMissingSpecs.length;
      const missingNames = packFuelPlan.ridersMissingSpecs
        .slice(0, 3)
        .map(r => r.displayName)
        .join(', ');
      base.unshift({
        type: 'fuel',
        level: missingCount > 0 ? 'caution' : 'info',
        title: missingCount > 0
          ? `Partial Pack Fuel Cadence: Every ${packFuelPlan.fuelIntervalKm} km`
          : `Pack Fuel Cadence: Every ${packFuelPlan.fuelIntervalKm} km`,
        description: missingCount > 0
          ? `Based on ${packFuelPlan.ridersWithSpecs}/${packFuelPlan.ridersWithSpecs + missingCount} rider(s) (${packFuelPlan.limitingRider.displayName}: ${packFuelPlan.limitingRider.safeRangeKm} km). Missing bike specs for: ${missingNames}${missingCount > 3 ? ` +${missingCount - 3} more` : ''}.`
          : `Limited by ${packFuelPlan.limitingRider.displayName} (${packFuelPlan.limitingRider.safeRangeKm} km safe range) · ${packFuelPlan.recommendedFuelStops} stop(s) needed.`,
      });
    }
    return base;
  }, [trip?.estimated_distance_meters, trip?.start_date, trip?.end_date, trip?.estimated_duration_seconds, trip?.trip_type, stages, days, fuelPlan, weatherPoints, packFuelPlan]);

  const isAdmin = !!user && trip?.admin_id === user.id;
  // R5: one Ride ready card replaces scattered setup prompts.
  const family = useFamilyContacts();
  const { levelPercent: batteryLevel } = useBatteryLevel();
  // F4: one sentence, from the rider's role and the planned riding time.
  const batteryFootnote = useMemo(() => {
    if (!trip) return null;
    const role = isAdmin ? 'captain' : roster.find(r => r.user_id === user?.id)?.role ?? null;
    const dayHours = trip.estimated_duration_seconds ? Math.min(12, (trip.estimated_duration_seconds / 3600) * 1.3) : 8;
    return `Battery: ${estimateBattery({ role, hours: Math.max(1, Math.round(dayHours)), levelPercent: batteryLevel }).sentence}`;
  }, [trip, isAdmin, roster, user?.id, batteryLevel]);
  const [familySheetVisible, setFamilySheetVisible] = useState(false);
  const readinessHandlers = useMemo(() => ({
    edit_emergency_contact: () => router.push('/(tabs)/profile'),
    edit_phone: () => router.push('/(tabs)/profile'),
    open_bike_picker: () => router.push('/(tabs)/profile'),
    add_family_contact: () => setFamilySheetVisible(true),
    download_offline_maps: () => void offlineMapsRef.current(),
  }), [router]);
  const offline = useOfflineMaps(trip);
  const offlineMapsRef = useRef(offline.download);
  offlineMapsRef.current = offline.download;
  const readiness = useRideReadiness(id, {
    familyContactsCount: family.loaded ? family.contacts.length : null,
    offlineMaps: offline.state,
    offlineMapsDetail: offline.error ?? offline.badge?.detail ?? null,
  }, readinessHandlers);
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
      // Stages are cached with the itinerary; a failed read must not be
      // shown (or cached) as "no stages".
      if (stageResult.error) throw stageResult.error;
      setTrip(tripResult.data as Trip);
      setWaypoints((waypointResult.data || []) as Waypoint[]);
      setDays((dayResult.data || []) as Day[]);
      setStays((stayResult.data || []) as Stay[]);
      setStages((stageResult.data || []) as TripStage[]);
      setRoster((rosterResult.data || []) as Rider[]);
      // Fuel specs of every active rider, so the pack plan reflects the bike
      // with the shortest range, not just this phone's owner. Best effort.
      void supabase.rpc('get_ride_fuel_specs', { p_ride_id: id }).then(({ data }) => {
        if (!Array.isArray(data)) return;
        setFuelSpecs(Object.fromEntries((data as RiderFuelSpec[]).map(spec => [spec.user_id, spec])));
      });
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

      if (checklistResult.error) {
        // Keep the current checklist and never seed defaults over a failed read.
        setError('Checklist unavailable: ' + checklistResult.error.message);
      } else {
        let clData = (checklistResult.data || []) as TripChecklistItem[];
        if (clData.length === 0 && tripResult.data?.admin_id === user?.id) {
          await supabase.rpc('seed_default_trip_checklists', { p_ride_id: id });
          const { data: refetched } = await supabase.rpc('get_trip_checklists', { p_ride_id: id });
          if (refetched) clData = refetched as TripChecklistItem[];
        }
        if (generation === loadGeneration.current) setChecklists(clData);
      }

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

  // Reset active tab to 'details' whenever live tracking is unavailable
  useEffect(() => {
    if (!canShowLiveTracker && activeTab === 'live') {
      setActiveTab('details');
    }
  }, [canShowLiveTracker, activeTab]);

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
      if (!user?.id) throw new Error('Sign in again to leave this ride.');
      await leaveRideSafely(id, user.id);
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
      Alert.alert('Regroup point closed', 'The regroup point has been closed and the pack notified.');
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
    setStageStartCoords(
      trip?.origin_coords && trip.origin_coords.length === 2
        ? `${trip.origin_coords[0]}, ${trip.origin_coords[1]}`
        : ''
    );
    setStageDestCoords(
      trip?.destination_coords && trip.destination_coords.length === 2
        ? `${trip.destination_coords[0]}, ${trip.destination_coords[1]}`
        : ''
    );
    setStageDayNumber(String(dayNumber));
    setStageNotes('');
    setStageModalVisible(true);
  }

  function parseCoordinateInput(input: string, fallback?: [number, number] | null): [number, number] | null {
    const trimmed = input.trim();
    if (!trimmed) {
      if (fallback && fallback.length === 2 && Number.isFinite(fallback[0]) && Number.isFinite(fallback[1])) {
        return [fallback[0], fallback[1]];
      }
      return null;
    }
    const parts = trimmed.split(/[\s,]+/).filter(Boolean).map(Number);
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      const [lng, lat] = parts;
      if (lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) {
        return [lng, lat];
      }
    }
    return null;
  }

  async function saveStage() {
    if (!stageName.trim() || !stageStart.trim() || !stageDestination.trim()) {
      Alert.alert('Required fields', 'Stage name, start, and destination are required.');
      return;
    }

    const startCoords = parseCoordinateInput(stageStartCoords, trip?.origin_coords);
    const destCoords = parseCoordinateInput(stageDestCoords, trip?.destination_coords);

    if (!startCoords || !destCoords) {
      Alert.alert(
        'Invalid coordinates',
        'Valid start and destination coordinates (lng, lat) are required (e.g. 77.59, 12.97).'
      );
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
          start_coords: startCoords,
          destination_coords: destCoords,
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
    const statusMeta: { label: string; color: string; icon: IconName } = {
      planned: { label: 'Planned', color: theme.muted, icon: 'time-outline' as IconName },
      in_progress: { label: 'Riding', color: theme.accent, icon: 'play-circle-outline' as IconName },
      completed: { label: 'Completed', color: theme.green, icon: 'checkmark-circle-outline' as IconName },
      skipped: { label: 'Skipped', color: theme.subtle, icon: 'play-skip-forward-outline' as IconName },
    }[stage.status] || { label: 'Planned', color: theme.muted, icon: 'time-outline' };

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
            <Icon name={statusMeta.icon} size="xs" color={statusMeta.color} />
            <Text style={[styles.stageStatusText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
          </TouchableOpacity>
        </View>
        {!!stage.notes && (
          <Text style={styles.stageNotes}>{stage.notes}</Text>
        )}
        <View style={styles.stageActions}>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() =>
              void navigateLeg([
                {
                  sequence: 0,
                  waypoint_type: 'origin',
                  name: stage.start_name,
                  latitude: stage.start_coords[1],
                  longitude: stage.start_coords[0],
                },
                {
                  sequence: 1,
                  waypoint_type: 'destination',
                  name: stage.destination_name,
                  latitude: stage.destination_coords[1],
                  longitude: stage.destination_coords[0],
                },
              ])
            }
          >
            <Icon name="navigate-outline" size="xs" color={theme.accent} />
            <Text style={styles.linkText}>Navigate Leg ({formatNavProviderLabel(navProvider)})</Text>
          </TouchableOpacity>
          {isAdmin && (
            <TouchableOpacity onPress={() => confirmDeleteStage(stage.id, stage.name)}>
              <Text style={styles.remove}>Remove stage</Text>
            </TouchableOpacity>
          )}
        </View>
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

  const topInset = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0);
  const safeHeaderTop = Math.max(topInset, Platform.OS === 'android' ? 48 : 44) + 18;

  return (
    <View style={styles.screenWrapper}>
      {/* Top Header Bar */}
      <View style={[styles.topHeader, { paddingTop: safeHeaderTop }]}>
        <View style={styles.topHeaderInner}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Icon name="arrow-back" size="lg" color={theme.text} />
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
              {offline.badge && trip.status !== 'completed' ? (
                <TouchableOpacity
                  style={[styles.heroActionBtn, { marginLeft: 'auto', marginRight: 8, backgroundColor: offline.badge.tone === 'ok' ? theme.green : 'rgba(0,0,0,0.55)' }]}
                  onPress={() => { if (offline.state !== 'ready' && offline.state !== 'downloading') void offline.download(); }}
                  accessibilityRole="button"
                  accessibilityLabel={`${offline.badge.label}. ${offline.badge.detail}`}
                >
                  <Icon name={offline.badge.tone === 'ok' ? 'cloud-done-outline' : 'cloud-download-outline'} size="xs" color={theme.onAccent} />
                  <Text style={styles.heroActionBtnText}>{offline.badge.label}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.heroActionBtn}
                onPress={() => void exportGpxFile()}
                accessibilityLabel="Export GPX route"
              >
                <Icon name="download-outline" size="xs" color={theme.onAccent} />
                <Text style={styles.heroActionBtnText}>GPX</Text>
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
                  Details
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
          <TripLiveRadar
            styles={styles}
            trip={trip}
            isTripOngoing={isTripOngoing}
            activeRosterCount={activeRosterCount}
            rosterCount={roster.length}
            distance={distance}
            waypointCount={waypoints.length}
          />
        )}

        {/* ================= DETAILS SECTION ================= */}
        {(activeTab === 'details' || !canShowLiveTracker) && (
          <>
            {(trip.status === 'planned' || isTripOngoing) && (
              <RideReadyCard items={readiness.items} summary={readiness.summary} onFix={item => void readiness.fix(item)} footnote={batteryFootnote} />
            )}
            {isAdmin && trip.status === 'planned' && roster.length > 1 && (
              <PackReadinessList rideId={trip.id} roster={roster} />
            )}
            <FamilyContactsSheet
              visible={familySheetVisible}
              onClose={() => setFamilySheetVisible(false)}
              bottomInset={insets.bottom}
              contacts={family.contacts}
              onSave={family.save}
              onRemove={family.remove}
              onPause={family.setPaused}
            />

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
                    <Icon name="search-outline" size="sm" color={theme.textMuted} style={styles.searchIcon} />
                    <TextInput
                      style={styles.searchInput}
                      value={participantSearch}
                      onChangeText={setParticipantSearch}
                      placeholder="Filter riders, callsigns, or motorcycle models..."
                      placeholderTextColor={theme.subtle}
                    />
                    {participantSearch.length > 0 && (
                      <TouchableOpacity
                        onPress={() => setParticipantSearch('')}
                        accessibilityRole="button"
                        accessibilityLabel="Clear rider search"
                      >
                        <Icon name="close-circle" size="md" color={theme.muted} style={styles.searchClear} />
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
                      const roleMeta = ROLE_LABELS[rider.role] || { title: rider.role };
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
                                  <View style={styles.leaderPill}><Text style={styles.leaderPillText}>LEADER</Text></View>
                                ) : isSweep ? (
                                  <View style={styles.sweepPill}><Text style={styles.sweepPillText}>SWEEP</Text></View>
                                ) : hasAlert ? (
                                  <View style={styles.alertPill}><Text style={styles.alertPillText}>ALERT</Text></View>
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
                                <Icon name="settings-outline" size="xs" color={theme.muted} />
                                <Text style={styles.manageRiderBtnText}>Manage</Text>
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
                          <Icon name={ATTENDANCE_ICONS[status]} size="xs" color={isSelected ? theme.onAccent : theme.textMuted} />
                          <Text style={[styles.rsvpBtnText, isSelected && { color: theme.onAccent }]}>{meta.label}</Text>
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.sm, flexWrap: 'wrap' }}>
                    <TouchableOpacity
                      style={[styles.navigateNextBtn, { flex: 1, marginVertical: 0 }]}
                      onPress={() => {
                        if (waypoints.length >= 2) {
                          void navigateLeg(waypoints as unknown as RoutePoint[], navLegIndex, true);
                        } else {
                          void openDirections(nextStop);
                        }
                      }}
                    >
                      <Icon name="navigate-outline" size="sm" color={theme.accent} />
                      <Text style={styles.navigateNextBtnText} numberOfLines={1}>
                        Navigate to next stop: {nextStop.name}
                      </Text>
                    </TouchableOpacity>
                    {navLegCount > 1 && (
                      <TouchableOpacity
                        style={[styles.navigateNextBtn, { marginVertical: 0, paddingHorizontal: spacing.md }]}
                        onPress={() => {
                          const nextIdx = (navLegIndex + 1) % navLegCount;
                          setNavLegIndex(nextIdx);
                          void navigateLeg(waypoints as unknown as RoutePoint[], nextIdx, true);
                        }}
                        accessibilityLabel="Next navigation leg"
                      >
                        <Text style={styles.navigateNextBtnText}>
                          Leg {navLegIndex + 1}/{navLegCount} ▸
                        </Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[styles.navigateNextBtn, { marginVertical: 0, paddingHorizontal: spacing.md }]}
                      onPress={() => void toggleNavProvider()}
                      accessibilityLabel="Switch external maps app"
                    >
                      <Text style={styles.navigateNextBtnText}>{formatNavProviderLabel(navProvider)}</Text>
                    </TouchableOpacity>
                  </View>
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
                            {!!day.notes && <Text style={styles.mutedSmall}>{day.notes}</Text>}
                          </View>
                          {isAdmin && (
                            <TouchableOpacity style={styles.addStageBtn} onPress={() => openCreateStage(day.day_number)}>
                              <Icon name="add" size="xs" color={theme.accent} />
                              <Text style={styles.addStageBtnText}>Add stage</Text>
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
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Text style={styles.stageSectionHeader}>PLANNED STOPS ({dayWaypoints.length})</Text>
                              {dayWaypoints.length >= 2 && (
                                <TouchableOpacity
                                  style={styles.linkRow}
                                  onPress={() => void navigateLeg(dayWaypoints as unknown as RoutePoint[])}
                                >
                                  <Icon name="navigate-outline" size="xs" color={theme.accent} />
                                  <Text style={styles.linkText}>Navigate Leg</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                            {dayWaypoints.map(wp => (
                              <View key={wp.id} style={styles.dayStopRow}>
                                <Text style={styles.dayStopText}>
                                  {wp.waypoint_type.toUpperCase()}: {wp.name}
                                  {wp.notes ? ` · ${wp.notes}` : ''}
                                </Text>
                                <TouchableOpacity style={styles.linkRow} onPress={() => void openDirections(wp)}>
                                  <Icon name="navigate-outline" size="xs" color={theme.accent} />
                                  <Text style={styles.linkText}>Navigate</Text>
                                </TouchableOpacity>
                              </View>
                            ))}
                          </View>
                        )}

                        {/* Stays in this day */}
                        {dayStays.length > 0 && (
                          <View style={{ marginTop: 8 }}>
                            {dayStays.map(st => (
                              <View key={st.id} style={styles.inlineRow}>
                                <Icon name="bed-outline" size="xs" color={theme.textMuted} />
                                <Text style={styles.dayStayText}>Overnight: {st.name}</Text>
                              </View>
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
                          <TouchableOpacity style={styles.linkRow} onPress={() => void openDirections(point)}>
                            <Icon name="navigate-outline" size="xs" color={theme.accent} />
                            <Text style={styles.linkText}>Navigate here</Text>
                          </TouchableOpacity>
                        )}
                        {isAdmin && (
                          <View style={styles.editorRow}>
                            <TouchableOpacity
                              style={styles.smallButton}
                              disabled={index === 0}
                              onPress={() => moveWaypoint(index, -1)}
                              accessibilityRole="button"
                              accessibilityLabel={`Move waypoint up: ${point.name}`}
                            >
                              <Icon name="arrow-up" size="sm" color={index === 0 ? theme.subtle : theme.accent} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.smallButton}
                              disabled={index === waypoints.length - 1}
                              onPress={() => moveWaypoint(index, 1)}
                              accessibilityRole="button"
                              accessibilityLabel={`Move waypoint down: ${point.name}`}
                            >
                              <Icon name="arrow-down" size="sm" color={index === waypoints.length - 1 ? theme.subtle : theme.accent} />
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
                      <Text style={styles.primaryText}>Add stops & edit route in workshop</Text>
                      <Icon name="arrow-forward" size="sm" color={theme.onAccent} />
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
              <Text style={styles.sectionTitle}>Stays</Text>
              {stays.length === 0 ? (
                <Text style={styles.muted}>No accommodation added yet.</Text>
              ) : (
                stays.map(stay => (
                  <View key={stay.id} style={styles.stayItem}>
                    <View style={styles.inlineRow}>
                      <Icon name="bed-outline" size="sm" color={theme.textMuted} />
                      <Text style={styles.stayName}>{stay.name}</Text>
                    </View>
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
              <Text style={styles.sectionTitle}>Fuel and touring notes</Text>

              <View style={styles.intelBlock}>
                <Text style={styles.intelTitle}>
                  Motorcycle Fuel Advisory · {profile?.motorcycle_model ? `${profile.motorcycle_make || ''} ${profile.motorcycle_model}` : 'Motorcycle'}
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
                <Text style={styles.intelTitle}>Weather on the route</Text>
                {weatherLoading && weatherPoints.length === 0 ? (
                  <ActivityIndicator size="small" color={theme.accent} style={{ marginVertical: 8 }} />
                ) : weatherPoints.length === 0 ? (
                  <Text style={styles.mutedSmall}>Weather forecast will load when origin and destination coordinates are set.</Text>
                ) : (
                  <View style={{ gap: 8, marginVertical: 6 }}>
                    {weatherPoints.map(wp => (
                      <View key={wp.label} style={styles.weatherCard}>
                        <Icon name={weatherIcon(wp.weatherCode)} size="xl" color={theme.textMuted} />
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
                  <Text style={styles.intelTitle}>Before you ride</Text>
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
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.checklistItem, item.my_completed && styles.checklistItemDone]}
                      onPress={() => void toggleChecklist(item)}
                    >
                      <View style={[styles.checkbox, item.my_completed && styles.checkboxChecked]}>
                        {item.my_completed && <Icon name="checkmark" size="sm" color={theme.onAccent} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.inlineRow}>
                          <Icon name={CHECKLIST_ICONS[item.category] ?? 'construct-outline'} size="sm" color={theme.textMuted} />
                          <Text style={[styles.checklistTitle, item.my_completed && styles.checklistTitleDone]}>{item.title}</Text>
                        </View>
                        {!!item.description && <Text style={styles.mutedSmall}>{item.description}</Text>}
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs }}>
                          <Text style={[styles.mutedSmall, { fontSize: typography.labelCaps.fontSize, color: theme.accent }]}>
                            {item.completed_count} rider{item.completed_count === 1 ? '' : 's'} verified
                            {item.assigned_to_user_id ? ` · Claimed by ${roster.find(r => r.user_id === item.assigned_to_user_id)?.display_name || 'rider'}` : ''}
                          </Text>
                          <TouchableOpacity
                            style={styles.smallButton}
                            onPress={() => {
                              const assignSelf = item.assigned_to_user_id !== user?.id;
                              void supabase.rpc('claim_trip_checklist_item', {
                                p_checklist_id: item.id,
                                p_assign_to_self: assignSelf,
                              }).then(({ error: rpcErr }) => {
                                if (rpcErr) {
                                  Alert.alert('Could not update gear claim', rpcErr.message || 'Please try again.');
                                  return;
                                }
                                setChecklists(prev => prev.map(c => c.id === item.id ? { ...c, assigned_to_user_id: assignSelf ? user?.id ?? null : null } : c));
                              });
                            }}
                          >
                            <Text style={styles.smallButtonText}>
                              {item.assigned_to_user_id === user?.id ? 'Unclaim' : 'Claim'}
                            </Text>
                          </TouchableOpacity>
                        </View>
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
                          {isClosed ? 'CLOSED' : 'OPEN'}
                        </Text>
                      </View>
                      <Text style={styles.mutedSmall}>{point.latitude.toFixed(5)}, {point.longitude.toFixed(5)} · {point.arrived_count}/{roster.length} arrived</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {!isClosed && (
                        <TouchableOpacity style={styles.smallButton} disabled={saving || point.my_arrived} onPress={() => void confirmArrival(point)}>
                          <Text style={styles.smallButtonText}>{point.my_arrived ? 'Arrived' : 'Confirm arrival'}</Text>
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
                <Text style={styles.sectionTitle}>Expenses</Text>
                <TouchableOpacity style={styles.smallButton} onPress={() => {
                  const activeMemberIds = roster.filter(r => r.is_active).map(r => r.user_id);
                  setNewExpenseSplitUsers(activeMemberIds.length > 0 ? activeMemberIds : user?.id ? [user.id] : []);
                  setExpenseModal(true);
                }}>
                  <Text style={styles.smallButtonText}>Add expense</Text>
                </TouchableOpacity>
              </View>

              {expenseError && (
                <View style={styles.expenseErrorBox}>
                  <View style={styles.inlineRow}>
                    <Icon name="warning-outline" size="sm" color={theme.danger} />
                    <Text style={styles.expenseErrorText}>{expenseError}</Text>
                  </View>
                  <TouchableOpacity onPress={() => void load()}>
                    <Text style={styles.expenseRetryText}>Tap to retry</Text>
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
                      <Icon name={EXPENSE_ICONS[exp.category] ?? 'card-outline'} size="lg" color={theme.textMuted} />
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
                          <Icon name="close" size="sm" color={theme.muted} />
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
                <Text style={styles.sectionTitle}>Ride journal</Text>
                <TouchableOpacity style={styles.smallButton} onPress={openJournalEditor}>
                  <Text style={styles.smallButtonText}>{journalEntry ? 'Edit journal' : 'Add entry'}</Text>
                </TouchableOpacity>
              </View>

              {journalEntry ? (
                <View style={{ marginTop: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.pointName}>{journalEntry.title}</Text>
                    <Text style={{ color: theme.warning, fontSize: 13, fontWeight: '800' }}>
                      {'★'.repeat(journalEntry.rating || 5)}{'☆'.repeat(5 - (journalEntry.rating || 5))}
                    </Text>
                  </View>
                  {!!journalEntry.highlights && (
                    <Text style={[styles.mutedSmall, { color: theme.accent, fontWeight: '700', marginTop: 4 }]}>
                      {journalEntry.highlights}
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
                <Text style={styles.secondaryText}>Share ride card</Text>
              </TouchableOpacity>
            </Card>

            {/* Share Group Ride & Ride Code */}
            <Card style={styles.cardSection}>
              <Text style={styles.sectionTitle}>Invite riders</Text>
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
                  <Text style={styles.primaryText}>Share Code</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.mutedSmall, { marginTop: 8 }]}>
                Access Mode: {trip.visibility?.toUpperCase() || 'INVITE_ONLY'} · {trip.visibility === 'public' ? 'Public (Community Touring Feed)' : trip.visibility === 'private' ? 'Private (Invited Members Only)' : 'Invite Only (Requires Ride Code)'}
              </Text>
            </Card>

            {/* Action Bar / Trip Administration */}
            <View style={styles.adminActionsCard}>
              <View style={styles.actions}>
                <TouchableOpacity style={[styles.secondary, { flex: 1, alignItems: 'center' }]} onPress={() => void shareItinerary()}>
                  <Text style={styles.secondaryText}>Share touring itinerary</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.secondary, { flex: 1, alignItems: 'center' }]} onPress={duplicateTrip} disabled={saving}>
                  <Text style={styles.secondaryText}>Duplicate trip</Text>
                </TouchableOpacity>
              </View>

              {isAdmin && (
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.secondary} onPress={openTripEditor}>
                    <Text style={styles.secondaryText}>Trip details</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondary} onPress={() => void toggleArchiveTrip()} disabled={saving}>
                    <Text style={styles.secondaryText}>{trip.status === 'archived' ? 'Unarchive' : 'Archive'}</Text>
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
                'Open emergency options?',
                `Access live emergency SOS and distress beacon controls for "${trip.name}"?`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Open emergency controls', style: 'destructive', onPress: () => router.push('/ride/' + trip.id) },
                ]
              );
            }}
            accessibilityLabel="Open emergency controls"
          >
            <Icon name="warning-outline" size="lg" color={theme.danger} />
            <Text style={styles.tacticalSosLabel}>EMERG</Text>
          </TouchableOpacity>

          {/* Primary Glove-Operable Kinetic Route Launcher (64dp height standard) */}
          <TouchableOpacity
            style={styles.primaryRouteLauncherBtn}
            onPress={() => router.push('/ride/' + trip.id)}
            accessibilityRole="button"
            accessibilityLabel={isTripOngoing ? 'Open live map' : 'Start Tracking'}
          >
            <View style={styles.routeLauncherLeft}>
              <LiveDot pulse={isTripOngoing} size={10} />
              <Text style={styles.primaryRouteLauncherText}>
                {isTripOngoing ? 'Open live map' : 'Start Tracking'}
              </Text>
            </View>
            <Icon name="arrow-forward" size="lg" color={theme.onAccent} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Modals: Stage, Edit Trip, Journal, Role, Expense */}
      <SheetModal visible={stageModalVisible} onRequestClose={() => setStageModalVisible(false)}>
          <ScrollView style={styles.editModal} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionTitle}>Add stage</Text>
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
              <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save stage'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => setStageModalVisible(false)}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
      </SheetModal>

      <SheetModal visible={editTripVisible} onRequestClose={() => setEditTripVisible(false)}>
          <ScrollView style={styles.editModal} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionTitle}>Edit trip details</Text>
            <Text style={styles.mutedSmall}>You can update the plan even after the ride has started. Changes are saved to the shared trip.</Text>
            <Text style={styles.label}>Trip name</Text>
            <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="Trip name" placeholderTextColor={theme.subtle} />
            <Text style={styles.label}>Description</Text>
            <TextInput style={styles.input} value={editDescription} onChangeText={setEditDescription} placeholder="Description (optional)" placeholderTextColor={theme.subtle} multiline />

            <Text style={styles.label}>Who can join</Text>
            <View style={{ flexDirection: 'row', gap: 6, marginVertical: 6 }}>
              {[
                { key: 'private', label: 'Private' },
                { key: 'invite_only', label: 'Invite Only' },
                { key: 'public', label: 'Public Community' },
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

            <Text style={styles.label}>Maximum riders</Text>
            <TextInput
              style={styles.input}
              value={editMaxParticipants}
              onChangeText={setEditMaxParticipants}
              keyboardType="number-pad"
              placeholder="e.g. 15 (leave blank for unlimited)"
              placeholderTextColor={theme.subtle}
            />

            <Text style={styles.label}>Group ride rules</Text>
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
      </SheetModal>

      <SheetModal visible={journalModalVisible} onRequestClose={() => setJournalModalVisible(false)}>
          <ScrollView style={styles.editModal} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionTitle}>Journal and photos</Text>
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
              <Text style={styles.secondaryText}>Attach photo ({journalPhotos.length} attached)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.primaryWide} disabled={saving} onPress={() => void saveJournal()}>
              <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save journal entry'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.secondary, { marginTop: 8, alignItems: 'center' }]} onPress={() => setJournalModalVisible(false)}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
      </SheetModal>

      {/* Role Management Modal */}
      <SheetModal visible={riderRoleModalVisible} onRequestClose={() => setRiderRoleModalVisible(false)}>
          <View style={styles.editModal}>
            <Text style={styles.sectionTitle}>Rider role</Text>
            {selectedRider && (
              <>
                <Text style={styles.pointName}>{selectedRider.display_name}</Text>
                <Text style={[styles.mutedSmall, { marginBottom: 14 }]}>
                  Current Role: {ROLE_LABELS[selectedRider.role]?.title || selectedRider.role}
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
                      <Icon name={ROLE_ICONS[r]} size="md" color={selectedRider.role === r ? theme.accent : theme.textMuted} />
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

                <Text style={[styles.label, { marginTop: 10 }]}>Update attendance</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginVertical: 6 }}>
                  {(['confirmed', 'tentative', 'declined', 'attended'] as const).map(att => {
                    const isSel = (selectedRider.attendance_status || 'confirmed') === att;
                    const meta = ATTENDANCE_STATUS_LABELS[att];
                    return (
                      <TouchableOpacity
                        key={att}
                        disabled={updatingAttendance}
                        style={[styles.smallButton, styles.inlineRow, isSel && styles.roleSelected, updatingAttendance && { opacity: 0.5 }]}
                        onPress={async () => {
                          const ok = await handleUpdateAttendance(att, selectedRider.user_id);
                          if (ok) {
                            setSelectedRider(prev => prev ? { ...prev, attendance_status: att } : null);
                          }
                        }}
                      >
                        <Icon name={ATTENDANCE_ICONS[att]} size="xs" color={isSel ? theme.accent : theme.textMuted} />
                        <Text style={[styles.smallButtonText, isSel && { fontWeight: '800' }]}>{meta.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  style={[styles.secondary, { marginTop: 12, alignItems: 'center' }]}
                  disabled={saving}
                  onPress={() => void transferLeadership(selectedRider)}
                >
                  <Text style={[styles.secondaryText, { color: theme.accent, fontWeight: '800' }]}>Make captain</Text>
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
      </SheetModal>

      {/* Add Expense Modal */}
      <SheetModal visible={expenseModal} onRequestClose={() => setExpenseModal(false)}>
          <ScrollView style={styles.editModal} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionTitle}>Add expense</Text>
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
                  <Icon name={EXPENSE_ICONS[cat]} size="xs" color={newExpenseCategory === cat ? theme.accent : theme.textMuted} />
                  <Text style={[styles.categoryPillText, newExpenseCategory === cat && styles.categoryPillTextActive]}>{EXPENSE_CATEGORY_META[cat].label}</Text>
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
                    <Icon name={isSelected ? 'checkbox' : 'square-outline'} size="md" color={isSelected ? theme.accent : theme.muted} />
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
      </SheetModal>

      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}
