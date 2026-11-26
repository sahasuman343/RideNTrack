'use client';
import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MAPBOX_TOKEN } from '@/lib/planner';

export interface TripMapPoint { name: string; type: string; longitude: number; latitude: number }
interface Props {
  points: TripMapPoint[];
  route?: { type: 'LineString'; coordinates: number[][] } | null;
  className?: string;
}

function markerLabel(point: TripMapPoint, index: number) {
  if (point.type === 'origin') return 'A';
  if (point.type === 'destination') return 'B';
  return String(index);
}

/** A route map for planning: numbered stops and the driving line. */
export default function TripMap({ points, route, className }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!container.current || !MAPBOX_TOKEN) return;
    let instance: mapboxgl.Map;
    try {
      instance = new mapboxgl.Map({ container: container.current, accessToken: MAPBOX_TOKEN, style: 'mapbox://styles/mapbox/dark-v11', center: [78.96, 22.59], zoom: 3.6, attributionControl: false });
    } catch {
      queueMicrotask(() => setError('This browser could not start the map. Your plan is still saved.'));
      return;
    }
    map.current = instance;
    instance.addControl(new mapboxgl.NavigationControl(), 'top-right');
    instance.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    instance.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    instance.on('load', () => setReady(true));
    instance.on('error', () => setError('Map tiles could not load right now.'));
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(container.current);
    return () => { resize.disconnect(); instance.remove(); map.current = null; setReady(false); };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    markers.current.forEach(m => m.remove());
    markers.current = points.map((point, index) => {
      const el = document.createElement('div');
      el.className = 'trip-marker trip-marker-' + (point.type === 'origin' || point.type === 'destination' ? 'end' : 'stop');
      el.textContent = markerLabel(point, index);
      el.setAttribute('aria-label', point.name);
      return new mapboxgl.Marker({ element: el }).setLngLat([point.longitude, point.latitude]).setPopup(new mapboxgl.Popup({ offset: 14 }).setText(point.name)).addTo(instance);
    });
    const data: GeoJSON.Feature = { type: 'Feature', properties: {}, geometry: route ?? { type: 'LineString', coordinates: [] } };
    const source = instance.getSource('trip-route') as mapboxgl.GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      instance.addSource('trip-route', { type: 'geojson', data });
      instance.addLayer({ id: 'trip-route-outline', type: 'line', source: 'trip-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#060607', 'line-width': 9 } });
      instance.addLayer({ id: 'trip-route-line', type: 'line', source: 'trip-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff8a2a', 'line-width': 4 } });
    }
    const coords: [number, number][] = route?.coordinates?.length ? route.coordinates.map(c => [c[0], c[1]]) : points.map(p => [p.longitude, p.latitude]);
    if (coords.length === 1) instance.easeTo({ center: coords[0], zoom: 9, duration: 0 });
    else if (coords.length > 1) {
      const bounds = coords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]));
      instance.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 0 });
    }
  }, [ready, points, route]);

  if (!MAPBOX_TOKEN) return <div className={'flex items-center justify-center rounded-lg border border-line bg-map text-sm text-muted ' + (className ?? '')}>Map preview needs a Mapbox token.</div>;
  return (
    <div className={'relative overflow-hidden rounded-lg border border-line bg-map ' + (className ?? '')}>
      <div className="absolute inset-0"><div ref={container} className="trip-map-canvas h-full w-full" aria-label="Trip route map" role="region" /></div>
      {error && <p role="status" className="absolute left-3 top-3 notice px-3 py-2 text-xs">{error}</p>}
    </div>
  );
}
