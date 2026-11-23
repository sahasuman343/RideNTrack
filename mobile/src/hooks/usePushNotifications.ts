import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useAuth } from './useAuth';
import { configureNotifications, registerPushToken, rideIdFromNotification } from '../services/pushNotifications';

configureNotifications();

/** Keeps this device's push token current and opens the ride from a tapped alert. */
export function usePushNotifications() {
  const { user } = useAuth();
  const router = useRouter();
  const userId = user?.id;
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    void registerPushToken(userId, { prompt: false }).catch(e => console.warn('Push registration failed:', e));
  }, [userId]);

  useEffect(() => {
    if (!userId || !response) return;
    const key = response.notification.request.identifier;
    if (handled.current === key) return;
    handled.current = key;
    const rideId = rideIdFromNotification(response);
    if (rideId) router.push(`/ride/${rideId}`);
  }, [response, userId, router]);
}
