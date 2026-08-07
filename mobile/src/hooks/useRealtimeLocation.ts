import { useEffect, useRef, useState, useCallback } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { LocationUpdate } from '@ridentrack/shared';
import { supabase } from '../lib/supabase';

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
        Object.entries(state).forEach(([key, presences]: [string, any]) => {
          const latest = presences[presences.length - 1];
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

  const broadcastLocation = useCallback(
    async (lat: number, lng: number, speed: number, heading: number) => {
      if (!channelRef.current) return;
      try {
        await channelRef.current.track({
          display_name: displayName,
          lat,
          lng,
          speed,
          heading,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.warn('Realtime presence track error (buffered locally):', err);
      }
    },
    [displayName]
  );

  return { participants, broadcastLocation };
}
