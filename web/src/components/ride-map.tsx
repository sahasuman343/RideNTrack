'use client';
import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { type Ride, type LocationUpdate, isStale } from '@ridentrack/shared';
interface Props { ride: Ride; riders: LocationUpdate[]; selected: string | null; fitRequest: number; onSelect: (id: string | null) => void }
export default function RideMap({ ride,riders,selected,fitRequest,onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef(new Map<string,{ marker: mapboxgl.Marker; element: HTMLButtonElement }>());
  const latest = useRef({ ride,riders,selected,onSelect });
  const [ready,setReady] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [retry,setRetry] = useState(0);
  useEffect(() => { latest.current = { ride,riders,selected,onSelect }; }, [ride,riders,selected,onSelect]);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  useEffect(() => {
    if (!container.current || !token) return;
    let instance: mapboxgl.Map;
    let disposed = false;
    try {
      instance = new mapboxgl.Map({ container: container.current,accessToken: token,
        style: 'mapbox://styles/mapbox/streets-v12',center: latest.current.ride.origin_coords,zoom: 10,attributionControl: false });
    } catch {
      queueMicrotask(() => { if (!disposed) setError('This device could not start the map. Your rider list is still available.'); });
      return () => { disposed = true; };
    }
    map.current = instance;
    instance.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }),'top-right');
    instance.addControl(new mapboxgl.AttributionControl({ compact: true }),'bottom-right');
    instance.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }),'bottom-left');
    instance.on('dragstart',() => latest.current.onSelect(null));
    instance.on('error',() => setError('Map tiles could not load. Rider updates are still available.'));
    instance.on('load',() => {
      setReady(true); setError(null);
      const data = latest.current.ride;
      instance.fitBounds(new mapboxgl.LngLatBounds(data.origin_coords,data.origin_coords).extend(data.destination_coords), { padding: 80,maxZoom: 14,duration: 0 });
      [data.origin_coords,data.destination_coords].forEach((coordinates,i) => {
        const el = document.createElement('div'); el.className = 'endpoint-marker'; el.textContent = i === 0 ? 'A' : 'B';
        new mapboxgl.Marker({ element: el }).setLngLat(coordinates).setPopup(new mapboxgl.Popup().setText(i === 0 ? data.origin : data.destination)).addTo(instance);
      });
    });
    const resize = new ResizeObserver(() => instance.resize()); resize.observe(container.current);
    const currentMarkers = markers.current;
    return () => { disposed = true; resize.disconnect(); currentMarkers.forEach(p => p.marker.remove()); currentMarkers.clear(); instance.remove(); map.current = null; };
  }, [token,retry]);
  useEffect(() => {
    if (!ready || !map.current || !ride.route_geometry) return;
    const instance = map.current;
    const source = instance.getSource('route') as mapboxgl.GeoJSONSource | undefined;
    if (source) source.setData(ride.route_geometry);
    else {
      instance.addSource('route',{ type: 'geojson',data: ride.route_geometry });
      instance.addLayer({ id: 'route-outline',type: 'line',source: 'route',layout: { 'line-cap':'round','line-join':'round' },paint: { 'line-color':'#fff','line-width':9 } });
      instance.addLayer({ id: 'route-line',type: 'line',source: 'route',layout: { 'line-cap':'round','line-join':'round' },paint: { 'line-color':'#e57239','line-width':4 } });
    }
  }, [ready,ride.route_geometry]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    const ids = new Set(riders.map(p => p.user_id));
    for (const [id,entry] of markers.current) if (!ids.has(id)) { entry.marker.remove(); markers.current.delete(id); }
    const moves: { marker: mapboxgl.Marker; from: mapboxgl.LngLat; to: LocationUpdate }[] = [];
    for (const rider of riders) {
      let entry = markers.current.get(rider.user_id);
      if (!entry) {
        const element = document.createElement('button'); element.type = 'button';
        element.addEventListener('click',() => latest.current.onSelect(rider.user_id));
        const marker = new mapboxgl.Marker({ element }).setLngLat([rider.lng,rider.lat]).addTo(instance);
        entry = { marker,element }; markers.current.set(rider.user_id,entry);
      }
      entry.element.className = 'rider-marker ' + (isStale(rider.timestamp) ? 'is-stale ' : '') + (selected === rider.user_id ? 'is-selected' : '');
      entry.element.textContent = rider.display_name.slice(0,2).toUpperCase();
      entry.element.setAttribute('aria-label','Follow ' + rider.display_name + (isStale(rider.timestamp) ? ', last known location' : ''));
      entry.element.title = rider.display_name;
      moves.push({ marker: entry.marker,from: entry.marker.getLngLat(),to: rider });
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0; const start = performance.now();
    const animate = (time: number) => {
      const t = reduced ? 1 : Math.min((time-start)/1000,1), eased = t*(2-t);
      for (const { marker,from,to } of moves) {
        const delta = ((to.lng-from.lng+540)%360)-180;
        marker.setLngLat([from.lng+delta*eased,from.lat+(to.lat-from.lat)*eased]);
      }
      if (t < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    const focus = riders.find(p => p.user_id === selected);
    if (focus) instance.easeTo({ center:[focus.lng,focus.lat],zoom:Math.max(instance.getZoom(),13),duration:reduced ? 0 : 1000 });
    return () => cancelAnimationFrame(frame);
  }, [riders,ready,selected]);
  useEffect(() => {
    if (!ready || !map.current || fitRequest === 0) return;
    const { ride,riders } = latest.current;
    const coords = riders.length ? riders.map(p => [p.lng,p.lat] as [number,number]) : [ride.origin_coords,ride.destination_coords];
    const bounds = new mapboxgl.LngLatBounds(coords[0],coords[0]); coords.forEach(p => bounds.extend(p));
    map.current.fitBounds(bounds,{ padding:90,maxZoom:15,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 800 });
  }, [fitRequest,ready]);
  return <div className="map-stage"><div ref={container} className="map-canvas" aria-label="Live group ride map" />
    {!token ? <div className="map-message"><span className="map-message-icon">◎</span><h2>The map is almost ready</h2><p>Add your Mapbox token to display roads and rider positions.</p></div>
      : error ? <div className="map-error" role="alert">{error}<button onClick={() => { setReady(false); setError(null); setRetry(v => v+1); }}>Reload map</button></div>
      : !ready && <div className="map-message"><span className="loader" /><p>Finding your group on the map…</p></div>}
  </div>;
}
