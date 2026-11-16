import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, RidePalette } from '../../src/theme';
import { formatRouteDistance, formatRouteDuration, parseDirectionsRoute, routeCoordinates, validateRoutePoints, type RoutePoint, type RouteWaypointType } from '@ridentrack/shared';

const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
let Mapbox: any = null;
if (TOKEN) {
  try { Mapbox = require('@rnmapbox/maps').default; Mapbox?.setAccessToken(TOKEN); }
  catch { /* The editor remains usable without the native map preview. */ }
}

type Place = { id: string; name: string; address: string; longitude: number; latitude: number };
type TripRow = { id: string; admin_id: string; status: string; origin: string; destination: string; origin_coords: [number, number]; destination_coords: [number, number]; route_geometry: any; estimated_distance_meters: number | null; estimated_duration_seconds: number | null };
type TripDay = { id: string; day_number: number; title: string | null; trip_date: string | null };

function placeFromPoint(point: RoutePoint): Place {
  return {
    id: point.provider_place_id || (point.id ? 'waypoint:' + point.id : 'draft:' + point.sequence),
    name: point.name, address: point.address || point.name,
    longitude: point.longitude, latitude: point.latitude,
  };
}

export default function RouteEditorScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const camera = useRef<any>(null);
  const [trip, setTrip] = useState<TripRow | null>(null);
  const [days, setDays] = useState<TripDay[]>([]);
  const [points, setPoints] = useState<RoutePoint[]>([]);
  const [routeGeometry, setRouteGeometry] = useState<any>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [calculatedSignature, setCalculatedSignature] = useState('');
  const [searchIndex, setSearchIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [routeNote, setRouteNote] = useState('');
  const isAdmin = !!user && trip?.admin_id === user.id;
  const signature = useMemo(() => JSON.stringify(points.map(p => [p.latitude,p.longitude,p.waypoint_type])), [points]);
  const routeIsCurrent = !!routeGeometry && calculatedSignature === signature;

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError('');
    try {
      const [tripResult, waypointResult, dayResult] = await Promise.all([
        supabase.from('rides').select('id,admin_id,status,origin,destination,origin_coords,destination_coords,route_geometry,estimated_distance_meters,estimated_duration_seconds').eq('id', id).single(),
        supabase.from('trip_waypoints').select('*').eq('ride_id', id).order('sequence'),
        supabase.from('trip_days').select('id,day_number,title,trip_date').eq('ride_id', id).order('day_number'),
      ]);
      if (tripResult.error) throw tripResult.error;
      if (waypointResult.error) throw waypointResult.error;
      if (dayResult.error) throw dayResult.error;
      const row = tripResult.data as TripRow;
      setTrip(row); setDays((dayResult.data || []) as TripDay[]);
      let loaded: RoutePoint[] = ((waypointResult.data || []) as any[]).map(p => ({
        id:p.id, sequence:p.sequence, waypoint_type:p.waypoint_type, name:p.name, address:p.address,
        latitude:Number(p.latitude), longitude:Number(p.longitude), provider_place_id:p.provider_place_id,
        notes:p.notes, is_optional:p.is_optional, trip_day_id:p.trip_day_id,
      }));
      if (loaded.length < 2) {
        const origin = Array.isArray(row.origin_coords) ? row.origin_coords : [77.5946,12.9716];
        const destination = Array.isArray(row.destination_coords) ? row.destination_coords : [78,13];
        loaded = [
          { id:null,sequence:0,waypoint_type:'origin',name:row.origin,address:row.origin,longitude:Number(origin[0]),latitude:Number(origin[1]) },
          { id:null,sequence:1,waypoint_type:'destination',name:row.destination,address:row.destination,longitude:Number(destination[0]),latitude:Number(destination[1]) },
        ];
      }
      loaded = loaded.map((p,i)=>({...p,sequence:i}));
      setPoints(loaded);
      setRouteGeometry(row.route_geometry || null);
      setDistance(row.estimated_distance_meters);
      setDuration(row.estimated_duration_seconds);
      setCalculatedSignature(row.route_geometry ? JSON.stringify(loaded.map(p=>[p.latitude,p.longitude,p.waypoint_type])) : '');
      setRouteNote(row.route_geometry ? 'Showing the saved route. Recalculate after changing any point.' : 'Calculate a route to preview road geometry and distance.');
    } catch (e:any) { setError(e?.message || 'Could not load route details.'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (searchIndex === null || query.length < 2 || !TOKEN) { setSuggestions([]); setSearchLoading(false); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const params = new URLSearchParams({ autocomplete:'true',fuzzyMatch:'true',limit:'6',country:'IN',language:'en',worldview:'in',types:'poi,address,place,locality,neighborhood,postcode,region',access_token:TOKEN });
        const url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/' + encodeURIComponent(query) + '.json?' + params.toString();
        const response = await fetch(url,{signal:controller.signal});
        if (!response.ok) throw new Error('Place search is unavailable right now.');
        const data = await response.json();
        if (controller.signal.aborted) return;
        setSuggestions((data.features || []).filter((f:any)=>Array.isArray(f.center) && f.center.length>=2).map((f:any)=>({
          id:String(f.id || f.place_name),name:f.text || f.place_name,address:f.place_name || f.text,
          longitude:Number(f.center[0]),latitude:Number(f.center[1]),
        })));
      } catch(e:any) { if(!controller.signal.aborted) setError(e?.message || 'Place search failed.'); }
      finally { if(!controller.signal.aborted) setSearchLoading(false); }
    },300);
    return () => { clearTimeout(timer); controller.abort(); };
  },[searchQuery,searchIndex]);

  useEffect(() => {
    const coords = routeGeometry?.geometry?.coordinates;
    if (!Mapbox || !coords || coords.length < 2 || !camera.current) return;
    const valid = coords.filter((p:any)=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1]));
    if (valid.length < 2) return;
    const east = Math.max(...valid.map((p:any)=>p[0])), west = Math.min(...valid.map((p:any)=>p[0]));
    const north = Math.max(...valid.map((p:any)=>p[1])), south = Math.min(...valid.map((p:any)=>p[1]));
    try { camera.current.fitBounds([east,north],[west,south],[35,35,35,35],500); } catch { /* Map may not be mounted yet. */ }
  },[routeGeometry]);

  function updatePoint(index:number, patch:Partial<RoutePoint>) {
    setPoints(current=>current.map((point,i)=>i===index?{...point,...patch}:point));
    setRouteGeometry(null); setCalculatedSignature(''); setRouteNote('Route changed. Recalculate to refresh the map and estimate.');
  }
  function searchPoint(index:number) {
    setSearchIndex(index); setSearchQuery(points[index]?.name || ''); setSuggestions([]);
  }
  function selectPlace(place:Place) {
    if (searchIndex===null) return;
    const point=points[searchIndex];
    updatePoint(searchIndex,{name:place.name,address:place.address,latitude:place.latitude,longitude:place.longitude,provider_place_id:place.id});
    setSearchIndex(null);setSearchQuery('');setSuggestions([]);
    if(point.waypoint_type==='origin' || point.waypoint_type==='destination') {
      setRouteNote('Endpoint updated. Recalculate the route before saving.');
    }
  }
  function addStop(type:RouteWaypointType='stop') {
    const destinationIndex=points.length-1;
    const newPoint:RoutePoint={id:null,sequence:destinationIndex,waypoint_type:type,name:'',address:'',latitude:0,longitude:0,provider_place_id:null,trip_day_id:null,day_number:null};
    setPoints(current=>[...current.slice(0,-1),newPoint,{...current[current.length-1],sequence:destinationIndex+1}]);
    setRouteGeometry(null);setCalculatedSignature('');
    setSearchIndex(destinationIndex);setSearchQuery('');setSuggestions([]);
  }
  function removeStop(index:number) {
    if(index===0||index===points.length-1)return;
    setPoints(current=>current.filter((_,i)=>i!==index).map((p,i)=>({...p,sequence:i})));
    setRouteGeometry(null);setCalculatedSignature('');
  }
  function moveStop(index:number,delta:number) {
    const target=index+delta;
    if(index<=0||index>=points.length-1||target<=0||target>=points.length-1)return;
    setPoints(current=>{const next=[...current];[next[index],next[target]]=[next[target],next[index]];return next.map((p,i)=>({...p,sequence:i}));});
    setRouteGeometry(null);setCalculatedSignature('');
  }

  function cyclePointDay(index:number) {
    const current=points[index].trip_day_id || null;
    const currentIndex=days.findIndex(day=>day.id===current);
    const next=currentIndex+1;
    setPoints(current=>current.map((point,i)=>i===index?{...point,trip_day_id:next>=days.length?null:days[next].id}:point));
  }

  async function calculateRoute() {
    const validation=validateRoutePoints(points);
    if(validation){Alert.alert('Check your route',validation);return;}
    if(!TOKEN){Alert.alert('Mapbox token required','Add EXPO_PUBLIC_MAPBOX_TOKEN to calculate and preview routes.');return;}
    setCalculating(true);setError('');
    try {
      const coords=routeCoordinates(points).map(pair=>pair.join(',')).join(';');
      const url='https://api.mapbox.com/directions/v5/mapbox/driving/'+coords+
        '?overview=full&geometries=geojson&steps=false&access_token='+encodeURIComponent(TOKEN);
      const response=await fetch(url);
      if(!response.ok)throw new Error('Could not calculate this route. Check your stops and try again.');
      const data=await response.json();
      if(data.code && data.code!=='Ok')throw new Error(data.message || 'No driving route found between these places.');
      const result=parseDirectionsRoute(data);
      const feature={type:'Feature',geometry:result.geometry,properties:{}};
      setRouteGeometry(feature);setDistance(result.distance);setDuration(result.duration);setCalculatedSignature(signature);
      setRouteNote('Route calculated using Mapbox driving directions. This is not a motorcycle-specific ETA.');
    } catch(e:any){setError(e?.message||'Route calculation failed.');}
    finally{setCalculating(false);}
  }

  async function saveRoute() {
    const validation=validateRoutePoints(points);
    if(validation){Alert.alert('Check your route',validation);return;}
    if(!routeIsCurrent){Alert.alert('Recalculate route','Calculate the route again after your latest changes before saving.');return;}
    setSaving(true);setError('');
    try {
      const origin=points[0],destination=points[points.length-1];
      const payload=points.map((p,sequence)=>({
        id:p.id || null,sequence,waypoint_type:p.waypoint_type,name:p.name.trim(),address:p.address || p.name,
        latitude:p.latitude,longitude:p.longitude,provider_place_id:p.provider_place_id || null,
        notes:p.notes || null,is_optional:!!p.is_optional,
        day_number:days.find(d=>d.id===p.trip_day_id)?.day_number ?? p.day_number ?? null,
      }));
      const {error:saveError}=await supabase.rpc('save_trip_route',{
        p_ride_id:id,
        p_trip:{
          origin:origin.address || origin.name,destination:destination.address || destination.name,
          origin_coords:[origin.longitude,origin.latitude],destination_coords:[destination.longitude,destination.latitude],
          route_geometry:routeGeometry,estimated_distance_meters:distance,estimated_duration_seconds:duration,
        },
        p_waypoints:payload,
      });
      if(saveError)throw saveError;
      Alert.alert('Route saved','The updated route and estimates are now shared with trip participants.',[{text:'Done',onPress:()=>router.back()}]);
    }catch(e:any){setError(e?.message||'Could not save route changes.');}
    finally{setSaving(false);}
  }

  const mapPoints=useMemo(()=>({
    type:'FeatureCollection' as const,
    features:points.filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&p.name.trim()).map((p,i)=>({
      type:'Feature' as const,geometry:{type:'Point' as const,coordinates:[p.longitude,p.latitude]},
      properties:{label:String(i+1),kind:p.waypoint_type},
    })),
  }),[points]);

  if(loading)return <View style={styles.center}><ActivityIndicator color={theme.accent}/><Text style={styles.muted}>Loading route…</Text></View>;
  if(!trip)return <View style={styles.center}><Text style={styles.title}>Route unavailable</Text><Text style={styles.muted}>{error||'Trip not found.'}</Text></View>;
  if(!isAdmin)return <View style={styles.center}><Text style={styles.title}>Route is read-only</Text><Text style={styles.muted}>Only the trip leader can edit this route.</Text><TouchableOpacity style={styles.secondary} onPress={()=>router.back()}><Text style={styles.secondaryText}>Go back</Text></TouchableOpacity></View>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>ROUTE WORKSHOP · {trip.status.toUpperCase()}</Text>
      <Text style={styles.title}>Shape the journey.</Text>
      <Text style={styles.muted}>Edit the origin, destination and every stop. Changes are saved as one shared route.</Text>
      <View style={styles.mapCard}>
        {Mapbox && routeGeometry ? <Mapbox.MapView style={styles.map} styleURL={theme.background==='#14221D'?'mapbox://styles/mapbox/dark-v11':'mapbox://styles/mapbox/outdoors-v12'} logoEnabled={false} attributionEnabled={true}>
          <Mapbox.Camera ref={camera} defaultSettings={{centerCoordinate:routeGeometry.geometry.coordinates[0],zoomLevel:8}}/>
          <Mapbox.ShapeSource id="route-preview-line" shape={routeGeometry}><Mapbox.LineLayer id="route-preview-casing" style={{lineColor:'#FFFFFF',lineWidth:8,lineCap:'round',lineJoin:'round'}}/><Mapbox.LineLayer id="route-preview" style={{lineColor:theme.accent,lineWidth:4,lineCap:'round',lineJoin:'round'}}/></Mapbox.ShapeSource>
          <Mapbox.ShapeSource id="route-preview-points" shape={mapPoints}><Mapbox.CircleLayer id="route-preview-point-circles" style={{circleRadius:6,circleColor:theme.green,circleStrokeColor:'#FFFFFF',circleStrokeWidth:2}}/></Mapbox.ShapeSource>
        </Mapbox.MapView>:<View style={styles.mapFallback}><Text style={styles.mapFallbackTitle}>Route preview</Text><Text style={styles.muted}>{TOKEN?'Calculate a route to display it here.':'Configure a Mapbox token to enable map and place search.'}</Text></View>}
        <View style={styles.metrics}>
          <View><Text style={styles.metricValue}>{formatRouteDistance(distance)}</Text><Text style={styles.metricLabel}>DISTANCE</Text></View>
          <View><Text style={styles.metricValue}>{formatRouteDuration(duration)}</Text><Text style={styles.metricLabel}>DRIVING ESTIMATE</Text></View>
          <View><Text style={styles.metricValue}>{points.length}</Text><Text style={styles.metricLabel}>ROUTE POINTS</Text></View>
        </View>
        <Text style={styles.note}>{routeNote}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Route stops</Text>
        <Text style={styles.mutedSmall}>Tap a place name to search and replace it. Use the arrows to reorder intermediate stops.</Text>
        {points.map((point,index)=>(
          <View key={point.id || 'new-'+index} style={styles.point}>
            <View style={styles.marker}><Text style={styles.markerText}>{index+1}</Text></View>
            <View style={{flex:1}}>
              <Text style={styles.pointType}>{point.waypoint_type.toUpperCase()}{index===0?' · START':index===points.length-1?' · FINISH':''}</Text>
              <TouchableOpacity style={styles.placeButton} onPress={()=>searchPoint(index)}>
                <Text style={point.name?styles.placeName:styles.placePlaceholder}>{point.name||'Search and select a place'}</Text>
                <Text style={styles.changeText}>Change ↗</Text>
              </TouchableOpacity>
              {!!point.address&&<Text style={styles.mutedSmall}>{point.address}</Text>}
              {days.length>0&&<TouchableOpacity style={styles.dayButton} onPress={()=>cyclePointDay(index)}>
                <Text style={styles.dayButtonText}>{days.find(day=>day.id===point.trip_day_id)?.title || (point.trip_day_id?'Assigned day':'Unassigned')} · change day</Text>
              </TouchableOpacity>}
              {index>0&&index<points.length-1&&<View style={styles.editorRow}>
                <TouchableOpacity style={styles.smallButton} disabled={index===1} onPress={()=>moveStop(index,-1)}><Text style={styles.smallButtonText}>↑ Move up</Text></TouchableOpacity>
                <TouchableOpacity style={styles.smallButton} disabled={index===points.length-2} onPress={()=>moveStop(index,1)}><Text style={styles.smallButtonText}>↓ Move down</Text></TouchableOpacity>
                <TouchableOpacity style={styles.removeButton} onPress={()=>removeStop(index)}><Text style={styles.removeText}>Remove</Text></TouchableOpacity>
              </View>}
            </View>
          </View>
        ))}
        <View style={styles.editorRow}>
          <TouchableOpacity style={styles.addButton} onPress={()=>addStop('stop')}><Text style={styles.addText}>＋ Add stop</Text></TouchableOpacity>
          <TouchableOpacity style={styles.addButton} onPress={()=>addStop('fuel')}><Text style={styles.addText}>＋ Fuel stop</Text></TouchableOpacity>
          <TouchableOpacity style={styles.addButton} onPress={()=>addStop('food')}><Text style={styles.addText}>＋ Food stop</Text></TouchableOpacity>
        </View>
      </View>

      {searchIndex!==null&&<View style={styles.card}>
        <Text style={styles.section}>Find a place</Text>
        <TextInput style={styles.input} value={searchQuery} onChangeText={setSearchQuery} placeholder="Search a town, landmark or address" placeholderTextColor={theme.subtle} autoCorrect={false} autoCapitalize="words"/>
        {searchLoading&&<ActivityIndicator color={theme.accent} style={{marginTop:10}}/>}
        {suggestions.map(place=><TouchableOpacity key={place.id} style={styles.suggestion} onPress={()=>selectPlace(place)}>
          <Text style={styles.placeName}>{place.name}</Text><Text style={styles.mutedSmall}>{place.address}</Text>
        </TouchableOpacity>)}
        <TouchableOpacity style={styles.secondary} onPress={()=>{setSearchIndex(null);setSearchQuery('');setSuggestions([]);}}><Text style={styles.secondaryText}>Close search</Text></TouchableOpacity>
        {!TOKEN&&<Text style={styles.note}>Mapbox token is required for place search.</Text>}
      </View>}

      <TouchableOpacity style={styles.calculateButton} disabled={calculating||saving} onPress={()=>void calculateRoute()}>
        {calculating?<ActivityIndicator color="#FFFFFF"/>:<Text style={styles.calculateText}>↻ Recalculate route</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={[styles.saveButton,!routeIsCurrent&&styles.saveDisabled]} disabled={saving||!routeIsCurrent} onPress={()=>void saveRoute()}>
        <Text style={styles.saveText}>{saving?'Saving route…':routeIsCurrent?'Save shared route':'Calculate route before saving'}</Text>
      </TouchableOpacity>
      {!!error&&<Text style={styles.error}>{error}</Text>}
      <Text style={styles.footer}>Mapbox driving directions provide a road-route estimate. Actual motorcycle travel time depends on riding pace, traffic, weather, road conditions and breaks. Offline route calculation is not available.</Text>
    </ScrollView>
  );
}

const makeStyles=(c:RidePalette)=>StyleSheet.create({
  container:{flex:1,backgroundColor:c.background},content:{padding:18,paddingBottom:42},
  center:{flex:1,backgroundColor:c.background,alignItems:'center',justifyContent:'center',padding:24,gap:12},
  eyebrow:{color:c.accent,fontSize:10,fontWeight:'800',letterSpacing:1.4},title:{color:c.text,fontSize:30,fontWeight:'900',marginTop:8},
  muted:{color:c.muted,fontSize:13,lineHeight:19,marginTop:6},mutedSmall:{color:c.muted,fontSize:11,lineHeight:16,marginTop:4},
  card:{backgroundColor:c.surface,borderColor:c.border,borderWidth:1,borderRadius:14,padding:15,marginTop:14},
  section:{color:c.text,fontSize:17,fontWeight:'800',marginBottom:9},mapCard:{backgroundColor:c.surface,borderColor:c.border,borderWidth:1,borderRadius:14,overflow:'hidden',marginTop:16},
  map:{height:245,width:'100%'},mapFallback:{height:180,backgroundColor:c.surfaceRaised,alignItems:'center',justifyContent:'center',padding:22},
  mapFallbackTitle:{color:c.text,fontSize:16,fontWeight:'800'},metrics:{flexDirection:'row',justifyContent:'space-around',padding:14,borderTopWidth:1,borderTopColor:c.border},
  metricValue:{color:c.text,fontSize:17,fontWeight:'900'},metricLabel:{color:c.muted,fontSize:9,fontWeight:'800',marginTop:3},
  note:{color:c.accent,fontSize:10,lineHeight:15,paddingHorizontal:14,paddingBottom:12},
  point:{flexDirection:'row',gap:10,alignItems:'flex-start',paddingVertical:12,borderTopWidth:1,borderTopColor:c.border},
  marker:{width:26,height:26,borderRadius:13,backgroundColor:c.accentSoft,alignItems:'center',justifyContent:'center'},
  markerText:{color:c.accent,fontSize:11,fontWeight:'900'},pointType:{color:c.accent,fontSize:9,fontWeight:'900'},
  placeButton:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,paddingVertical:6},
  placeName:{color:c.text,fontSize:14,fontWeight:'700',flex:1},placePlaceholder:{color:c.subtle,fontSize:14,flex:1},
  changeText:{color:c.accent,fontSize:11,fontWeight:'800'},editorRow:{flexDirection:'row',flexWrap:'wrap',gap:7,marginTop:9},
  smallButton:{borderWidth:1,borderColor:c.border,borderRadius:8,paddingHorizontal:10,paddingVertical:7},
  smallButtonText:{color:c.accent,fontSize:10,fontWeight:'800'},dayButton:{alignSelf:'flex-start',marginTop:7,paddingVertical:5},dayButtonText:{color:c.muted,fontSize:10,fontWeight:'700'},removeButton:{paddingHorizontal:9,paddingVertical:7},removeText:{color:c.danger,fontSize:10,fontWeight:'800'},
  addButton:{backgroundColor:c.greenSoft,borderRadius:9,paddingHorizontal:10,paddingVertical:10},addText:{color:c.green,fontSize:11,fontWeight:'800'},
  input:{backgroundColor:c.background,borderWidth:1,borderColor:c.border,borderRadius:9,padding:12,color:c.text,fontSize:14,marginTop:5},
  suggestion:{paddingVertical:12,borderBottomWidth:1,borderBottomColor:c.border},
  calculateButton:{backgroundColor:c.green,borderRadius:12,padding:15,alignItems:'center',marginTop:16},
  calculateText:{color:'#FFFFFF',fontSize:14,fontWeight:'900'},saveButton:{backgroundColor:c.accent,borderRadius:12,padding:16,alignItems:'center',marginTop:9},
  saveDisabled:{opacity:0.45},saveText:{color:'#FFFFFF',fontSize:14,fontWeight:'900'},
  secondary:{borderWidth:1,borderColor:c.border,borderRadius:10,padding:12,alignItems:'center',marginTop:12},
  secondaryText:{color:c.text,fontWeight:'800'},error:{color:c.danger,fontSize:12,marginTop:12},
  footer:{color:c.subtle,fontSize:10,lineHeight:16,textAlign:'center',marginTop:18},
});
