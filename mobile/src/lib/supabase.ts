import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { createChunkedStore } from './chunkedStore';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Long sessions are split across several SecureStore keys (audit finding 11).
const secureChunks = createChunkedStore({
  getItem: key => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: key => SecureStore.deleteItemAsync(key),
});

const SecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      return AsyncStorage.getItem(key);
    }
    const secureValue = await secureChunks.getItem(key);
    if (secureValue !== null) {
      return secureValue;
    }
    // Check for legacy session stored in AsyncStorage prior to SecureStore migration
    const legacyValue = await AsyncStorage.getItem(key);
    if (legacyValue !== null) {
      try {
        await secureChunks.setItem(key, legacyValue);
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
    await secureChunks.setItem(key, value);
    // Remove any remaining legacy AsyncStorage entry after successful SecureStore write
    await AsyncStorage.removeItem(key).catch(() => {});
  },
  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      return AsyncStorage.removeItem(key);
    }
    // Clear both SecureStore and legacy AsyncStorage on sign-out
    await Promise.allSettled([
      secureChunks.removeItem(key),
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
