import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

const SecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      return AsyncStorage.getItem(key);
    }
    const secureValue = await SecureStore.getItemAsync(key);
    if (secureValue !== null) {
      return secureValue;
    }
    // Check for legacy session stored in AsyncStorage prior to SecureStore migration
    const legacyValue = await AsyncStorage.getItem(key);
    if (legacyValue !== null) {
      try {
        await SecureStore.setItemAsync(key, legacyValue);
        // Delete legacy entry only after successful write to SecureStore
        await AsyncStorage.removeItem(key).catch(() => {});
      } catch (err) {
        // Retain legacyValue in AsyncStorage if SecureStore write fails
        console.warn('Could not migrate session to SecureStore:', err);
      }
      return legacyValue;
    }
    return null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      return AsyncStorage.setItem(key, value);
    }
    // Surface any native storage errors directly to preserve intended auth error handling
    await SecureStore.setItemAsync(key, value);
    // Remove any remaining legacy AsyncStorage entry after successful SecureStore write
    await AsyncStorage.removeItem(key).catch(() => {});
  },
  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      return AsyncStorage.removeItem(key);
    }
    // Clear both SecureStore and legacy AsyncStorage on sign-out
    await Promise.allSettled([
      SecureStore.deleteItemAsync(key),
      AsyncStorage.removeItem(key),
    ]);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

AppState.addEventListener('change', state => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
