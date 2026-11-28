import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  Image,
  Platform,
  ScrollView,
  StatusBar,
  Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/hooks/useAuth';
import { BikeModelPicker } from '../../src/components/profile/BikeModelPicker';
import { useRideTheme, useRideThemeSettings, RidePalette, radius, spacing } from '../../src/theme';
import { useSwipeTab } from '../../src/hooks/useSwipeTab';
import { useFlag } from '../../src/hooks/useFeatureFlags';
import { openMedicalIdSetup, useLockScreenCardSetting } from '../../src/services/lockScreenCard';
import { supabase } from '../../src/lib/supabase';
import { type UserSavedPlace, type SavedPlaceCategory, SAVED_PLACE_CATEGORIES, type RiderAnalytics } from '@ridentrack/shared';
import { Icon, SheetModal } from '../../src/components/ui';
import { SAVED_PLACE_ICONS } from '../../src/icons';
import { LanguagePicker } from '../../src/components/profile/LanguagePicker';
import { InviteCard } from '../../src/components/InviteCard';
import { HeadsetCard } from '../../src/components/profile/HeadsetCard';
import { PhoneSignInCard } from '../../src/components/profile/PhoneSignInCard';

export default function ProfileScreen() {
  const { user, profile, profileError, reloadProfile, signOut, deleteAccount, updateProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const theme = useRideTheme();
  const { mode, setMode } = useRideThemeSettings();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState<'rider' | 'emergency' | 'bike'>('rider');
  const [original, setOriginal] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [emergencyContact, setEmergencyContact] = useState(profile?.emergency_contact || '');
  const [bloodGroup, setBloodGroup] = useState(profile?.blood_group || '');
  const [shareIceWithRide, setShareIceWithRide] = useState(Boolean(profile?.share_ice_with_ride));
  const [sharePhoneWithRide, setSharePhoneWithRide] = useState(Boolean(profile?.share_phone_with_ride));
  const phoneSharingFlag = useFlag('rider_phone_numbers');
  const sensorRecorderFlag = useFlag('sensor_recorder');
  const lockScreenFlag = useFlag('lock_screen_card');
  const languagesFlag = useFlag('languages');
  const headsetFlag = useFlag('headset_autostart');
  const [lockCardOn, setLockCardOn] = useLockScreenCardSetting();
  const [researchBusy, setResearchBusy] = useState(false);
  const researchConsent = Boolean(profile?.crash_research_consent_at);
  const setResearchConsent = useCallback(async (on: boolean) => {
    setResearchBusy(true);
    const { error } = await supabase.rpc('set_crash_research_consent', { p_on: on });
    setResearchBusy(false);
    if (error) { Alert.alert('Could not save', error.message); return; }
    await reloadProfile();
  }, [reloadProfile]);
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');
  const [make, setMake] = useState(profile?.motorcycle_make || '');
  const [model, setModel] = useState(profile?.motorcycle_model || '');
  const [modelId, setModelId] = useState<string | null>(profile?.motorcycle_model_id ?? null);
  const [category, setCategory] = useState<NonNullable<NonNullable<typeof profile>['motorcycle_category']> | ''>(profile?.motorcycle_category ?? '');
  const [tankCapacity, setTankCapacity] = useState(profile?.fuel_tank_capacity_liters ? String(profile.fuel_tank_capacity_liters) : '');
  const [mileage, setMileage] = useState(profile?.mileage_km_per_liter ? String(profile.mileage_km_per_liter) : '');
  const [reserve, setReserve] = useState(profile?.fuel_reserve_liters != null ? String(profile.fuel_reserve_liters) : '3');

  // Real Rider Analytics
  const [analytics, setAnalytics] = useState<RiderAnalytics | null>(null);

  // Saved Places & Destination Lists
  const [savedPlaces, setSavedPlaces] = useState<UserSavedPlace[]>([]);
  const [placeModalVisible, setPlaceModalVisible] = useState(false);
  const [placeName, setPlaceName] = useState('');
  const [placeCategory, setPlaceCategory] = useState<SavedPlaceCategory>('viewpoint');
  const [placeAddress, setPlaceAddress] = useState('');
  const [placeLat, setPlaceLat] = useState('');
  const [placeLng, setPlaceLng] = useState('');
  const [placeNotes, setPlaceNotes] = useState('');
  const [savingPlace, setSavingPlace] = useState(false);
  const [placesUnavailable, setPlacesUnavailable] = useState(false);
  const [analyticsUnavailable, setAnalyticsUnavailable] = useState(false);
  const [placesLoaded, setPlacesLoaded] = useState(false);

  const loadSavedPlaces = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_user_saved_places');
      if (error) throw error;
      setSavedPlaces(data || []);
      setPlacesUnavailable(false);
      setPlacesLoaded(true);
    } catch {
      setPlacesUnavailable(true);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_rider_analytics');
      if (error) throw error;
      if (data) setAnalytics(data as RiderAnalytics);
      setAnalyticsUnavailable(false);
    } catch {
      setAnalyticsUnavailable(true);
    }
  }, []);

  useEffect(() => {
    void loadSavedPlaces();
    void loadAnalytics();
  }, [loadSavedPlaces, loadAnalytics]);

  async function handleAddSavedPlace() {
    if (!placeName.trim()) {
      Alert.alert('Name required', 'Please enter a name for this place.');
      return;
    }
    const lat = Number(placeLat);
    const lng = Number(placeLng);
    if (!placeLat.trim() || !placeLng.trim() || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      Alert.alert('Invalid coordinates', 'Enter valid latitude (-90 to 90) and longitude (-180 to 180).');
      return;
    }

    setSavingPlace(true);
    try {
      const { error } = await supabase.rpc('add_saved_place', {
        p_name: placeName.trim(),
        p_category: placeCategory,
        p_latitude: lat,
        p_longitude: lng,
        p_address: placeAddress.trim() || null,
        p_notes: placeNotes.trim() || null,
      });
      if (error) throw error;

      setPlaceName('');
      setPlaceAddress('');
      setPlaceLat('');
      setPlaceLng('');
      setPlaceNotes('');
      setPlaceModalVisible(false);
      await loadSavedPlaces();
      Alert.alert('Place saved', 'This destination has been added to your touring bookmarks.');
    } catch (e: any) {
      Alert.alert('Could not save place', e?.message || 'Please try again.');
    } finally {
      setSavingPlace(false);
    }
  }

  async function handleDeleteSavedPlace(placeId: string, name: string) {
    Alert.alert(
      'Remove saved place?',
      `Delete "${name}" from your saved destinations?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.rpc('delete_saved_place', { p_place_id: placeId });
              if (error) throw error;
              setSavedPlaces(prev => prev.filter(p => p.id !== placeId));
            } catch (e: any) {
              Alert.alert('Could not delete place', e?.message || 'Please try again.');
            }
          },
        },
      ]
    );
  }

  function openEditor(target: typeof section) {
    if (!profile || profile.id !== user?.id) return;
    setOriginal(profile);
    setSection(target);
    setDisplayName(profile?.display_name || '');
    setPhone(profile?.phone || '');
    setEmergencyContact(profile?.emergency_contact || '');
    setBloodGroup(profile?.blood_group || '');
    setShareIceWithRide(Boolean(profile.share_ice_with_ride));
    setSharePhoneWithRide(Boolean(profile.share_phone_with_ride));
    setAvatarUrl(profile?.avatar_url || '');
    setMake(profile?.motorcycle_make || '');
    setModel(profile?.motorcycle_model || '');
    setModelId(profile?.motorcycle_model_id ?? null);
    setCategory(profile.motorcycle_category ?? '');
    setTankCapacity(profile?.fuel_tank_capacity_liters ? String(profile.fuel_tank_capacity_liters) : '');
    setMileage(profile?.mileage_km_per_liter ? String(profile.mileage_km_per_liter) : '');
    setReserve(profile.fuel_reserve_liters != null ? String(profile.fuel_reserve_liters) : '');
    setEditing(true);
  }

  async function saveProfile() {
    if (!original || original.id !== user?.id || saving) return;
    if (section === 'rider' && !displayName.trim()) {
      Alert.alert('Name required', 'Please enter your display name.');
      return;
    }
    if (section === 'rider' && phone.trim() && !/^\+?[0-9 ()-]{7,20}$/.test(phone.trim())) {
      Alert.alert('Check phone number', 'Enter a valid phone number, including country code if needed.');
      return;
    }
    if (section === 'emergency' && emergencyContact.trim() && !/^\+?[0-9 ()-]{7,25}$/.test(emergencyContact.trim())) {
      Alert.alert('Check emergency contact', 'Enter a valid emergency contact number, including country code.');
      return;
    }
    if (section === 'emergency' && bloodGroup.trim() && !/^(A|B|AB|O)[+-]$/i.test(bloodGroup.trim())) {
      Alert.alert('Check blood group', 'Use A, B, AB or O followed by + or -, or leave this blank.');
      return;
    }
    if (section === 'rider' && avatarUrl.trim() && !/^https?:\/\//i.test(avatarUrl.trim())) {
      Alert.alert('Invalid photo URL', 'Use a public HTTPS or HTTP image URL.');
      return;
    }
    const tankNum = tankCapacity.trim() ? Number(tankCapacity) : null;
    if (section === 'bike' && tankNum != null && (!Number.isFinite(tankNum) || tankNum <= 0 || tankNum > 100)) {
      Alert.alert('Invalid fuel tank capacity', 'Enter a valid capacity between 1 and 100 liters.');
      return;
    }
    const mileageNum = mileage.trim() ? Number(mileage) : null;
    if (section === 'bike' && mileageNum != null && (!Number.isFinite(mileageNum) || mileageNum <= 0 || mileageNum > 150)) {
      Alert.alert('Invalid mileage', 'Enter a valid mileage between 1 and 150 km/l.');
      return;
    }
    const reserveNum = reserve.trim() ? Number(reserve) : null;
    if (section === 'bike' && reserveNum != null && (!Number.isFinite(reserveNum) || reserveNum < 0 || reserveNum > 30 || (tankNum !== null && reserveNum >= tankNum))) {
      Alert.alert('Invalid reserve', 'Reserve must be between 0 and 30 liters and less than tank capacity.');
      return;
    }
    setSaving(true);
    try {
      const values: Parameters<typeof updateProfile>[0] = section === 'rider' ? {
        display_name: displayName.trim(),
        phone: phone.trim() || null,
        avatar_url: avatarUrl.trim() || null,
      } : section === 'emergency' ? {
        emergency_contact: emergencyContact.trim() || null,
        blood_group: bloodGroup.trim().toUpperCase() || null,
        share_ice_with_ride: shareIceWithRide,
        ...(phoneSharingFlag ? { share_phone_with_ride: sharePhoneWithRide } : {}),
      } : {
        motorcycle_make: make.trim() || null,
        motorcycle_model: model.trim() || null,
        motorcycle_model_id: modelId,
        motorcycle_category: category || null,
        fuel_tank_capacity_liters: tankNum,
        mileage_km_per_liter: mileageNum,
        fuel_reserve_liters: reserveNum,
      };
      const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) =>
        value !== (original[key as keyof typeof values] ?? null)));
      if (Object.keys(changed).length) await updateProfile(changed);
      setEditing(false);
      if (Object.keys(changed).length) Alert.alert('Changes saved', 'Your profile is up to date.');
    } catch (error) {
      Alert.alert('Could not update profile', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const dark = mode === 'dark' || (mode === 'system' && theme.scheme === 'dark');
  const hasMotorcycle = Boolean(profile?.motorcycle_make?.trim() || profile?.motorcycle_model?.trim());

  const safeRangeKm =
    profile?.fuel_tank_capacity_liters && profile?.mileage_km_per_liter
      && (profile.fuel_reserve_liters ?? 0) < profile.fuel_tank_capacity_liters
      ? Math.round((profile.fuel_tank_capacity_liters - (profile.fuel_reserve_liters ?? 0)) * profile.mileage_km_per_liter)
      : null;
  const totalRangeKm =
    profile?.fuel_tank_capacity_liters && profile?.mileage_km_per_liter
      ? Math.round(profile.fuel_tank_capacity_liters * profile.mileage_km_per_liter)
      : null;

  const topInset = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0);
  const safeHeaderTop = Math.max(topInset, Platform.OS === 'android' ? 48 : 44) + 18;
  const swipeHandlers = useSwipeTab('profile');

  return (
    <View style={styles.screen} {...swipeHandlers}>
      {/* Top Header Bar matching profile_garage.html */}
      <View style={[styles.topHeader, { paddingTop: safeHeaderTop }]}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerTitleText}>GARAGE & FLEET</Text>
        </View>

        <View style={styles.headerRightActions}>
          <TouchableOpacity
            style={styles.headerActionBtn}
            disabled={!profile}
            onPress={() => openEditor('rider')}
            accessibilityRole="button"
            accessibilityLabel="Edit Profile & Garage"
          >
            <Icon name="settings-outline" size="md" color={theme.text} />
          </TouchableOpacity>
          {profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.headerAvatarImg} />
          ) : (
            <View style={styles.headerAvatarPlaceholder}>
              <Text style={styles.headerAvatarText}>
                {profile?.display_name ? profile.display_name.charAt(0).toUpperCase() : 'R'}
              </Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 80, 100) }]}
      >
        {!profile && <View style={styles.card}>
          <Text style={styles.hint}>{profileError ? 'Could not load your profile. Your saved details have not been changed.' : 'Loading your rider profile…'}</Text>
          {profileError && <TouchableOpacity accessibilityRole="button" onPress={() => void reloadProfile()}><Text style={styles.addPlaceBtnText}>Retry profile</Text></TouchableOpacity>}
        </View>}
        <View style={styles.riderCard}>
          <View style={styles.riderTopRow}>
            <View style={styles.riderAvatarBox}>
              {profile?.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.riderAvatarImage} />
              ) : (
                <View style={styles.riderAvatarInitial}>
                  <Text style={styles.riderAvatarInitialText}>
                    {profile?.display_name ? profile.display_name.charAt(0).toUpperCase() : 'R'}
                  </Text>
                </View>
              )}
              <View style={styles.verifiedCheckBadge}>
                <Icon name="checkmark" size="xs" color={theme.onAccent} />
              </View>
            </View>

            <View style={styles.riderMetaCol}>
              <View style={styles.riderNameRow}>
                <Text style={styles.riderName} numberOfLines={1}>
                  {profile?.display_name || user?.email?.split('@')[0] || 'Rider'}
                </Text>
                <View style={styles.ghostPill}>
                  <Text style={styles.ghostPillText}>
                    #{profile?.username ? profile.username.toUpperCase() : (user?.email ? user.email.split('@')[0].toUpperCase() : 'RIDER')}
                  </Text>
                </View>
              </View>
              <View style={styles.careerRow}>
                <Icon name="ribbon-outline" size="sm" color={theme.tertiary} />
                <Text style={styles.careerSubtitle}>
                  {analytics?.milestones && analytics.milestones.length > 0
                    ? analytics.milestones[analytics.milestones.length - 1].title
                    : (analytics?.completed_trips && analytics.completed_trips > 0
                      ? `Touring Rider • ${analytics.completed_trips} ${analytics.completed_trips === 1 ? 'Tour' : 'Tours'} Done`
                      : 'Rider • Ready to Tour')}
                </Text>
              </View>
            </View>
          </View>

          {/* Telemetry Stats Split (Distance, Apex Alt, Expeditions) */}
          <View style={styles.telemetrySplitRow}>
            <View style={styles.telemetrySplitCell}>
              <Text style={styles.telemetryCellLabel}>DISTANCE</Text>
              <Text style={styles.telemetryCellNum}>
                {analytics?.total_distance_km != null ? analytics.total_distance_km.toLocaleString('en-IN') : '—'}
              </Text>
              <Text style={[styles.telemetryCellSub, { color: theme.accent }]}>EST. KM · COMPLETED</Text>
            </View>
            <View style={styles.telemetrySplitCell}>
              <Text style={styles.telemetryCellLabel}>APEX ALT</Text>
              <Text style={styles.telemetryCellNum}>—</Text>
              <Text style={[styles.telemetryCellSub, { color: theme.green }]}>M (Pending GPS)</Text>
            </View>
            <View style={styles.telemetrySplitCell}>
              <Text style={styles.telemetryCellLabel}>EXPEDITIONS</Text>
              <Text style={styles.telemetryCellNum}>
                {analytics?.completed_trips != null ? String(analytics.completed_trips) : '—'}
              </Text>
              <Text style={[styles.telemetryCellSub, { color: theme.tertiary }]}>COMPLETED</Text>
            </View>
          </View>

          {analyticsUnavailable && <TouchableOpacity accessibilityRole="button" onPress={() => void loadAnalytics()}><Text style={styles.hint}>Statistics could not refresh. Tap to retry.</Text></TouchableOpacity>}
          <TouchableOpacity disabled={!profile} accessibilityRole="button" accessibilityLabel="Edit emergency details" onPress={() => openEditor('emergency')} style={styles.iceCard}>
            <View style={styles.iceLeft}>
              <Icon name="medkit-outline" size="sm" color={theme.danger} />
              <Text style={styles.iceBloodType}>
                {profile?.blood_group ? profile.blood_group.toUpperCase() : 'Not recorded'}
              </Text>
            </View>
            <View style={styles.iceRight}>
              <Text style={styles.iceLabel}>{profile?.share_ice_with_ride ? 'ICE: shared with active ride - Edit' : 'ICE: private - Edit emergency details'}</Text>
              <Text style={styles.icePhone}>
                {profile?.emergency_contact || 'Not recorded'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Motorcycle Fleet Section Header */}
        <View style={styles.fleetHeaderRow}>
          <View style={styles.fleetTitleRow}>
            <Icon name="speedometer-outline" size="md" color={theme.textMuted} />
            <Text style={styles.fleetTitleText}>Motorcycle profile & machine</Text>
          </View>
          {hasMotorcycle && (
            <TouchableOpacity
              style={styles.addBikeBtn}
              disabled={!profile}
              onPress={() => openEditor('bike')}
              accessibilityRole="button"
              accessibilityLabel="Edit motorcycle"
            >
              <Text style={styles.addBikeBtnText}>Edit Bike</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Primary Steed Card or Empty State */}
        {hasMotorcycle ? (
          <View style={styles.steedCard}>
            <View style={styles.steedCoverBox}>
              <View style={styles.steedCoverBackdrop} />
              <View style={styles.primarySteedBadge}>
                <Text style={styles.primarySteedText}>Primary Steed</Text>
              </View>
              <View style={styles.steedHeroMeta}>
                <Text style={styles.steedModelTitle}>
                  {`${profile?.motorcycle_make || ''} ${profile?.motorcycle_model || ''}`.trim()}
                </Text>
                <Text style={styles.steedCategoryText}>
                  {(profile?.motorcycle_category || 'Motorcycle').toUpperCase()}
                </Text>
              </View>
            </View>

            {/* Steed Metrics */}
            <View style={styles.steedMetricsRow}>
              <View style={styles.steedMetricCol}>
                <Text style={styles.steedMetricLabel}>TANK CAPACITY</Text>
                <Text style={styles.steedMetricValue}>
                  {profile?.fuel_tank_capacity_liters ? `${profile.fuel_tank_capacity_liters} L` : '—'}
                </Text>
                <Text style={styles.steedMetricSub}>
                  {profile?.fuel_reserve_liters != null ? `${profile.fuel_reserve_liters} L Reserve` : '—'}
                </Text>
              </View>

              <View style={styles.steedMetricDivider} />

              <View style={styles.steedMetricCol}>
                <Text style={styles.steedMetricLabel}>EST. MILEAGE</Text>
                <Text style={styles.steedMetricValue}>
                  {profile?.mileage_km_per_liter ? `${profile.mileage_km_per_liter} km/l` : '—'}
                </Text>
                <Text style={styles.steedMetricSub}>Highway Cruise</Text>
              </View>

              <View style={styles.steedMetricDivider} />

              <View style={styles.steedMetricCol}>
                <Text style={styles.steedMetricLabel}>Estimated fuel range (advisory)</Text>
                <Text style={[styles.steedMetricValue, { color: theme.green }]}>
                  {safeRangeKm != null ? `~${safeRangeKm} KM` : 'Unavailable'}
                </Text>
                <Text style={styles.steedMetricSub}>Safe Range</Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.steedEmptyCard}>
            <View style={styles.steedEmptyIconBox}>
              <Icon name="speedometer-outline" size="xl" color={theme.textMuted} />
            </View>
            <Text style={styles.steedEmptyTitle}>No motorcycle added yet</Text>
            <Text style={styles.steedEmptySub}>
              Add your motorcycle specifications to get accurate safe fuel range calculations and tank stop advisories.
            </Text>
            <TouchableOpacity
              style={styles.primaryAddBikeBtn}
              disabled={!profile}
              onPress={() => openEditor('bike')}
              accessibilityRole="button"
              accessibilityLabel="+ Add Motorcycle"
            >
              <Text style={styles.primaryAddBikeBtnText}>+ Add Motorcycle</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Saved Places & Destinations Section */}
        <View style={styles.card}>
          <View style={styles.savedPlacesHeader}>
            <Text style={styles.sectionTitle}>Saved Places & Destinations ({savedPlaces.length})</Text>
            <TouchableOpacity
              style={styles.addPlaceBtn}
              onPress={() => setPlaceModalVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Add saved place"
            >
              <Text style={styles.addPlaceBtnText}>+ Add Place</Text>
            </TouchableOpacity>
          </View>
          {placesUnavailable && <TouchableOpacity accessibilityRole="button" onPress={() => void loadSavedPlaces()}><Text style={styles.hint}>Saved places could not refresh. Tap to retry.</Text></TouchableOpacity>}
          {!placesUnavailable && !placesLoaded && <Text style={styles.hint}>Loading saved places…</Text>}
          {savedPlaces.length === 0 ? placesLoaded && !placesUnavailable && (
            <Text style={styles.hint}>
              No saved destinations yet. Bookmark mountain passes, viewpoints, trusted fuel bunks, or dhabas for your tours.
            </Text>
          ) : (
            savedPlaces.map(place => {
              const catMeta = SAVED_PLACE_CATEGORIES[place.category] || { label: place.category };
              return (
                <View key={place.id} style={styles.savedPlaceRow}>
                  <View style={styles.savedPlaceInfo}>
                    <View style={styles.savedPlaceTitleRow}>
                      <Icon name={SAVED_PLACE_ICONS[place.category] ?? 'location-outline'} size="sm" color={theme.textMuted} />
                      <Text style={styles.savedPlaceName}>{place.name}</Text>
                    </View>
                    <Text style={styles.savedPlaceMeta}>
                      {catMeta.label} · {place.latitude.toFixed(4)}, {place.longitude.toFixed(4)}
                    </Text>
                    {!!place.address && <Text style={styles.savedPlaceSub}>{place.address}</Text>}
                    {!!place.notes && <Text style={styles.savedPlaceNotes}>{place.notes}</Text>}
                  </View>
                  <TouchableOpacity
                    style={styles.deletePlaceBtn}
                    onPress={() => void handleDeleteSavedPlace(place.id, place.name)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${place.name}`}
                  >
                    <Icon name="close" size="md" color={theme.danger} />
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>

        {/* System & Sync Navigation List */}
        <View style={styles.systemSection}>
          <Text style={styles.systemSectionTitle}>SYSTEM & SYNC</Text>
          <View style={styles.systemCard}>
            <View style={styles.systemItem}>
              <View style={styles.systemItemIconBox}>
                <Icon name="download-outline" size="md" color={theme.text} />
              </View>
              <View style={styles.systemItemTextCol}>
                <Text style={styles.systemItemTitle}>Offline topo maps</Text>
                <Text style={styles.systemItemSub}>Offline map availability is not verified here.</Text>
              </View>
            </View>

            <View style={styles.systemItemDivider} />

            <View style={styles.systemItem}>
              <View style={[styles.systemItemIconBox, { backgroundColor: theme.dangerSoft }]}>
                <Icon name="warning-outline" size="md" color={theme.danger} />
              </View>
              <View style={styles.systemItemTextCol}>
                <Text style={styles.systemItemTitle}>Emergency SOS Protocols</Text>
                <Text style={styles.systemItemSub}>Manual SOS & Emergency Contacts</Text>
              </View>
            </View>

            <View style={styles.systemItemDivider} />

            <View style={styles.systemItem}>
              <View style={styles.systemItemIconBox}>
                <Icon name="speedometer-outline" size="md" color={theme.text} />
              </View>
              <View style={styles.systemItemTextCol}>
                <Text style={styles.systemItemTitle}>Units</Text>
                <Text style={styles.systemItemSub}>Metric (km/h, km, L)</Text>
              </View>
            </View>

            <View style={styles.systemItemDivider} />

            <View style={styles.systemItem}>
              <View style={styles.systemItemIconBox}>
                <Icon name="cloud-download-outline" size="md" color={theme.text} />
              </View>
              <View style={styles.systemItemTextCol}>
                <Text style={styles.systemItemTitle}>Cloud GPX & Telemetry Export</Text>
                <Text style={styles.systemItemSub}>Open a trip to view its export options.</Text>
              </View>
            </View>

            <View style={styles.systemItemDivider} />

            {/* Appearance Theme Toggle */}
            <View style={styles.systemItem}>
              <View style={styles.systemItemIconBox}>
                <Icon name="contrast-outline" size="md" color={theme.text} />
              </View>
              <View style={styles.systemItemTextCol}>
                <Text style={styles.systemItemTitle}>Dark Theme</Text>
                <Text style={styles.systemItemSub}>
                  {mode === 'system' ? 'Following device setting' : dark ? 'Dark theme enabled' : 'Light theme enabled'}
                </Text>
              </View>
              <Switch
                value={dark}
                onValueChange={value => setMode(value ? 'dark' : 'light')}
                trackColor={{ false: theme.border, true: theme.accent }}
                thumbColor={theme.onAccent}
              />
            </View>
          </View>
        </View>

        <PhoneSignInCard />
        <InviteCard source="profile" />
        {languagesFlag && <LanguagePicker />}
        {headsetFlag && <HeadsetCard />}

        {/* Sign Out & Delete Account Actions */}
        <View style={styles.accountActionsContainer}>
          <TouchableOpacity
            style={styles.signOutBtn}
            onPress={() => void signOut().catch(e => Alert.alert('Sign out failed', e.message))}
            accessibilityRole="button"
            accessibilityLabel="Sign out of account"
          >
            <Icon name="log-out-outline" size="md" color={theme.text} />
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.deleteAccountButton}
            accessibilityRole="button"
            accessibilityLabel="Delete Account"
            onPress={() => {
              Alert.alert(
                'Delete Account?',
                'This permanently deletes your rider profile, motorcycle specs, created rides, and personal logs. This action cannot be undone.',
                [
                  { text: 'Keep Account', style: 'cancel' },
                  {
                    text: 'Delete Forever',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await deleteAccount();
                      } catch (e: any) {
                        Alert.alert('Account deletion failed', e?.message || 'Please try again.');
                      }
                    },
                  },
                ]
              );
            }}
          >
            <Text style={styles.deleteAccountText}>Delete Account</Text>
          </TouchableOpacity>

          <View style={styles.versionFooterBox}>
            <Text style={styles.versionFooterText}>Apex Horizon v2.4.0 (Build 892)</Text>
            <Text style={styles.versionSubText}>Made for riders, by riders</Text>
          </View>
        </View>
      </ScrollView>

      {/* Profile & Motorcycle Editor Modal */}
      <SheetModal visible={editing} onRequestClose={() => !saving && setEditing(false)}>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: '90%' }} contentContainerStyle={styles.modal}>
            <Text style={styles.modalTitle}>{section === 'rider' ? 'Edit rider profile' : section === 'emergency' ? 'Edit emergency details' : 'Edit motorcycle'}</Text>
            {section === 'rider' && <>
            <Text style={styles.fieldLabel}>Display name</Text>
            <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={theme.subtle} />
            <Text style={styles.fieldLabel}>Phone number</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91..." placeholderTextColor={theme.subtle} />
            {phoneSharingFlag && (
              <View style={styles.iceConsentRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Riders on my ride can text me in an SOS</Text>
                  <Text style={styles.hint}>Your number goes only to people on the same live ride, and only when someone presses SOS. Off by default.</Text>
                </View>
                <Switch
                  value={sharePhoneWithRide}
                  onValueChange={setSharePhoneWithRide}
                  disabled={!phone.trim()}
                  accessibilityLabel="Share my phone number with riders on my ride for SOS texts"
                  trackColor={{ false: theme.border, true: theme.green }}
                  thumbColor={theme.onAccent}
                />
              </View>
            )}
            <Text style={styles.fieldLabel}>Profile photo URL</Text>
            <TextInput style={styles.input} value={avatarUrl} onChangeText={setAvatarUrl} autoCapitalize="none" keyboardType="url" placeholder="https://..." placeholderTextColor={theme.subtle} />
            </>}
            {section === 'emergency' && <>
            <Text style={styles.fieldLabel}>Emergency contact</Text>
            <TextInput style={styles.input} value={emergencyContact} onChangeText={setEmergencyContact} keyboardType="phone-pad" placeholder="Emergency contact phone (+91...)" placeholderTextColor={theme.subtle} />
            <Text style={styles.fieldLabel}>Blood group (ICE medical)</Text>
            <TextInput style={styles.input} value={bloodGroup} onChangeText={setBloodGroup} autoCapitalize="characters" placeholder="e.g. O+, A+, B-, AB+" placeholderTextColor={theme.subtle} />
            <View style={styles.iceConsentRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Share with active ride members</Text>
                <Text style={styles.hint}>Only active members can view this. Turning it off removes consent immediately.</Text>
              </View>
              <Switch value={shareIceWithRide} onValueChange={setShareIceWithRide} trackColor={{ false: theme.border, true: theme.green }} thumbColor={theme.onAccent} />
            </View>
            {lockScreenFlag && (
              <View style={styles.iceConsentRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Show on my lock screen while riding</Text>
                  <Text style={styles.hint}>
                    Anyone holding this phone can read your blood group, emergency contact and the ride captain's number, without unlocking it. Only while you share your location on a ride.
                  </Text>
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity onPress={openMedicalIdSetup} accessibilityRole="link">
                      <Text style={[styles.hint, { color: theme.accent, fontWeight: '700' }]}>Also set up Medical ID in the Health app</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Switch
                  value={lockCardOn}
                  onValueChange={on => void setLockCardOn(on)}
                  accessibilityLabel="Show emergency details on the lock screen while riding"
                  trackColor={{ false: theme.border, true: theme.green }}
                  thumbColor={theme.onAccent}
                />
              </View>
            )}
            {sensorRecorderFlag && (
              <View style={styles.iceConsentRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Help tune crash detection</Text>
                  <Text style={styles.hint}>
                    Saves a few seconds of motion data around hard braking and bumps while you ride, never your messages or photos. Turning it off deletes what was saved.
                  </Text>
                </View>
                <Switch
                  value={researchConsent}
                  disabled={researchBusy}
                  onValueChange={on => void setResearchConsent(on)}
                  accessibilityLabel="Share motion data to help tune crash detection"
                  trackColor={{ false: theme.border, true: theme.green }}
                  thumbColor={theme.onAccent}
                />
              </View>
            )}
            </>}
            {section === 'bike' && <>
            <Text style={[styles.fieldLabel, { marginTop: 18, color: theme.accent }]}>MOTORCYCLE PROFILE</Text>
            <BikeModelPicker
              selectedId={modelId}
              onPick={bike => {
                setModelId(bike.id);
                setMake(bike.make);
                setModel(bike.model);
                setCategory(bike.category);
                setTankCapacity(String(bike.tankLiters));
                setMileage(String(bike.mileageKmpl));
                setReserve(String(bike.reserveLiters));
              }}
            />
            <Text style={styles.fieldLabel}>Make / Manufacturer</Text>
            <TextInput style={styles.input} value={make} onChangeText={v => { setMake(v); setModelId(null); }} placeholder="e.g. Royal Enfield, KTM, Triumph, BMW" placeholderTextColor={theme.subtle} />
            <Text style={styles.fieldLabel}>Model</Text>
            <TextInput style={styles.input} value={model} onChangeText={v => { setModel(v); setModelId(null); }} placeholder="e.g. Himalayan 450, 390 Adventure" placeholderTextColor={theme.subtle} />
            <Text style={styles.fieldLabel}>Motorcycle category</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 }}>
              {(['adventure', 'tourer', 'cruiser', 'sport', 'commuter', 'scooter'] as const).map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.catPill, category === cat && { backgroundColor: theme.accent, borderColor: theme.accent }]}
                  onPress={() => setCategory(cat)}
                >
                  <Text style={[styles.catPillText, category === cat && { color: theme.onAccent }]}>{cat.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Tank capacity (L)</Text>
                <TextInput style={styles.input} value={tankCapacity} onChangeText={setTankCapacity} keyboardType="decimal-pad" placeholder="e.g. 17" placeholderTextColor={theme.subtle} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Approx mileage (km/l)</Text>
                <TextInput style={styles.input} value={mileage} onChangeText={setMileage} keyboardType="decimal-pad" placeholder="e.g. 30" placeholderTextColor={theme.subtle} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Reserve (L)</Text>
                <TextInput style={styles.input} value={reserve} onChangeText={setReserve} keyboardType="decimal-pad" placeholder="e.g. 3" placeholderTextColor={theme.subtle} />
              </View>
            </View>
            <Text style={styles.hint}>Used for advisory fuel planning along your routes. Estimates are non-guaranteed.</Text>
            </>}

            <TouchableOpacity disabled={saving} style={styles.saveButton} onPress={() => void saveProfile()}>
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save changes'}</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={saving} style={styles.cancelButton} onPress={() => setEditing(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
      </SheetModal>

      {/* Bookmark Saved Place Modal */}
      <SheetModal visible={placeModalVisible} onRequestClose={() => setPlaceModalVisible(false)}>
          <ScrollView style={{ maxHeight: '90%' }} contentContainerStyle={styles.modal}>
            <Text style={styles.modalTitle}>Save a place</Text>
            <Text style={styles.fieldLabel}>Place Name</Text>
            <TextInput style={styles.input} value={placeName} onChangeText={setPlaceName} placeholder="e.g. Rohtang Pass, Highway Dhaba, Petrol Bunk" placeholderTextColor={theme.subtle} />

            <Text style={styles.fieldLabel}>Category</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 }}>
              {(Object.keys(SAVED_PLACE_CATEGORIES) as SavedPlaceCategory[]).map(cat => {
                const meta = SAVED_PLACE_CATEGORIES[cat];
                const isSelected = placeCategory === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catPill, isSelected && { backgroundColor: theme.accent, borderColor: theme.accent }]}
                    onPress={() => setPlaceCategory(cat)}
                  >
                    <Icon name={SAVED_PLACE_ICONS[cat]} size="sm" color={isSelected ? theme.onAccent : theme.textMuted} />
                    <Text style={[styles.catPillText, isSelected && { color: theme.onAccent }]}>{meta.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Latitude</Text>
                <TextInput style={styles.input} value={placeLat} onChangeText={setPlaceLat} keyboardType="decimal-pad" placeholder="e.g. 32.3716" placeholderTextColor={theme.subtle} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Longitude</Text>
                <TextInput style={styles.input} value={placeLng} onChangeText={setPlaceLng} keyboardType="decimal-pad" placeholder="e.g. 77.2466" placeholderTextColor={theme.subtle} />
              </View>
            </View>

            <Text style={styles.fieldLabel}>Address / Landmark (optional)</Text>
            <TextInput style={styles.input} value={placeAddress} onChangeText={setPlaceAddress} placeholder="e.g. Manali-Leh Highway, HP" placeholderTextColor={theme.subtle} />

            <Text style={styles.fieldLabel}>Touring Notes (optional)</Text>
            <TextInput style={styles.input} value={placeNotes} onChangeText={setPlaceNotes} placeholder="e.g. Reliable 24x7 fuel, clean washrooms, puncture repair" placeholderTextColor={theme.subtle} />

            <TouchableOpacity disabled={savingPlace} style={styles.saveButton} onPress={() => void handleAddSavedPlace()}>
              <Text style={styles.saveText}>{savingPlace ? 'Saving…' : 'Save destination'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setPlaceModalVisible(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
      </SheetModal>
    </View>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.background,
    },
    topHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 12,
      backgroundColor: c.surface,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      zIndex: 10,
    },
    headerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    headerTitleText: {
      color: c.text,
      fontSize: 14,
      fontWeight: '900',
      letterSpacing: 1.2,
    },
    headerRightActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    headerActionBtn: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: c.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerAvatarImg: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: c.accent,
    },
    headerAvatarPlaceholder: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerAvatarText: {
      color: c.onAccent,
      fontSize: 14,
      fontWeight: '800',
    },
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    content: {
      padding: 16,
      gap: 16,
    },
    riderCard: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: 16,
      gap: 14,
    },
    riderTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    riderAvatarBox: {
      position: 'relative',
    },
    riderAvatarImage: {
      width: 60,
      height: 60,
      borderRadius: 30,
    },
    riderAvatarInitial: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    riderAvatarInitialText: {
      color: c.onAccent,
      fontSize: 24,
      fontWeight: '900',
    },
    verifiedCheckBadge: {
      position: 'absolute',
      bottom: -2,
      right: -2,
      width: 20,
      height: 20,
      borderRadius: radius.round,
      backgroundColor: c.green,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: c.surface,
    },
    riderMetaCol: {
      flex: 1,
      gap: 2,
    },
    riderNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    riderName: {
      fontSize: 18,
      fontWeight: '900',
      color: c.text,
      flexShrink: 1,
    },
    ghostPill: {
      backgroundColor: c.surfaceRaised,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    ghostPillText: {
      fontSize: 9,
      fontWeight: '800',
      color: c.accent,
      letterSpacing: 0.8,
    },
    careerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 2,
    },
    careerSubtitle: {
      fontSize: 12,
      color: c.textMuted,
      fontWeight: '600',
    },
    telemetrySplitRow: {
      flexDirection: 'row',
      backgroundColor: c.surfaceRaised,
      borderRadius: 12,
      padding: 10,
      gap: 4,
    },
    telemetrySplitCell: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
    },
    telemetryCellLabel: {
      fontSize: 9,
      fontWeight: '800',
      color: c.textMuted,
      letterSpacing: 0.8,
    },
    telemetryCellNum: {
      fontSize: 18,
      fontWeight: '900',
      color: c.text,
      letterSpacing: -0.5,
    },
    telemetryCellSub: {
      fontSize: 8,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    iceCard: {
      backgroundColor: c.dangerSoft,
      borderColor: c.danger,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    iceConsentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
    },
    iceLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    iceBloodType: {
      fontSize: 10,
      fontWeight: '800',
      color: c.danger,
      letterSpacing: 0.8,
    },
    iceRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    iceLabel: {
      fontSize: 10,
      color: c.danger,
      fontWeight: '600',
    },
    icePhone: {
      fontSize: 11,
      fontWeight: '800',
      color: c.danger,
    },
    fleetHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 4,
    },
    fleetTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    fleetTitleText: {
      fontSize: 12,
      fontWeight: '900',
      color: c.text,
      letterSpacing: 1.2,
    },
    addBikeBtn: {
      backgroundColor: c.surfaceRaised,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 8,
    },
    addBikeBtnText: {
      fontSize: 11,
      fontWeight: '800',
      color: c.accent,
      letterSpacing: 0.5,
    },
    steedCard: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
      gap: 12,
    },
    steedCoverBox: {
      height: 120,
      backgroundColor: c.surfaceRaised,
      position: 'relative',
      padding: 12,
      justifyContent: 'space-between',
    },
    steedCoverBackdrop: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      backgroundColor: c.scrim,
    },
    primarySteedBadge: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: c.accent,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      zIndex: 2,
    },
    primarySteedText: {
      color: c.onAccent,
      fontSize: 9,
      fontWeight: '900',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    steedHeroMeta: {
      zIndex: 2,
    },
    steedModelTitle: {
      fontSize: 18,
      fontWeight: '900',
      color: c.scheme === 'light' ? c.onAccent : c.text,
    },
    steedCategoryText: {
      fontSize: 11,
      color: c.textMuted,
      fontWeight: '600',
      marginTop: 2,
    },
    steedMetricsRow: {
      flexDirection: 'row',
      paddingHorizontal: 14,
      paddingBottom: 14,
      alignItems: 'center',
    },
    steedMetricCol: {
      flex: 1,
      gap: 2,
    },
    steedMetricLabel: {
      fontSize: 9,
      fontWeight: '800',
      color: c.textMuted,
      letterSpacing: 0.6,
    },
    steedMetricValue: {
      fontSize: 15,
      fontWeight: '900',
      color: c.text,
    },
    steedMetricSub: {
      fontSize: 10,
      color: c.textMuted,
    },
    steedMetricDivider: {
      width: 1,
      height: 32,
      backgroundColor: c.border,
      marginHorizontal: 8,
    },
    steedEmptyCard: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: 24,
      alignItems: 'center',
      gap: 10,
    },
    steedEmptyIconBox: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: c.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 2,
    },
    steedEmptyTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: c.text,
      textAlign: 'center',
    },
    steedEmptySub: {
      fontSize: 13,
      lineHeight: 19,
      color: c.textMuted,
      textAlign: 'center',
      paddingHorizontal: 12,
      marginBottom: 4,
    },
    primaryAddBikeBtn: {
      backgroundColor: c.accent,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 12,
      marginTop: 4,
    },
    primaryAddBikeBtnText: {
      fontSize: 13,
      fontWeight: '800',
      color: c.onAccent,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: 16,
      gap: 12,
    },
    savedPlacesHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    sectionTitle: {
      color: c.text,
      fontSize: 14,
      fontWeight: '900',
      letterSpacing: 0.5,
    },
    addPlaceBtn: {
      backgroundColor: c.accent,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
    },
    addPlaceBtnText: {
      color: c.onAccent,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0.5,
    },
    hint: {
      color: c.textMuted,
      fontSize: 12,
      lineHeight: 18,
    },
    savedPlaceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    savedPlaceInfo: {
      flex: 1,
      paddingRight: 8,
      gap: 2,
    },
    savedPlaceTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    savedPlaceName: {
      color: c.text,
      fontSize: 13,
      fontWeight: '800',
    },
    savedPlaceMeta: {
      color: c.textMuted,
      fontSize: 11,
    },
    savedPlaceSub: {
      color: c.textMuted,
      fontSize: 10,
    },
    savedPlaceNotes: {
      color: c.accent,
      fontSize: 10,
      fontStyle: 'italic',
    },
    deletePlaceBtn: {
      padding: 6,
    },
    systemSection: {
      gap: 8,
    },
    systemSectionTitle: {
      fontSize: 11,
      fontWeight: '800',
      color: c.textMuted,
      letterSpacing: 1,
      paddingHorizontal: 4,
    },
    systemCard: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
    },
    systemItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      gap: 12,
    },
    systemItemIconBox: {
      width: 38,
      height: 38,
      borderRadius: 10,
      backgroundColor: c.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    systemItemTextCol: {
      flex: 1,
      gap: 2,
    },
    systemItemTitle: {
      fontSize: 13,
      fontWeight: '800',
      color: c.text,
    },
    systemItemSub: {
      fontSize: 11,
      color: c.textMuted,
    },
    systemItemArrow: {
      fontSize: 18,
      color: c.textMuted,
      fontWeight: '700',
    },
    systemItemDivider: {
      height: 1,
      backgroundColor: c.border,
      marginLeft: 62,
    },
    accountActionsContainer: {
      gap: 12,
      alignItems: 'center',
      paddingTop: 8,
    },
    signOutBtn: {
      width: '100%',
      minHeight: 52,
      backgroundColor: c.surfaceRaised,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    signOutText: {
      fontSize: 13,
      fontWeight: '800',
      color: c.text,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    deleteAccountButton: {
      paddingVertical: 10,
    },
    deleteAccountText: {
      color: c.danger,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    versionFooterBox: {
      alignItems: 'center',
      gap: 2,
      paddingTop: 4,
    },
    versionFooterText: {
      fontSize: 10,
      fontWeight: '800',
      color: c.textMuted,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    versionSubText: {
      fontSize: 9,
      color: c.textMuted,
      opacity: 0.7,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    modal: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 22,
      paddingBottom: 36,
    },
    modalTitle: {
      color: c.text,
      fontSize: 20,
      fontWeight: '900',
      marginBottom: 14,
    },
    fieldLabel: {
      color: c.text,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 12,
      marginBottom: 5,
    },
    input: {
      backgroundColor: c.surfaceRaised,
      color: c.text,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 10,
      padding: 13,
      fontSize: 14,
    },
    catPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: c.surfaceRaised,
    },
    catPillText: {
      fontSize: 11,
      fontWeight: '700',
      color: c.text,
    },
    saveButton: {
      backgroundColor: c.accent,
      padding: 15,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 20,
    },
    saveText: {
      color: c.onAccent,
      fontSize: 14,
      fontWeight: '900',
    },
    cancelButton: {
      padding: 14,
      alignItems: 'center',
      marginTop: 4,
    },
    cancelText: {
      color: c.textMuted,
      fontWeight: '700',
    },
  });
