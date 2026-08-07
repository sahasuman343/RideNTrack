'use client';

import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/lib/supabase';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

interface Participant {
  user_id: string;
  display_name: string;
  lat: number;
  lng: number;
  speed: number;
}

export default function RideViewPage() {
  const searchParams = useSearchParams();
  const rideId = searchParams.get('id');
  const router = useRouter();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<Map<string, mapboxgl.Marker>>(new Map());

  const [ride, setRide] = useState<any>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);

  useEffect(() => {
    if (!rideId) { router.push('/dashboard'); return; }
    fetchRide();
    setupRealtime();
  }, [rideId]);

  async function fetchRide() {
    const { data } = await supabase.from('rides').select('*').eq('id', rideId).single();
    if (data) {
      setRide(data);
      initMap(data);
    }
  }

  function initMap(rideData: any) {
    if (!mapContainer.current || map.current) return;

    const center = rideData.origin_coords || [78.9629, 20.5937];
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: center,
      zoom: 8,
    });

    map.current.on('load', () => {
      // Add origin marker
      if (rideData.origin_coords) {
        new mapboxgl.Marker({ color: '#4CAF50' })
          .setLngLat(rideData.origin_coords)
          .setPopup(new mapboxgl.Popup().setText(rideData.origin))
          .addTo(map.current!);
      }
      // Add destination marker
      if (rideData.destination_coords) {
        new mapboxgl.Marker({ color: '#e74c3c' })
          .setLngLat(rideData.destination_coords)
          .setPopup(new mapboxgl.Popup().setText(rideData.destination))
          .addTo(map.current!);
      }
      // Add route
      if (rideData.route_geometry) {
        map.current!.addSource('route', { type: 'geojson', data: rideData.route_geometry });
        map.current!.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          paint: { 'line-color': '#FF6B00', 'line-width': 4, 'line-opacity': 0.8 },
        });
      }

      // Fit bounds
      if (rideData.origin_coords && rideData.destination_coords) {
        const bounds = new mapboxgl.LngLatBounds()
          .extend(rideData.origin_coords)
          .extend(rideData.destination_coords);
        map.current!.fitBounds(bounds, { padding: 60 });
      }
    });
  }

  function setupRealtime() {
    if (!rideId) return;

    const channel = supabase.channel(`ride:${rideId}`, {
      config: { presence: { key: 'viewer' } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const updated: Participant[] = [];
        Object.entries(state).forEach(([key, presences]) => {
          const latest = presences[presences.length - 1] as any;
          if (latest?.lat && latest?.lng) {
            updated.push({
              user_id: key,
              display_name: latest.display_name || 'Unknown',
              lat: latest.lat,
              lng: latest.lng,
              speed: latest.speed || 0,
            });

            // Update map marker
            if (map.current) {
              const existing = markers.current.get(key);
              if (existing) {
                existing.setLngLat([latest.lng, latest.lat]);
              } else {
                const el = document.createElement('div');
                el.className = 'rider-marker';
                el.style.cssText = 'width:28px;height:28px;border-radius:50%;background:#FF6B00;border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:bold;';
                el.textContent = (latest.display_name || '?')[0].toUpperCase();

                const marker = new mapboxgl.Marker({ element: el })
                  .setLngLat([latest.lng, latest.lat])
                  .setPopup(new mapboxgl.Popup().setText(latest.display_name))
                  .addTo(map.current!);
                markers.current.set(key, marker);
              }
            }
          }
        });
        setParticipants(updated);
      })
      .subscribe();

    return () => { channel.unsubscribe(); };
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e] flex">
      {/* Participant sidebar */}
      <div className="w-64 bg-[#16213e] border-r border-[#0f3460] p-4 flex flex-col">
        <a href="/dashboard" className="text-gray-400 hover:text-[#FF6B00] text-sm mb-4">&larr; Back to Dashboard</a>
        <h2 className="text-[#FF6B00] font-bold text-sm uppercase tracking-wide mb-3">
          Riders ({participants.length})
        </h2>
        <div className="space-y-2 flex-1 overflow-y-auto">
          {participants.map((p) => (
            <div key={p.user_id} className="flex items-center gap-2 bg-[#0f3460] rounded-lg p-2">
              <div className="w-3 h-3 rounded-full bg-green-400" />
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm truncate">{p.display_name}</p>
                <p className="text-gray-400 text-xs">{Math.round((p.speed || 0) * 3.6)} km/h</p>
              </div>
            </div>
          ))}
          {participants.length === 0 && (
            <p className="text-gray-500 text-sm">No active riders</p>
          )}
        </div>

        {/* Ride info */}
        {ride && (
          <div className="mt-4 pt-4 border-t border-[#0f3460]">
            <h3 className="text-white font-semibold text-sm">{ride.name}</h3>
            <p className="text-gray-400 text-xs mt-1">{ride.origin} → {ride.destination}</p>
            <p className="text-[#FF6B00] text-xs mt-1 font-mono">Code: {ride.ride_code}</p>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <div ref={mapContainer} className="absolute inset-0" />
      </div>
    </div>
  );
}
