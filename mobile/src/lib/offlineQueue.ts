import AsyncStorage from '@react-native-async-storage/async-storage';
import { BufferedLocation, BufferedAlert } from '@ridentrack/shared';

const LOCATION_QUEUE_KEY = '@ridentrack/location_queue';
const ALERT_QUEUE_KEY = '@ridentrack/alert_queue';
const MAX_QUEUE_SIZE = 2000; // Keep up to ~2-3 hours of 5-second interval breadcrumbs

export async function enqueueLocation(location: BufferedLocation): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(LOCATION_QUEUE_KEY);
    const list: BufferedLocation[] = raw ? JSON.parse(raw) : [];

    list.push(location);

    // If exceeding max size, drop oldest non-critical items to protect disk space
    if (list.length > MAX_QUEUE_SIZE) {
      list.splice(0, list.length - MAX_QUEUE_SIZE);
    }

    await AsyncStorage.setItem(LOCATION_QUEUE_KEY, JSON.stringify(list));
  } catch (error) {
    console.error('Failed to enqueue location to offline storage:', error);
  }
}

export async function getQueuedLocations(limit = 100): Promise<BufferedLocation[]> {
  try {
    const raw = await AsyncStorage.getItem(LOCATION_QUEUE_KEY);
    if (!raw) return [];
    const list: BufferedLocation[] = JSON.parse(raw);
    return list.slice(0, limit);
  } catch (error) {
    console.error('Failed to read queued locations:', error);
    return [];
  }
}

export async function clearQueuedLocations(timestamps: string[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(LOCATION_QUEUE_KEY);
    if (!raw) return;
    const list: BufferedLocation[] = JSON.parse(raw);
    const timestampSet = new Set(timestamps);
    const remaining = list.filter((item) => !timestampSet.has(item.timestamp));
    await AsyncStorage.setItem(LOCATION_QUEUE_KEY, JSON.stringify(remaining));
  } catch (error) {
    console.error('Failed to clear queued locations:', error);
  }
}

export async function getQueuedLocationsCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(LOCATION_QUEUE_KEY);
    if (!raw) return 0;
    const list: BufferedLocation[] = JSON.parse(raw);
    return list.length;
  } catch {
    return 0;
  }
}

export async function enqueueAlert(alert: BufferedAlert): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(ALERT_QUEUE_KEY);
    const list: BufferedAlert[] = raw ? JSON.parse(raw) : [];
    list.push(alert);
    await AsyncStorage.setItem(ALERT_QUEUE_KEY, JSON.stringify(list));
  } catch (error) {
    console.error('Failed to enqueue alert:', error);
  }
}

export async function getQueuedAlerts(): Promise<BufferedAlert[]> {
  try {
    const raw = await AsyncStorage.getItem(ALERT_QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to get queued alerts:', error);
    return [];
  }
}

export async function getQueuedAlertsCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(ALERT_QUEUE_KEY);
    if (!raw) return 0;
    const list: BufferedAlert[] = JSON.parse(raw);
    return list.length;
  } catch {
    return 0;
  }
}

export async function clearQueuedAlert(alertId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(ALERT_QUEUE_KEY);
    if (!raw) return;
    const list: BufferedAlert[] = JSON.parse(raw);
    const remaining = list.filter((a) => a.id !== alertId);
    await AsyncStorage.setItem(ALERT_QUEUE_KEY, JSON.stringify(remaining));
  } catch (error) {
    console.error('Failed to clear queued alert:', error);
  }
}
