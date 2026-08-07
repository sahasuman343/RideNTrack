import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, FlatList, Dimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import MapboxGL from '@rnmapbox/maps';
import * as Location from 'expo-location';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRealtimeLocation } from '../../src/hooks/useRealtimeLocation';
import { useAlerts, AlertType } from '../../src/hooks/useAlerts';
const ALERT_LABELS: Record<string, string> = {
  emergency: '🚨 Emergency',
  break: '☕ Break',
  fuel: '⛽ Fuel Stop',
  mechanical: '🔧 Mechanical Issue',
};

MapboxGL.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '');

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PARTICIPANT_PANEL_WIDTH = 160;

export default function LiveRideScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, profile } = useAuth();
  const [ride, setRide] = useState<any>(null);
  const [routeGeoJSON, setRouteGeoJSON] = useState<any>(null);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number }>({ lat: 0, lng: 0 });
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);

  const { participants, broadcastLocation } = useRealtimeLocation(
    id || '',
    user?.id || '',
    profile?.display_name || 'Rider'
  );

  const { alerts, latestAlert, sendAlert, dismissAlert } = useAlerts(
    id || '',
    user?.id || '',
    profile?.display_name || 'Rider'
  );

  useEffect(() => {
    if (id) fetchRide();
    startLocationTracking();
    return () => {
      locationSubscription.current?.remove();
    };
  }, [id]);

  async function fetchRide() {
    const { data } = await supabase.from('rides').select('*').eq('id', id).single();
    if (data) {
      setRide(data);
      if (!data.route_geometry) {
        fetchRoute(data.origin_coords, data.destination_coords);
      } else {
        setRouteGeoJSON(data.route_geometry);
      }
    }
  }

  async function fetchRoute(origin: [number, number], dest: [number, number]) {
    const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    try {
      const res = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${origin[0]},${origin[1]};${dest[0]},${dest[1]}?geometries=geojson&overview=full&access_token=${token}`
      );
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const geojson = {
          type: 'Feature',
          geometry: data.routes[0].geometry,
          properties: {},
        };
        setRouteGeoJSON(geojson);
        // Save route to DB
        await supabase.from('rides').update({ route_geometry: geojson }).eq('id', id);
      }
    } catch (err) {
      console.error('Route fetch error:', err);
    }
  }

  async function startLocationTracking() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    locationSubscription.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 10 },
      (location) => {
        const { latitude, longitude, speed, heading } = location.coords;
        setMyLocation({ lat: latitude, lng: longitude });
        broadcastLocation(latitude, longitude, speed || 0, heading || 0);
      }
    );
  }

  async function handleStartRide() {
    await supabase.from('rides').update({ status: 'active' }).eq('id', id);
    setRide((prev: any) => ({ ...prev, status: 'active' }));
  }

  async function handleEndRide() {
    await supabase.from('rides').update({ status: 'completed' }).eq('id', id);
    setRide((prev: any) => ({ ...prev, status: 'completed' }));
  }

  function handleSendAlert(type: AlertType) {
    sendAlert(type, myLocation.lat, myLocation.lng);
    setShowAlertModal(false);
  }

  const participantList = Array.from(participants.values());
  const isAdmin = ride?.admin_id === user?.id;

  return (
    <View style={styles.container}>
      {/* Left-side participant panel */}
      <View style={styles.participantPanel}>
        <Text style={styles.panelTitle}>Riders ({participantList.length})</Text>
        <FlatList
          data={participantList}
          keyExtractor={(item) => item.user_id}
          renderItem={({ item }) => (
            <View style={styles.participantItem}>
              <View style={[styles.dot, { backgroundColor: item.user_id === user?.id ? '#FF6B00' : '#4CAF50' }]} />
              <View style={styles.participantInfo}>
                <Text style={styles.participantName} numberOfLines={1}>
                  {item.display_name}
                </Text>
                <Text style={styles.participantSpeed}>
                  {Math.round((item.speed || 0) * 3.6)} km/h
                </Text>
              </View>
            </View>
          )}
        />
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapboxGL.MapView style={styles.map} styleURL={MapboxGL.StyleURL.Dark}>
          <MapboxGL.Camera
            centerCoordinate={
              myLocation.lng !== 0
                ? [myLocation.lng, myLocation.lat]
                : ride?.origin_coords || [78.9629, 20.5937] // Default: center of India
            }
            zoomLevel={12}
          />

          {/* Route line */}
          {routeGeoJSON && (
            <MapboxGL.ShapeSource id="routeSource" shape={routeGeoJSON}>
              <MapboxGL.LineLayer
                id="routeLine"
                style={{ lineColor: '#FF6B00', lineWidth: 4, lineOpacity: 0.8 }}
              />
            </MapboxGL.ShapeSource>
          )}

          {/* Participant markers */}
          {participantList.map((p) => (
            <MapboxGL.PointAnnotation
              key={p.user_id}
              id={p.user_id}
              coordinate={[p.lng, p.lat]}
              title={p.display_name}
            >
              <View style={styles.marker}>
                <Text style={styles.markerText}>{p.display_name[0]}</Text>
              </View>
            </MapboxGL.PointAnnotation>
          ))}

          {/* Origin marker */}
          {ride?.origin_coords && (
            <MapboxGL.PointAnnotation id="origin" coordinate={ride.origin_coords}>
              <View style={[styles.locationPin, { backgroundColor: '#4CAF50' }]}>
                <Text style={styles.pinText}>A</Text>
              </View>
            </MapboxGL.PointAnnotation>
          )}

          {/* Destination marker */}
          {ride?.destination_coords && (
            <MapboxGL.PointAnnotation id="destination" coordinate={ride.destination_coords}>
              <View style={[styles.locationPin, { backgroundColor: '#e74c3c' }]}>
                <Text style={styles.pinText}>B</Text>
              </View>
            </MapboxGL.PointAnnotation>
          )}
        </MapboxGL.MapView>

        {/* Ride info overlay */}
        <View style={styles.rideInfo}>
          <Text style={styles.rideName}>{ride?.name || 'Loading...'}</Text>
          <Text style={styles.rideRoute}>{ride?.origin} → {ride?.destination}</Text>
          {ride?.ride_code && <Text style={styles.rideCode}>Code: {ride.ride_code}</Text>}
        </View>

        {/* Admin controls */}
        {isAdmin && ride?.status === 'planned' && (
          <TouchableOpacity style={styles.startButton} onPress={handleStartRide}>
            <Text style={styles.startButtonText}>Start Ride</Text>
          </TouchableOpacity>
        )}
        {isAdmin && ride?.status === 'active' && (
          <TouchableOpacity style={[styles.startButton, { backgroundColor: '#e74c3c' }]} onPress={handleEndRide}>
            <Text style={styles.startButtonText}>End Ride</Text>
          </TouchableOpacity>
        )}

        {/* Alert button */}
        <TouchableOpacity style={styles.alertButton} onPress={() => setShowAlertModal(true)}>
          <Text style={styles.alertButtonText}>⚠️ Alert</Text>
        </TouchableOpacity>
      </View>

      {/* Latest alert notification */}
      {latestAlert && latestAlert.user_id !== user?.id && (
        <TouchableOpacity style={styles.alertBanner} onPress={dismissAlert}>
          <Text style={styles.alertBannerText}>
            {ALERT_LABELS[latestAlert.type]} from {latestAlert.display_name}
          </Text>
          <Text style={styles.alertDismiss}>Tap to dismiss</Text>
        </TouchableOpacity>
      )}

      {/* Alert selection modal */}
      <Modal visible={showAlertModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Send Alert</Text>
            {(Object.keys(ALERT_LABELS) as AlertType[]).map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.alertOption, type === 'emergency' && styles.emergencyOption]}
                onPress={() => handleSendAlert(type)}
              >
                <Text style={styles.alertOptionText}>{ALERT_LABELS[type]}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.cancelButton} onPress={() => setShowAlertModal(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: '#1a1a2e' },
  participantPanel: {
    width: PARTICIPANT_PANEL_WIDTH,
    backgroundColor: '#16213e',
    borderRightWidth: 1,
    borderRightColor: '#0f3460',
    paddingTop: 8,
  },
  panelTitle: { color: '#FF6B00', fontSize: 14, fontWeight: '700', padding: 12, paddingBottom: 8 },
  participantItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  participantInfo: { flex: 1 },
  participantName: { color: '#fff', fontSize: 12, fontWeight: '500' },
  participantSpeed: { color: '#999', fontSize: 10, marginTop: 2 },
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  marker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FF6B00',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  markerText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  locationPin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  pinText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  rideInfo: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(22, 33, 62, 0.9)',
    borderRadius: 12,
    padding: 12,
  },
  rideName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  rideRoute: { color: '#ccc', fontSize: 12, marginTop: 2 },
  rideCode: { color: '#FF6B00', fontSize: 11, marginTop: 2, fontFamily: 'monospace' },
  startButton: {
    position: 'absolute',
    bottom: 80,
    left: 12,
    right: 12,
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  startButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  alertButton: {
    position: 'absolute',
    bottom: 20,
    right: 12,
    backgroundColor: '#e74c3c',
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  alertButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  alertBanner: {
    position: 'absolute',
    top: 60,
    left: PARTICIPANT_PANEL_WIDTH + 12,
    right: 12,
    backgroundColor: '#e74c3c',
    borderRadius: 12,
    padding: 16,
    zIndex: 100,
  },
  alertBannerText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  alertDismiss: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 4 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#16213e', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  alertOption: {
    backgroundColor: '#0f3460',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    alignItems: 'center',
  },
  emergencyOption: { backgroundColor: '#e74c3c' },
  alertOptionText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelButton: { padding: 16, alignItems: 'center' },
  cancelText: { color: '#999', fontSize: 16 },
});
