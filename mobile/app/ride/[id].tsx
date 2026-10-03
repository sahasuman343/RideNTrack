import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, ActivityIndicator, Alert as Dialog, Share, Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Camera } from '@rnmapbox/maps';
import { type Ride, type LocationUpdate, type AlertType, ALERT_LABELS, isStale } from '@ridentrack/shared';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRide } from '../../src/hooks/useRide';
import { useAnimatedLocations } from '../../src/hooks/useAnimatedLocations';
import { useOfflineSync } from '../../src/hooks/useOfflineSync';
import { enqueueAlert, newQueueId } from '../../src/lib/offlineQueue';
import { startBackgroundLocationUpdates, stopBackgroundLocationUpdates } from '../../src/services/backgroundLocation';

let Mapbox: typeof import('@rnmapbox/maps').default | null = null;
try { Mapbox = require('@rnmapbox/maps').default; Mapbox?.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN || ''); }
catch { /* Native maps are unavailable in Expo Go; the rider panel still works. */ }

export default function LiveRideScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { user, profile } = useAuth();
  const userId = user?.id;
  const name = profile?.display_name || 'Rider';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ride, participants, alerts, connection, error, publish, refresh, setRide } = useRide(id, userId || '');
  const sync = useOfflineSync();
  const camera = useRef<React.ComponentRef<typeof Camera>>(null);
  const [position, setPosition] = useState<LocationUpdate | null>(null);
  const [tracking, setTracking] = useState<'waiting' | 'background' | 'foreground' | 'paused' | 'error'>('waiting');
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(true);
  const [gpsRetry, setGpsRetry] = useState(0);
  const [follow, setFollow] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(200);
  const cameraPadding = useMemo(() => ({ paddingTop: insets.top + 135, paddingBottom: sheetHeight + 28, paddingLeft: 45, paddingRight: 45 }), [insets.top,sheetHeight]);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [route, setRoute] = useState<Ride['route_geometry']>();
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<string[]>([]);
  const active = ride?.status === 'active';
  const admin = ride?.admin_id === userId;
  const points = useMemo(() => position && active ? [...participants.filter(p => p.user_id !== userId), position] : participants, [participants, position, active, userId]);
  const animated = useAnimatedLocations(points);
  const features = useMemo(() => ({ type: 'FeatureCollection' as const, features: animated.map(p => ({
    type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [p.lng,p.lat] },
    properties: { name: p.display_name, mine: p.user_id === userId, stale: isStale(p.timestamp,now) },
  })) }), [animated,userId,now]);
  const newest = alerts.find(a => a.user_id !== userId && !dismissed.includes(a.id) && now - Date.parse(a.created_at) < 300000);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()),5000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!active || !sharing || !userId) {
      setTracking('paused');
      void stopBackgroundLocationUpdates().catch(e => setGpsError(e.message));
      return;
    }
    let cancelled = false;
    setTracking('waiting'); setGpsError(null);
    void startBackgroundLocationUpdates({ rideId: id, userId, displayName: name, publish,
      onLocationUpdate: p => { if (!cancelled) setPosition(p); },
      onError: e => { if (!cancelled) setGpsError(e); },
    }).then(result => { if (!cancelled) setTracking(result.isBackgroundEnabled ? 'background' : 'foreground'); })
      .catch(e => { if (!cancelled) { setTracking('error'); setGpsError(e.message); } });
    return () => { cancelled = true; void stopBackgroundLocationUpdates().catch(() => {}); };
  }, [id,userId,name,active,sharing,publish,gpsRetry]);
  useEffect(() => {
    if (mapReady && follow && position) camera.current?.setCamera({
      centerCoordinate: [position.lng,position.lat], zoomLevel: 14, padding: cameraPadding, animationMode: 'easeTo', animationDuration: 900,
    });
  }, [mapReady,follow,position,cameraPadding]);
  useEffect(() => {
    if (ride?.route_geometry) { setRoute(ride.route_geometry); return; }
    if (!ride || !process.env.EXPO_PUBLIC_MAPBOX_TOKEN) return;
    const controller = new AbortController();
    const load = async () => {
      const response = await fetch('https://api.mapbox.com/directions/v5/mapbox/driving/' + ride.origin_coords.join(',') + ';' + ride.destination_coords.join(',') + '?geometries=geojson&overview=full&access_token=' + process.env.EXPO_PUBLIC_MAPBOX_TOKEN, { signal: controller.signal });
      if (!response.ok) throw new Error('Route unavailable. Rider positions still work.');
      const data = await response.json();
      if (!data.routes?.[0]) throw new Error('No driving route found.');
      const geo: NonNullable<Ride['route_geometry']> = { type: 'Feature', geometry: data.routes[0].geometry, properties: {} };
      if (controller.signal.aborted) return;
      setRoute(geo);
      if (admin) {
        const { error } = await supabase.from('rides').update({ route_geometry: geo }).eq('id',id);
        if (error) throw error;
      }
    };
    void load().catch(e => { if (!controller.signal.aborted) setMessage(e.message); });
    return () => controller.abort();
  }, [ride?.id,ride?.route_geometry,admin,id]);
  function fitGroup() {
    setFollow(false);
    const coords = points.length ? points.map(p => [p.lng,p.lat]) : ride ? [ride.origin_coords,ride.destination_coords] : [];
    if (!coords.length) return;
    if (coords.every(p => p[0] === coords[0][0] && p[1] === coords[0][1])) {
      camera.current?.setCamera({ centerCoordinate: coords[0],zoomLevel: 14,padding: cameraPadding,animationMode: 'easeTo',animationDuration: 800 });
      return;
    }
    camera.current?.fitBounds([Math.max(...coords.map(p => p[0])),Math.max(...coords.map(p => p[1]))],
      [Math.min(...coords.map(p => p[0])),Math.min(...coords.map(p => p[1]))], [cameraPadding.paddingTop,45,cameraPadding.paddingBottom,45],800);
  }
  async function changeStatus(status: 'active' | 'completed') {
    setBusy(true); setMessage(null);
    try {
      const { data,error } = await supabase.from('rides').update({ status }).eq('id',id).select().single();
      if (error) throw error;
      setRide(data as Ride);
      if (status === 'completed') { await stopBackgroundLocationUpdates(); await sync.flushQueue(); }
    } catch(e) { setMessage(e instanceof Error ? e.message : 'Could not update ride.'); }
    finally { setBusy(false); }
  }
  async function sendAlert(type: AlertType) {
    if (!position || !userId || isStale(position.timestamp)) { setMessage('Wait for a fresh GPS fix before sending an alert.'); return; }
    setBusy(true);
    try {
      await enqueueAlert({ id: await newQueueId(), ride_id: id, user_id: userId, type, lat: position.lat, lng: position.lng, created_at: new Date().toISOString() });
      setModal(false); await sync.flushQueue(); await refresh();
    } catch(e) { setMessage(e instanceof Error ? e.message : 'Could not save alert.'); }
    finally { setBusy(false); }
  }
  const pending = sync.pendingLocationsCount + sync.pendingAlertsCount;
  const status = !sync.isOnline ? 'Offline · saved on device' : connection !== 'live' ? 'Reconnecting…' :
    !active ? ride?.status === 'completed' ? 'Ride completed' : 'Ready to ride' :
    tracking === 'background' ? 'Live · background GPS' : tracking === 'foreground' ? 'Live · keep app open' :
    tracking === 'waiting' ? 'Getting GPS fix…' : tracking === 'error' ? 'GPS unavailable' : 'Location sharing paused';
  if (!ride) return <View style={s.loading}><Text style={s.brand}>RIDEN TRACK</Text>{error ? <Text style={s.text}>{error}</Text> : <ActivityIndicator color="#d66029" />}<TouchableOpacity onPress={() => void refresh()}><Text style={s.link}>Retry connection</Text></TouchableOpacity><TouchableOpacity onPress={() => router.back()}><Text style={s.link}>Back to rides</Text></TouchableOpacity></View>;
  return <View style={s.screen}>
    {Mapbox && process.env.EXPO_PUBLIC_MAPBOX_TOKEN ? <Mapbox.MapView style={StyleSheet.absoluteFill} styleURL="mapbox://styles/mapbox/streets-v12"
      onDidFinishLoadingMap={() => { setMapReady(true); setMapError(false); }} onMapLoadingError={() => setMapError(true)}
      onCameraChanged={state => { if (state.gestures.isGestureActive) setFollow(false); }}
      logoPosition={{ bottom: sheetHeight + 8,left: 10 }} attributionPosition={{ bottom: sheetHeight + 8,right: 10 }} compassEnabled>
      <Mapbox.Camera ref={camera} defaultSettings={{ centerCoordinate: ride.origin_coords,zoomLevel: 11 }} />
      {route && <Mapbox.ShapeSource id="route" shape={route}><Mapbox.LineLayer id="route-edge" style={{ lineColor: '#fff',lineWidth: 8,lineCap: 'round',lineJoin: 'round' }} /><Mapbox.LineLayer id="route-line" style={{ lineColor: '#de7136',lineWidth: 4,lineCap: 'round',lineJoin: 'round' }} /></Mapbox.ShapeSource>}
      <Mapbox.ShapeSource id="endpoints" shape={{ type: 'FeatureCollection',features: [ride.origin_coords,ride.destination_coords].map((coordinates,i) => ({ type: 'Feature',geometry: { type: 'Point',coordinates },properties: { label: i === 0 ? 'A' : 'B' } })) }}>
        <Mapbox.CircleLayer id="endpoint-dot" style={{ circleColor: '#213e44',circleRadius: 13,circleStrokeWidth: 3,circleStrokeColor: '#fff' }} />
        <Mapbox.SymbolLayer id="endpoint-label" style={{ textField: ['get','label'],textSize: 12,textColor: '#fff' }} />
      </Mapbox.ShapeSource>
      <Mapbox.ShapeSource id="riders" shape={features}>
        <Mapbox.CircleLayer id="rider-halo" style={{ circleRadius: 18,circleColor: '#e68145',circleOpacity: 0.18 }} />
        <Mapbox.CircleLayer id="rider-dot" style={{ circleRadius: 8,circleColor: ['case',['get','stale'],'#94a3b8',['get','mine'],'#df7133','#247963'],circleStrokeWidth: 3,circleStrokeColor: '#fff' }} />
        <Mapbox.SymbolLayer id="rider-label" style={{ textField: ['get','name'],textOffset: [0,1.8],textSize: 12,textColor: '#213e44',textHaloColor: '#fff',textHaloWidth: 2 }} />
      </Mapbox.ShapeSource>
    </Mapbox.MapView> : <View style={s.fallback}><Text style={s.heading}>Your ride, together.</Text><Text style={s.muted}>The native map needs a development build and a Mapbox token. Your rider list and foreground GPS remain available.</Text></View>}
    <View style={[s.top,{ top: insets.top + 10 }]}><TouchableOpacity accessibilityLabel="Back to rides" style={s.square} onPress={() => router.back()}><Text style={s.text}>‹</Text></TouchableOpacity><View style={s.title}><Text numberOfLines={1} style={s.heading}>{ride.name}</Text><Text numberOfLines={1} style={s.muted}>{ride.origin} → {ride.destination}</Text></View><TouchableOpacity accessibilityLabel="Share ride code" style={s.square} onPress={() => void Share.share({ message: 'Join ' + ride.name + ' on RideNTrack. Code: ' + ride.ride_code }).catch(() => setMessage('Could not open sharing.'))}><Text style={s.text}>↗</Text></TouchableOpacity></View>
    <View style={[s.controls,{ top: insets.top + 94 }]}><TouchableOpacity accessibilityLabel="Follow my location" style={[s.control,follow && s.selected]} disabled={!position} onPress={() => setFollow(true)}><Text style={s.text}>◎ Me</Text></TouchableOpacity><TouchableOpacity style={s.control} onPress={fitGroup}><Text style={s.text}>⊞ Group</Text></TouchableOpacity></View>
    {(message || gpsError || error || mapError) && <View style={[s.warning,{ top: insets.top + 150 }]}><Text style={s.warningText}>{message || gpsError || error || 'Map tiles could not load. GPS data is still saved locally.'}</Text><TouchableOpacity onPress={() => { setMessage(null); setGpsRetry(v => v + 1); void refresh(); }}><Text style={s.link}>Retry</Text></TouchableOpacity>{tracking === 'error' && <TouchableOpacity onPress={() => void Linking.openSettings()}><Text style={s.link}>Open settings</Text></TouchableOpacity>}</View>}
    <View onLayout={event => setSheetHeight(event.nativeEvent.layout.height)} style={[s.sheet,{ paddingBottom: Math.max(insets.bottom,16) }]}>
      <TouchableOpacity accessibilityLabel={expanded ? 'Collapse rider panel' : 'Expand rider panel'} onPress={() => setExpanded(v => !v)} style={s.sheetHeader}><View style={s.handle} /><View style={s.row}><View><Text style={s.eyebrow}>{status}</Text><Text style={s.heading}>{points.length} riders on map {expanded ? '⌄' : '⌃'}</Text></View><Text style={s.code}>{ride.ride_code}</Text></View></TouchableOpacity>
      {newest && <TouchableOpacity style={s.alertBanner} onPress={() => setDismissed(ids => [...ids,newest.id])}><Text style={s.warningText}>{ALERT_LABELS[newest.type]} · {newest.display_name} · tap to dismiss</Text></TouchableOpacity>}
      {(pending > 0 || sync.syncError) && <TouchableOpacity disabled={sync.isSyncing} onPress={() => void sync.flushQueue()} style={s.sync}><Text style={s.muted}>{sync.isSyncing ? 'Uploading saved updates…' : pending + ' updates saved · tap to sync'}</Text>{sync.syncError && <Text style={s.warningText}>{sync.syncError}</Text>}</TouchableOpacity>}
      {expanded && <ScrollView style={s.riders}>{points.length === 0 && <Text style={s.muted}>Rider positions appear after GPS starts. Last known positions remain visible during signal loss.</Text>}{points.map(p => <TouchableOpacity key={p.user_id} style={s.rider} onPress={() => { setFollow(false); camera.current?.setCamera({ centerCoordinate: [p.lng,p.lat],zoomLevel: 15,padding: cameraPadding,animationDuration: 700 }); }}><View style={[s.avatar,isStale(p.timestamp,now) && s.stale]}><Text style={s.buttonText}>{p.display_name[0]}</Text></View><View style={s.grow}><Text style={s.text}>{p.display_name}{p.user_id === userId ? ' · you' : ''}</Text><Text style={s.muted}>{isStale(p.timestamp,now) ? 'Last known position' : 'Live location'}</Text></View><Text style={s.text}>{isStale(p.timestamp,now) ? '—' : Math.round(p.speed * 3.6)} km/h</Text></TouchableOpacity>)}</ScrollView>}
      <View style={s.actions}>{active ? <><TouchableOpacity style={s.secondary} onPress={() => setSharing(v => !v)}><Text style={s.text}>{sharing ? 'Pause GPS' : 'Resume GPS'}</Text></TouchableOpacity><TouchableOpacity style={[s.primary,(!position || isStale(position.timestamp,now)) && s.disabled]} disabled={busy || !position || isStale(position.timestamp,now)} onPress={() => setModal(true)}><Text style={s.buttonText}>Send alert</Text></TouchableOpacity></> : admin && ride.status === 'planned' ? <TouchableOpacity style={s.primary} disabled={busy} onPress={() => void changeStatus('active')}><Text style={s.buttonText}>{busy ? 'Starting…' : 'Start the ride'}</Text></TouchableOpacity> : <Text style={s.muted}>{ride.status === 'completed' ? 'Ride ended. Location sharing is off.' : 'Waiting for the organizer to start.'}</Text>}
      {admin && active && <TouchableOpacity accessibilityLabel="End ride for everyone" style={s.endButton} disabled={busy} onPress={() => Dialog.alert('End this ride?', 'Sharing stops when each device receives the update.', [{ text: 'Keep riding',style: 'cancel' },{ text: 'End ride',style: 'destructive',onPress: () => void changeStatus('completed') }])}><Text style={s.endText}>End</Text></TouchableOpacity>}</View>
    </View>
    <Modal visible={modal} transparent animationType="slide" onRequestClose={() => setModal(false)}><View style={s.overlay}><View style={[s.modal,{ paddingBottom: Math.max(insets.bottom,24) }]}><Text style={s.heading}>Let your group know</Text><Text style={s.muted}>Your location is attached. Offline alerts are delivered after reconnecting.</Text>{(Object.keys(ALERT_LABELS) as AlertType[]).map(type => <TouchableOpacity key={type} style={[s.alertOption,type === 'emergency' && s.emergency]} disabled={busy} onPress={() => type === 'emergency' ? Dialog.alert('Send emergency alert?', 'Notify your group that you need help.', [{ text: 'Cancel',style: 'cancel' },{ text: 'Send alert',onPress: () => void sendAlert(type) }]) : void sendAlert(type)}><Text style={s.text}>{ALERT_LABELS[type]}</Text></TouchableOpacity>)}<TouchableOpacity style={s.secondary} onPress={() => setModal(false)}><Text style={s.text}>Cancel</Text></TouchableOpacity></View></View></Modal>
  </View>;
}
const s = StyleSheet.create({
  screen:{flex:1,backgroundColor:'#e2e9dc'},loading:{flex:1,alignItems:'center',justifyContent:'center',gap:24,padding:28,backgroundColor:'#f5f7f1'},brand:{color:'#d66029',fontSize:16,fontWeight:'800',letterSpacing:4},
  text:{color:'#213e44',fontSize:14,fontWeight:'600'},muted:{color:'#72827e',fontSize:12,lineHeight:18},heading:{color:'#213e44',fontSize:18,fontWeight:'700'},top:{position:'absolute',left:14,right:14,flexDirection:'row',gap:8,alignItems:'center'},title:{flex:1,padding:13,borderRadius:17,backgroundColor:'#fffffff5'},square:{width:44,height:48,borderRadius:15,backgroundColor:'#fff',alignItems:'center',justifyContent:'center'},
  controls:{position:'absolute',right:14,flexDirection:'row',gap:8},control:{backgroundColor:'#fff',paddingHorizontal:16,minHeight:44,justifyContent:'center',borderRadius:23,borderWidth:1,borderColor:'#d9e1d4'},selected:{borderColor:'#d66029',backgroundColor:'#fff3e9'},
  sheet:{position:'absolute',bottom:0,left:0,right:0,backgroundColor:'#fffffff8',borderTopLeftRadius:28,borderTopRightRadius:28,paddingHorizontal:20,shadowColor:'#213e44',shadowOpacity:0.12,shadowRadius:15,elevation:8},sheetHeader:{paddingTop:10,paddingBottom:16},handle:{width:38,height:4,backgroundColor:'#d5ded1',borderRadius:3,alignSelf:'center',marginBottom:14},row:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:8},eyebrow:{color:'#3c7b61',fontSize:11,fontWeight:'600',marginBottom:5},code:{backgroundColor:'#f0f4ec',padding:9,borderRadius:10,letterSpacing:2,fontSize:11,color:'#6a7c69'},
  riders:{maxHeight:185,marginBottom:12},rider:{flexDirection:'row',gap:10,alignItems:'center',paddingVertical:12,borderBottomWidth:1,borderColor:'#edf1e9'},avatar:{width:36,height:36,borderRadius:18,backgroundColor:'#3c7b61',alignItems:'center',justifyContent:'center'},stale:{backgroundColor:'#94a3a0'},grow:{flex:1},
  actions:{flexDirection:'row',gap:8,alignItems:'center'},primary:{flex:1,backgroundColor:'#d66029',borderRadius:15,minHeight:48,paddingHorizontal:16,alignItems:'center',justifyContent:'center'},secondary:{backgroundColor:'#eef3e9',borderRadius:15,minHeight:48,paddingHorizontal:16,alignItems:'center',justifyContent:'center'},buttonText:{color:'#fff',fontSize:14,fontWeight:'700'},disabled:{opacity:0.5},endButton:{minWidth:44,minHeight:48,alignItems:'center',justifyContent:'center'},endText:{color:'#b94936',fontSize:13},
  warning:{position:'absolute',left:16,right:16,backgroundColor:'#fff5e8',borderRadius:15,padding:12,gap:4},warningText:{color:'#99542d',fontSize:12,lineHeight:18},link:{color:'#c65e2c',fontWeight:'700',paddingVertical:8},sync:{paddingBottom:12},alertBanner:{padding:12,borderRadius:12,backgroundColor:'#fff0e8',marginBottom:10},overlay:{flex:1,justifyContent:'flex-end',backgroundColor:'#15313966'},modal:{borderTopLeftRadius:28,borderTopRightRadius:28,padding:24,backgroundColor:'#fff',gap:12},alertOption:{padding:20,borderRadius:16,backgroundColor:'#eff4e9'},emergency:{backgroundColor:'#ffeae1'},fallback:{padding:36,paddingTop:225,gap:14},
});
