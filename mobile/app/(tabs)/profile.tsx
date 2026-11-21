import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Modal, TextInput, Image, Switch, ScrollView } from 'react-native';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, useRideThemeSettings, RidePalette } from '../../src/theme';
import { supabase } from '../../src/lib/supabase';
import { type UserSavedPlace, type SavedPlaceCategory, SAVED_PLACE_CATEGORIES } from '@ridentrack/shared';

export default function ProfileScreen() {
  const { profile, signOut, deleteAccount, updateProfile } = useAuth();
  const theme = useRideTheme();
  const { mode, setMode } = useRideThemeSettings();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [emergencyContact, setEmergencyContact] = useState(profile?.emergency_contact || '');
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
    if (!displayName.trim()) { Alert.alert('Name required', 'Please enter your display name.'); return; }
    if (phone.trim() && !/^\+?[0-9 ()-]{7,20}$/.test(phone.trim())) {
      Alert.alert('Check phone number', 'Enter a valid phone number, including country code if needed.'); return;
    }
    if (emergencyContact.trim() && !/^\+?[0-9 ()-]{7,25}$/.test(emergencyContact.trim())) {
      Alert.alert('Check emergency contact', 'Enter a valid emergency contact number, including country code.'); return;
    }
    if (avatarUrl.trim() && !/^https?:\/\//i.test(avatarUrl.trim())) {
      Alert.alert('Invalid photo URL', 'Use a public HTTPS or HTTP image URL.'); return;
    }
    const tankNum = tankCapacity.trim() ? Number(tankCapacity) : null;
    if (tankNum != null && (!Number.isFinite(tankNum) || tankNum <= 0 || tankNum > 100)) {
      Alert.alert('Invalid fuel tank capacity', 'Enter a valid capacity between 1 and 100 liters.'); return;
    }
    const mileageNum = mileage.trim() ? Number(mileage) : null;
    if (mileageNum != null && (!Number.isFinite(mileageNum) || mileageNum <= 0 || mileageNum > 150)) {
      Alert.alert('Invalid mileage', 'Enter a valid mileage between 1 and 150 km/l.'); return;
    }
    const reserveNum = reserve.trim() ? Number(reserve) : null;
    if (reserveNum != null && (!Number.isFinite(reserveNum) || reserveNum < 0 || reserveNum > 30)) {
      Alert.alert('Invalid reserve', 'Enter a valid reserve between 0 and 30 liters.'); return;
    }
    setSaving(true);
    try {
      await updateProfile({
        display_name: displayName.trim(),
        phone: phone.trim() || null,
        emergency_contact: emergencyContact.trim() || null,
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
    } finally { setSaving(false); }
  }
  const dark = mode === 'dark' || (mode === 'system' && theme.background === '#14221D');

  const safeRangeKm = profile?.fuel_tank_capacity_liters && profile?.mileage_km_per_liter
    ? Math.round(Math.max(0.5, profile.fuel_tank_capacity_liters - (profile.fuel_reserve_liters || 0)) * profile.mileage_km_per_liter)
    : null;
  const totalRangeKm = profile?.fuel_tank_capacity_liters && profile?.mileage_km_per_liter
    ? Math.round(profile.fuel_tank_capacity_liters * profile.mileage_km_per_liter)
    : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>YOUR RIDER ACCOUNT</Text>
      {profile?.avatar_url ? <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} /> :
        <View style={styles.avatar}><Text style={styles.avatarText}>{profile?.display_name?.[0]?.toUpperCase() || '?'}</Text></View>}
      <Text style={styles.name}>{profile?.display_name || 'Rider'}</Text>
      <Text style={styles.username}>@{profile?.username || 'unknown'}</Text>
      <TouchableOpacity style={styles.editButton} onPress={openEditor}><Text style={styles.editText}>Edit profile & motorcycle</Text></TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.section}>Rider details</Text>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>Phone</Text><Text style={styles.infoValue}>{profile?.phone || 'Not set'}</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>Emergency contact</Text><Text style={styles.infoValue}>{profile?.emergency_contact || 'Not set'}</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>Username</Text><Text style={styles.infoValue}>@{profile?.username || 'unknown'}</Text></View>
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Motorcycle profile & machine</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Machine</Text>
          <Text style={styles.infoValue}>{profile?.motorcycle_make ? `${profile.motorcycle_make} ${profile.motorcycle_model || ''}` : 'Not configured'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Category</Text>
          <Text style={styles.infoValue}>{profile?.motorcycle_category ? profile.motorcycle_category.toUpperCase() : 'TOURER'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Fuel tank & reserve</Text>
          <Text style={styles.infoValue}>{profile?.fuel_tank_capacity_liters ? `${profile.fuel_tank_capacity_liters} L (${profile.fuel_reserve_liters ?? 3} L reserve)` : 'Not configured'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Approximate mileage</Text>
          <Text style={styles.infoValue}>{profile?.mileage_km_per_liter ? `${profile.mileage_km_per_liter} km/l` : 'Not configured'}</Text>
        </View>
        {safeRangeKm != null && totalRangeKm != null && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Estimated fuel range (advisory)</Text>
            <Text style={[styles.infoValue, { color: theme.green }]}>~{safeRangeKm} km safe range · ~{totalRangeKm} km tank maximum</Text>
            <Text style={styles.hint}>Advisory estimate. Actual fuel consumption varies with riding pace, elevation, wind, and luggage.</Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={[styles.section, { marginBottom: 0 }]}>Saved Places & Destinations ({savedPlaces.length})</Text>
          <TouchableOpacity
            style={[styles.catPill, { backgroundColor: theme.accent, borderColor: theme.accent }]}
            onPress={() => setPlaceModalVisible(true)}
          >
            <Text style={[styles.catPillText, { color: '#fff' }]}>+ Add Place</Text>
          </TouchableOpacity>
        </View>
        {savedPlaces.length === 0 ? (
          <Text style={styles.hint}>No saved destinations yet. Bookmark mountain passes, viewpoints, trusted fuel bunks, or dhabas for your tours.</Text>
        ) : (
          savedPlaces.map(place => {
            const catMeta = SAVED_PLACE_CATEGORIES[place.category] || { label: place.category, icon: '📍' };
            return (
              <View key={place.id} style={styles.infoRow}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.infoValue}>{catMeta.icon} {place.name}</Text>
                    <Text style={[styles.infoLabel, { marginTop: 2 }]}>{catMeta.label} · {place.latitude.toFixed(4)}, {place.longitude.toFixed(4)}</Text>
                    {!!place.address && <Text style={[styles.hint, { marginTop: 2 }]}>{place.address}</Text>}
                    {!!place.notes && <Text style={[styles.hint, { fontStyle: 'italic', marginTop: 2 }]}>{place.notes}</Text>}
                  </View>
                  <TouchableOpacity
                    style={{ padding: 4 }}
                    onPress={() => void handleDeleteSavedPlace(place.id, place.name)}
                  >
                    <Text style={{ color: theme.danger, fontSize: 13, fontWeight: '700' }}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Appearance</Text>
        <View style={styles.settingRow}>
          <View style={{ flex: 1 }}><Text style={styles.settingTitle}>Dark mode</Text><Text style={styles.settingHint}>{mode === 'system' ? 'Following your device setting' : dark ? 'Dark theme enabled' : 'Light theme enabled'}</Text></View>
          <Switch value={dark} onValueChange={value => setMode(value ? 'dark' : 'light')} trackColor={{ false: theme.border, true: theme.green }} thumbColor={theme.surface} />
        </View>
        <TouchableOpacity onPress={() => setMode('system')} style={styles.systemButton}><Text style={styles.systemText}>Use device appearance</Text></TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={() => void signOut().catch(e => Alert.alert('Sign out failed', e.message))}>
        <Text style={styles.logoutText}>Sign out</Text>
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

      <Modal visible={editing} transparent animationType="slide" onRequestClose={() => setEditing(false)}>
        <View style={styles.overlay}><ScrollView style={{ maxHeight: '90%' }} contentContainerStyle={styles.modal}>
          <Text style={styles.modalTitle}>Edit rider & motorcycle profile</Text>
          <Text style={styles.fieldLabel}>Display name</Text>
          <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={theme.subtle} />
          <Text style={styles.fieldLabel}>Phone number</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91..." placeholderTextColor={theme.subtle} />
          <Text style={styles.fieldLabel}>Emergency contact</Text>
          <TextInput style={styles.input} value={emergencyContact} onChangeText={setEmergencyContact} keyboardType="phone-pad" placeholder="Emergency contact phone (+91...)" placeholderTextColor={theme.subtle} />
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
                <Text style={[styles.catPillText, category === cat && { color: '#fff' }]}>{cat.toUpperCase()}</Text>
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

          <TouchableOpacity disabled={saving} style={styles.saveButton} onPress={() => void saveProfile()}><Text style={styles.saveText}>{saving ? 'Saving…' : 'Save changes'}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={() => setEditing(false)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
        </ScrollView></View>
      </Modal>

      <Modal visible={placeModalVisible} transparent animationType="slide" onRequestClose={() => setPlaceModalVisible(false)}>
        <View style={styles.overlay}><ScrollView style={{ maxHeight: '90%' }} contentContainerStyle={styles.modal}>
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
                  <Text style={[styles.catPillText, isSelected && { color: '#fff' }]}>{meta.icon} {meta.label}</Text>
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
        </ScrollView></View>
      </Modal>
    </ScrollView>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  content: { padding: 24, alignItems: 'center', paddingTop: 42, paddingBottom: 48 },
  eyebrow: { color: c.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 20 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: c.green, justifyContent: 'center', alignItems: 'center' },
  avatarImage: { width: 88, height: 88, borderRadius: 44, backgroundColor: c.surfaceRaised },
  avatarText: { color: c.surface, fontSize: 32, fontWeight: 'bold' },
  name: { color: c.text, fontSize: 25, fontWeight: '800', marginTop: 15 },
  username: { color: c.muted, fontSize: 14, marginTop: 4 },
  editButton: { marginTop: 17, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 11 },
  editText: { color: c.text, fontWeight: '700', fontSize: 13 },
  card: { width: '100%', marginTop: 22, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 17 },
  section: { color: c.text, fontSize: 17, fontWeight: '800', marginBottom: 12 },
  infoRow: { paddingVertical: 11, borderTopWidth: 1, borderTopColor: c.border },
  infoLabel: { color: c.muted, fontSize: 12 },
  infoValue: { color: c.text, fontSize: 15, fontWeight: '600', marginTop: 4 },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  settingTitle: { color: c.text, fontSize: 15, fontWeight: '700' },
  settingHint: { color: c.muted, fontSize: 12, marginTop: 3 },
  systemButton: { alignSelf: 'flex-start', marginTop: 10, paddingVertical: 8 },
  systemText: { color: c.accent, fontSize: 13, fontWeight: '700' },
  logoutButton: { marginTop: 24, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.border, borderRadius: 13, padding: 16, width: '100%', alignItems: 'center' },
  logoutText: { color: c.text, fontSize: 15, fontWeight: '700' },
  deleteAccountButton: { marginTop: 12, backgroundColor: 'transparent', borderRadius: 13, padding: 14, width: '100%', alignItems: 'center' },
  deleteAccountText: { color: c.danger, fontSize: 13, fontWeight: '700' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' },
  modal: { backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 36 },
  modalTitle: { color: c.text, fontSize: 21, fontWeight: '800', marginBottom: 14 },
  fieldLabel: { color: c.text, fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 5 },
  input: { backgroundColor: c.input, color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 13, fontSize: 15 },
  catPill: { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: c.surfaceRaised },
  catPillText: { fontSize: 11, fontWeight: '700', color: c.text },
  hint: { color: c.muted, fontSize: 11, marginTop: 7, lineHeight: 16 },
  saveButton: { backgroundColor: c.accent, padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  saveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  cancelButton: { padding: 14, alignItems: 'center', marginTop: 4 },
  cancelText: { color: c.muted, fontWeight: '700' },
});
