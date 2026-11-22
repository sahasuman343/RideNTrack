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
import { useRideTheme, useRideThemeSettings, RidePalette } from '../../src/theme';
import { supabase } from '../../src/lib/supabase';
import { type UserSavedPlace, type SavedPlaceCategory, SAVED_PLACE_CATEGORIES } from '@ridentrack/shared';
import { LiveDot } from '../../src/components/ui';

export default function ProfileScreen() {
  const { profile, signOut, deleteAccount, updateProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const theme = useRideTheme();
  const { mode, setMode } = useRideThemeSettings();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [emergencyContact, setEmergencyContact] = useState(profile?.emergency_contact || '');
  const [bloodGroup, setBloodGroup] = useState(profile?.blood_group || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');
  const [make, setMake] = useState(profile?.motorcycle_make || '');
  const [model, setModel] = useState(profile?.motorcycle_model || '');
  const [category, setCategory] = useState(profile?.motorcycle_category || 'adventure');
  const [tankCapacity, setTankCapacity] = useState(profile?.fuel_tank_capacity_liters ? String(profile.fuel_tank_capacity_liters) : '');
  const [mileage, setMileage] = useState(profile?.mileage_km_per_liter ? String(profile.mileage_km_per_liter) : '');
  const [reserve, setReserve] = useState(profile?.fuel_reserve_liters != null ? String(profile.fuel_reserve_liters) : '3');

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

  const loadSavedPlaces = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_user_saved_places');
      if (error) throw error;
      setSavedPlaces(data || []);
    } catch {
      // Non-critical; fallback to empty list
    }
  }, []);

  useEffect(() => {
    void loadSavedPlaces();
  }, [loadSavedPlaces]);

  async function handleAddSavedPlace() {
    if (!placeName.trim()) {
      Alert.alert('Name required', 'Please enter a name for this place.');
      return;
    }
    const lat = Number(placeLat);
    const lng = Number(placeLng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
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

  function openEditor() {
    setDisplayName(profile?.display_name || '');
    setPhone(profile?.phone || '');
    setEmergencyContact(profile?.emergency_contact || '');
    setBloodGroup(profile?.blood_group || '');
    setAvatarUrl(profile?.avatar_url || '');
    setMake(profile?.motorcycle_make || '');
    setModel(profile?.motorcycle_model || '');
    setCategory(profile?.motorcycle_category || 'adventure');
    setTankCapacity(profile?.fuel_tank_capacity_liters ? String(profile.fuel_tank_capacity_liters) : '');
    setMileage(profile?.mileage_km_per_liter ? String(profile.mileage_km_per_liter) : '');
    setReserve(profile?.fuel_reserve_liters != null ? String(profile.fuel_reserve_liters) : '3');
    setEditing(true);
  }

  async function saveProfile() {
    if (!displayName.trim()) {
      Alert.alert('Name required', 'Please enter your display name.');
      return;
    }
    if (phone.trim() && !/^\+?[0-9 ()-]{7,20}$/.test(phone.trim())) {
      Alert.alert('Check phone number', 'Enter a valid phone number, including country code if needed.');
      return;
    }
    if (emergencyContact.trim() && !/^\+?[0-9 ()-]{7,25}$/.test(emergencyContact.trim())) {
      Alert.alert('Check emergency contact', 'Enter a valid emergency contact number, including country code.');
      return;
    }
    if (avatarUrl.trim() && !/^https?:\/\//i.test(avatarUrl.trim())) {
      Alert.alert('Invalid photo URL', 'Use a public HTTPS or HTTP image URL.');
      return;
    }
    const tankNum = tankCapacity.trim() ? Number(tankCapacity) : null;
    if (tankNum != null && (!Number.isFinite(tankNum) || tankNum <= 0 || tankNum > 100)) {
      Alert.alert('Invalid fuel tank capacity', 'Enter a valid capacity between 1 and 100 liters.');
      return;
    }
    const mileageNum = mileage.trim() ? Number(mileage) : null;
    if (mileageNum != null && (!Number.isFinite(mileageNum) || mileageNum <= 0 || mileageNum > 150)) {
      Alert.alert('Invalid mileage', 'Enter a valid mileage between 1 and 150 km/l.');
      return;
    }
    const reserveNum = reserve.trim() ? Number(reserve) : null;
    if (reserveNum != null && (!Number.isFinite(reserveNum) || reserveNum < 0 || reserveNum > 30)) {
      Alert.alert('Invalid reserve', 'Enter a valid reserve between 0 and 30 liters.');
      return;
    }
    setSaving(true);
    try {
      await updateProfile({
        display_name: displayName.trim(),
        phone: phone.trim() || null,
        emergency_contact: emergencyContact.trim() || null,
        blood_group: bloodGroup.trim() || null,
        avatar_url: avatarUrl.trim() || null,
        motorcycle_make: make.trim() || null,
        motorcycle_model: model.trim() || null,
        motorcycle_category: (category as any) || null,
        fuel_tank_capacity_liters: tankNum,
        mileage_km_per_liter: mileageNum,
        fuel_reserve_liters: reserveNum,
      });
      setEditing(false);
      Alert.alert('Profile updated', 'Your rider details and motorcycle profile have been saved.');
    } catch (error) {
      Alert.alert('Could not update profile', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const dark = mode === 'dark' || (mode === 'system' && theme.background === '#111317');

  const safeRangeKm =
    profile?.fuel_tank_capacity_liters && profile?.mileage_km_per_liter
      ? Math.round(Math.max(0.5, profile.fuel_tank_capacity_liters - (profile.fuel_reserve_liters || 0)) * profile.mileage_km_per_liter)
      : null;
  const totalRangeKm =
    profile?.fuel_tank_capacity_liters && profile?.mileage_km_per_liter
      ? Math.round(profile.fuel_tank_capacity_liters * profile.mileage_km_per_liter)
      : null;

  const topInset = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0);

  return (
    <View style={styles.screen}>
      {/* Top Header Bar matching profile_garage.html */}
      <View style={[styles.topHeader, { paddingTop: Math.max(topInset + 8, 24) }]}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerEmblemIcon}>🏍️</Text>
          <Text style={styles.headerTitleText}>GARAGE & FLEET</Text>
        </View>

        <View style={styles.headerRightActions}>
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={openEditor}
            accessibilityRole="button"
            accessibilityLabel="Edit Profile & Garage"
          >
            <Text style={styles.headerActionIcon}>⚙️</Text>
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
        {/* Rider Profile Card */}
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
                <Text style={styles.verifiedCheckText}>✓</Text>
              </View>
            </View>

            <View style={styles.riderMetaCol}>
              <View style={styles.riderNameRow}>
                <Text style={styles.riderName} numberOfLines={1}>
                  {profile?.display_name || 'Arjun Mehta'}
                </Text>
                <View style={styles.ghostPill}>
                  <Text style={styles.ghostPillText}>
                    #{profile?.username ? profile.username.toUpperCase() : 'GHOST-1'}
                  </Text>
                </View>
              </View>
              <View style={styles.careerRow}>
                <Text style={styles.careerIcon}>🧭</Text>
                <Text style={styles.careerSubtitle}>Apex Explorer • Level 04</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.editProfileBtn}
              onPress={openEditor}
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
            >
              <Text style={styles.editProfileIcon}>✏️</Text>
            </TouchableOpacity>
          </View>

          {/* Telemetry Stats Split (Distance, Apex Alt, Expeditions) */}
          <View style={styles.telemetrySplitRow}>
            <View style={styles.telemetrySplitCell}>
              <Text style={styles.telemetryCellLabel}>DISTANCE</Text>
              <Text style={styles.telemetryCellNum}>28,450</Text>
              <Text style={[styles.telemetryCellSub, { color: theme.accent }]}>KM LOGGED</Text>
            </View>
            <View style={styles.telemetrySplitCell}>
              <Text style={styles.telemetryCellLabel}>APEX ALT</Text>
              <Text style={styles.telemetryCellNum}>5,359</Text>
              <Text style={[styles.telemetryCellSub, { color: theme.green }]}>M (Khardung)</Text>
            </View>
            <View style={styles.telemetrySplitCell}>
              <Text style={styles.telemetryCellLabel}>EXPEDITIONS</Text>
              <Text style={styles.telemetryCellNum}>{savedPlaces.length + 14}</Text>
              <Text style={[styles.telemetryCellSub, { color: theme.tertiary }]}>COMPLETED</Text>
            </View>
          </View>

          {/* Medical & Emergency ICE Tag */}
          <View style={styles.iceCard}>
            <View style={styles.iceLeft}>
              <Text style={styles.iceIcon}>🏥</Text>
              <Text style={styles.iceBloodType}>
                {profile?.blood_group ? profile.blood_group.toUpperCase() : 'Not recorded'}
              </Text>
            </View>
            <View style={styles.iceRight}>
              <Text style={styles.iceLabel}>ICE:</Text>
              <Text style={styles.icePhone}>
                {profile?.emergency_contact || 'Not recorded'}
              </Text>
            </View>
          </View>
        </View>

        {/* Motorcycle Fleet Section Header */}
        <View style={styles.fleetHeaderRow}>
          <View style={styles.fleetTitleRow}>
            <Text style={styles.fleetIcon}>🏍️</Text>
            <Text style={styles.fleetTitleText}>Motorcycle profile & machine</Text>
          </View>
          <TouchableOpacity
            style={styles.addBikeBtn}
            onPress={openEditor}
            accessibilityRole="button"
            accessibilityLabel="Add or configure motorcycle"
          >
            <Text style={styles.addBikeBtnText}>+ Add Bike</Text>
          </TouchableOpacity>
        </View>

        {/* Primary Steed Card */}
        <View style={styles.steedCard}>
          <View style={styles.steedCoverBox}>
            <View style={styles.steedCoverBackdrop} />
            <View style={styles.primarySteedBadge}>
              <LiveDot pulse color="#000000" size={6} />
              <Text style={styles.primarySteedText}>Primary Steed</Text>
            </View>
            <View style={styles.steedHeroMeta}>
              <Text style={styles.steedModelTitle}>
                {profile?.motorcycle_make ? `${profile.motorcycle_make} ${profile.motorcycle_model || ''}` : 'BMW R1250 GS Adv'}
              </Text>
              <Text style={styles.steedCategoryText}>
                {profile?.motorcycle_category ? profile.motorcycle_category.toUpperCase() : 'ADVENTURE TOURING'} • MH-02-EQ-8819
              </Text>
            </View>
          </View>

          {/* Steed Metrics */}
          <View style={styles.steedMetricsRow}>
            <View style={styles.steedMetricCol}>
              <Text style={styles.steedMetricLabel}>TANK CAPACITY</Text>
              <Text style={styles.steedMetricValue}>
                {profile?.fuel_tank_capacity_liters ? `${profile.fuel_tank_capacity_liters} L` : '20 L'}
              </Text>
              <Text style={styles.steedMetricSub}>
                {profile?.fuel_reserve_liters != null ? `${profile.fuel_reserve_liters} L Reserve` : '3 L Reserve'}
              </Text>
            </View>

            <View style={styles.steedMetricDivider} />

            <View style={styles.steedMetricCol}>
              <Text style={styles.steedMetricLabel}>EST. MILEAGE</Text>
              <Text style={styles.steedMetricValue}>
                {profile?.mileage_km_per_liter ? `${profile.mileage_km_per_liter} km/l` : '18 km/l'}
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
          {savedPlaces.length === 0 ? (
            <Text style={styles.hint}>
              No saved destinations yet. Bookmark mountain passes, viewpoints, trusted fuel bunks, or dhabas for your tours.
            </Text>
          ) : (
            savedPlaces.map(place => {
              const catMeta = SAVED_PLACE_CATEGORIES[place.category] || { label: place.category, icon: '📍' };
              return (
                <View key={place.id} style={styles.savedPlaceRow}>
                  <View style={styles.savedPlaceInfo}>
                    <Text style={styles.savedPlaceName}>{catMeta.icon} {place.name}</Text>
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
                    <Text style={styles.deletePlaceIcon}>✕</Text>
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
                <Text style={styles.systemItemIcon}>📥</Text>
              </View>
              <View style={styles.systemItemTextCol}>
                <Text style={styles.systemItemTitle}>Offline Topo Storage</Text>
                <Text style={styles.systemItemSub}>1.4 GB / 8.0 GB Himalayas Cached</Text>
              </View>
              <Text style={styles.systemItemArrow}>›</Text>
            </View>

            <View style={styles.systemItemDivider} />

            <View style={styles.systemItem}>
              <View style={[styles.systemItemIconBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                <Text style={styles.systemItemIcon}>🚨</Text>
              </View>
              <View style={styles.systemItemTextCol}>
                <Text style={styles.systemItemTitle}>Emergency SOS Protocols</Text>
                <Text style={styles.systemItemSub}>Manual SOS & Emergency Contacts</Text>
              </View>
              <Text style={styles.systemItemArrow}>›</Text>
            </View>

            <View style={styles.systemItemDivider} />

            <View style={styles.systemItem}>
              <View style={styles.systemItemIconBox}>
                <Text style={styles.systemItemIcon}>📐</Text>
              </View>
              <View style={styles.systemItemTextCol}>
                <Text style={styles.systemItemTitle}>Units & Telemetry</Text>
                <Text style={styles.systemItemSub}>Metric (km/h, Bar, °C)</Text>
              </View>
              <Text style={styles.systemItemArrow}>›</Text>
            </View>

            <View style={styles.systemItemDivider} />

            <View style={styles.systemItem}>
              <View style={styles.systemItemIconBox}>
                <Text style={styles.systemItemIcon}>☁️</Text>
              </View>
              <View style={styles.systemItemTextCol}>
                <Text style={styles.systemItemTitle}>Cloud GPX & Telemetry Export</Text>
                <Text style={[styles.systemItemSub, { color: theme.green }]}>Garmin • Strava Linked</Text>
              </View>
              <Text style={styles.systemItemArrow}>›</Text>
            </View>

            <View style={styles.systemItemDivider} />

            {/* Appearance Theme Toggle */}
            <View style={styles.systemItem}>
              <View style={styles.systemItemIconBox}>
                <Text style={styles.systemItemIcon}>🌓</Text>
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
                thumbColor="#FFFFFF"
              />
            </View>
          </View>
        </View>

        {/* Sign Out & Delete Account Actions */}
        <View style={styles.accountActionsContainer}>
          <TouchableOpacity
            style={styles.signOutBtn}
            onPress={() => void signOut().catch(e => Alert.alert('Sign out failed', e.message))}
            accessibilityRole="button"
            accessibilityLabel="Sign out of account"
          >
            <Text style={styles.signOutIcon}>🚪</Text>
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
            <Text style={styles.versionSubText}>Tactile Telemetry Engine • Iridium Ready</Text>
          </View>
        </View>
      </ScrollView>

      {/* Profile & Motorcycle Editor Modal */}
      <Modal visible={editing} transparent animationType="slide" onRequestClose={() => setEditing(false)}>
        <View style={styles.overlay}>
          <ScrollView style={{ maxHeight: '90%' }} contentContainerStyle={styles.modal}>
            <Text style={styles.modalTitle}>Edit rider & motorcycle profile</Text>
            <Text style={styles.fieldLabel}>Display name</Text>
            <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={theme.subtle} />
            <Text style={styles.fieldLabel}>Phone number</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91..." placeholderTextColor={theme.subtle} />
            <Text style={styles.fieldLabel}>Emergency contact</Text>
            <TextInput style={styles.input} value={emergencyContact} onChangeText={setEmergencyContact} keyboardType="phone-pad" placeholder="Emergency contact phone (+91...)" placeholderTextColor={theme.subtle} />
            <Text style={styles.fieldLabel}>Blood group (ICE medical)</Text>
            <TextInput style={styles.input} value={bloodGroup} onChangeText={setBloodGroup} autoCapitalize="characters" placeholder="e.g. O+, A+, B-, AB+" placeholderTextColor={theme.subtle} />
            <Text style={styles.fieldLabel}>Profile photo URL</Text>
            <TextInput style={styles.input} value={avatarUrl} onChangeText={setAvatarUrl} autoCapitalize="none" keyboardType="url" placeholder="https://..." placeholderTextColor={theme.subtle} />

            <Text style={[styles.fieldLabel, { marginTop: 18, color: theme.accent }]}>MOTORCYCLE PROFILE</Text>
            <Text style={styles.fieldLabel}>Make / Manufacturer</Text>
            <TextInput style={styles.input} value={make} onChangeText={setMake} placeholder="e.g. Royal Enfield, KTM, Triumph, BMW" placeholderTextColor={theme.subtle} />
            <Text style={styles.fieldLabel}>Model</Text>
            <TextInput style={styles.input} value={model} onChangeText={setModel} placeholder="e.g. Himalayan 450, 390 Adventure" placeholderTextColor={theme.subtle} />
            <Text style={styles.fieldLabel}>Motorcycle category</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 }}>
              {(['adventure', 'tourer', 'cruiser', 'sport', 'commuter', 'scooter'] as const).map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.catPill, category === cat && { backgroundColor: theme.accent, borderColor: theme.accent }]}
                  onPress={() => setCategory(cat)}
                >
                  <Text style={[styles.catPillText, category === cat && { color: '#000' }]}>{cat.toUpperCase()}</Text>
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

            <TouchableOpacity disabled={saving} style={styles.saveButton} onPress={() => void saveProfile()}>
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save changes'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setEditing(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Bookmark Saved Place Modal */}
      <Modal visible={placeModalVisible} transparent animationType="slide" onRequestClose={() => setPlaceModalVisible(false)}>
        <View style={styles.overlay}>
          <ScrollView style={{ maxHeight: '90%' }} contentContainerStyle={styles.modal}>
            <Text style={styles.modalTitle}>Bookmark Saved Place</Text>
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
                    <Text style={[styles.catPillText, isSelected && { color: '#000' }]}>{meta.icon} {meta.label}</Text>
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
        </View>
      </Modal>
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
    headerEmblemIcon: {
      fontSize: 20,
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
    headerActionIcon: {
      fontSize: 18,
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
      color: '#000000',
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
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.border,
      padding: 16,
      gap: 14,
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 2,
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
      color: '#000000',
      fontSize: 24,
      fontWeight: '900',
    },
    verifiedCheckBadge: {
      position: 'absolute',
      bottom: -2,
      right: -2,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: c.green,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: c.surface,
    },
    verifiedCheckText: {
      color: '#000000',
      fontSize: 11,
      fontWeight: '900',
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
    careerIcon: {
      fontSize: 13,
    },
    careerSubtitle: {
      fontSize: 12,
      color: c.textMuted,
      fontWeight: '600',
    },
    editProfileBtn: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: c.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    editProfileIcon: {
      fontSize: 16,
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
      backgroundColor: 'rgba(239, 68, 68, 0.12)',
      borderColor: 'rgba(239, 68, 68, 0.3)',
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    iceLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    iceIcon: {
      fontSize: 14,
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
    fleetIcon: {
      fontSize: 16,
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
      borderRadius: 18,
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
      backgroundColor: '#0c0e11',
      opacity: 0.6,
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
      color: '#000000',
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
      color: '#FFFFFF',
    },
    steedCategoryText: {
      fontSize: 11,
      color: '#cbd5e1',
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
    card: {
      backgroundColor: c.surface,
      borderRadius: 18,
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
      color: '#000000',
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
    deletePlaceIcon: {
      color: c.danger,
      fontSize: 14,
      fontWeight: '800',
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
      borderRadius: 18,
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
    systemItemIcon: {
      fontSize: 18,
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
    signOutIcon: {
      fontSize: 16,
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
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: '#00000088',
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
      color: '#000000',
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
