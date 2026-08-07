import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
interface LocationUpdate {
  user_id: string;
  display_name: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  timestamp: string;
}
import { RealtimeChannel } from '@supabase/supabase-js';

export function useRealtimeLocation(rideId: string, userId: string, displayName: string) {
  const [participants, setParticipants] = useState<Map<string, LocationUpdate>>(new Map());
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!rideId) return;

    const channel = supabase.channel(`ride:${rideId}`, {
      config: { presence: { key: userId } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const updated = new Map<string, LocationUpdate>();
        Object.entries(state).forEach(([key, presences]) => {
          const latest = presences[presences.length - 1] as any;
          if (latest?.lat && latest?.lng) {
            updated.set(key, {
              user_id: key,
              display_name: latest.display_name || 'Unknown',
              lat: latest.lat,
              lng: latest.lng,
              speed: latest.speed || 0,
              heading: latest.heading || 0,
              timestamp: latest.timestamp || new Date().toISOString(),
            });
          }
        });
        setParticipants(updated);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [rideId, userId]);

  const broadcastLocation = async (lat: number, lng: number, speed: number, heading: number) => {
    if (!channelRef.current) return;
    await channelRef.current.track({
      display_name: displayName,
      lat,
      lng,
      speed,
      heading,
      timestamp: new Date().toISOString(),
    });
  };

  return { participants, broadcastLocation };
}
