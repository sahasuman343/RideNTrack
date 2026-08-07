'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { LocationUpdate, Ride, Alert, ALERT_LABELS } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

export default function RideViewPage() {
  const searchParams = useSearchParams();
  const rideId = searchParams.get('id');
  const router = useRouter();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<Map<string, mapboxgl.Marker>>(new Map());

  const [ride, setRide] = useState<Ride | null>(null);
  const [participants, setParticipants] = useState<LocationUpdate[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    if (!rideId) {
      router.push('/dashboard');
      return;
    }
    fetchRide();
    setupRealtime();
    setupAlerts();
  }, [rideId]);

  async function fetchRide() {
    const { data } = await supabase.from('rides').select('*').eq('id', rideId).single();
    if (data) {
      setRide(data as Ride);
      initMap(data as Ride);
    }
  }

  function initMap(rideData: Ride) {
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
        const updated: LocationUpdate[] = [];
        Object.entries(state).forEach(([key, presences]: [string, any]) => {
          const latest = presences[presences.length - 1];
          if (latest?.lat && latest?.lng) {
            const update: LocationUpdate = {
              user_id: key,
              display_name: latest.display_name || 'Unknown',
              lat: latest.lat,
              lng: latest.lng,
              speed: latest.speed || 0,
              heading: latest.heading || 0,
              timestamp: latest.timestamp || new Date().toISOString(),
            };
            updated.push(update);

            // Update map marker
            if (map.current) {
              const existing = markers.current.get(key);
              if (existing) {
                existing.setLngLat([latest.lng, latest.lat]);
              } else {
                const el = document.createElement('div');
                el.className = 'rider-marker';
                el.style.cssText =
                  'width:28px;height:28px;border-radius:50%;background:#FF6B00;border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:bold;box-shadow:0 0 10px rgba(255,107,0,0.5);';
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

    return () => {
      channel.unsubscribe();
    };
  }

  function setupAlerts() {
    if (!rideId) return;

    const channel = supabase.channel(`alerts:${rideId}`);
    channel
      .on('broadcast', { event: 'alert' }, (payload: { payload: Alert }) => {
        const alert = payload.payload;
        setActiveAlerts((prev: Alert[]) => [alert, ...prev]);
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e] flex flex-col md:flex-row">
      {/* Participant sidebar */}
      <div className="w-full md:w-72 bg-[#16213e] border-r border-[#0f3460] p-4 flex flex-col z-10">
        <a href="/dashboard" className="text-gray-400 hover:text-[#FF6B00] text-sm mb-4">
          &larr; Back to Dashboard
        </a>

        {/* Live Alerts Banner */}
        {activeAlerts.length > 0 && (
          <div className="mb-4 space-y-2">
            <h3 className="text-red-400 font-bold text-xs uppercase tracking-wider">Active Alerts</h3>
            {activeAlerts.slice(0, 3).map((a: Alert) => (
              <div
                key={a.id}
                className="bg-red-950/80 border border-red-500/50 rounded-lg p-2.5 text-xs text-red-200"
              >
                <span className="font-bold">{ALERT_LABELS[a.type] || a.type}</span>
                <span className="text-gray-400 block text-[11px]">from {a.display_name}</span>
                {a.message && <p className="mt-1 text-white">{a.message}</p>}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[#FF6B00] font-bold text-sm uppercase tracking-wide">
            Live Riders ({participants.length})
          </h2>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Sync Active
          </span>
        </div>

        <div className="space-y-2 flex-1 overflow-y-auto max-h-[40vh] md:max-h-none">
          {participants.map((p: LocationUpdate) => (
            <div key={p.user_id} className="flex items-center gap-2.5 bg-[#0f3460] rounded-lg p-2.5">
              <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{p.display_name}</p>
                <p className="text-gray-400 text-xs">
                  {Math.round((p.speed || 0) * 3.6)} km/h • {Math.round(p.heading || 0)}°
                </p>
              </div>
            </div>
          ))}
          {participants.length === 0 && (
            <p className="text-gray-500 text-sm py-4 text-center">No active riders online</p>
          )}
        </div>

        {/* Ride info */}
        {ride && (
          <div className="mt-4 pt-4 border-t border-[#0f3460]">
            <h3 className="text-white font-semibold text-sm">{ride.name}</h3>
            <p className="text-gray-400 text-xs mt-1">
              {ride.origin} → {ride.destination}
            </p>
            <p className="text-[#FF6B00] text-xs mt-1 font-mono">Code: {ride.ride_code}</p>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 relative min-h-[60vh] md:min-h-screen">
        <div ref={mapContainer} className="absolute inset-0" />
      </div>
    </div>
  );
}
