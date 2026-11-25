import 'react-native-gesture-handler';
import type React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../src/hooks/useAuth';
import { FeatureFlagsProvider } from '../src/hooks/useFeatureFlags';
import { identifyAnalyticsUser, track } from '../src/services/analytics';
import { startOtaUpdateChecks } from '../src/services/otaUpdates';
import { OfflineSyncProvider } from '../src/hooks/useOfflineSync';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import { RideThemeProvider, useRideTheme, palettes, radius } from '../src/theme';
import '../src/services/backgroundLocation';

const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
Sentry.init({
  dsn: sentryDsn,
  enabled: Boolean(sentryDsn),
  enableAutoSessionTracking: true,
  sendDefaultPii: false,
  tracesSampleRate: 0,
});

function PushNotifications() {
  usePushNotifications();
  return null;
}

/** Flags and analytics follow the signed-in rider. */
function SignedInServices({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  useEffect(() => {
    identifyAnalyticsUser(userId);
  }, [userId]);
  useEffect(() => {
    startOtaUpdateChecks();
    track('app_opened');
  }, []);
  return <FeatureFlagsProvider userId={userId}>{children}</FeatureFlagsProvider>;
}

function AppNavigator() {
  const theme = useRideTheme();
  return (
    <AuthProvider>
      <SignedInServices>
      <OfflineSyncProvider>
        <StatusBar style={theme.scheme === 'light' ? 'dark' : 'light'} />
        <PushNotifications />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="ride" options={{ headerShown: false }} />
        </Stack>
      </OfflineSyncProvider>
      </SignedInServices>
    </AuthProvider>
  );
}

export default function RootLayout() {
  return (
    <Sentry.ErrorBoundary
      fallback={({ resetError }) => (
        <View style={styles.fallback}>
          <Text style={styles.title}>RideNTrack needs to restart this screen</Text>
          <Text style={styles.detail}>Your ride data and offline queue are safe.</Text>
          <TouchableOpacity style={styles.button} onPress={resetError} accessibilityRole="button">
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}
    >
      <SafeAreaProvider>
        <RideThemeProvider>
          <AppNavigator />
        </RideThemeProvider>
      </SafeAreaProvider>
    </Sentry.ErrorBoundary>
  );
}

// Rendered outside RideThemeProvider, so it uses the dark palette directly.
const fallbackPalette = palettes.dark;
const styles = StyleSheet.create({
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: fallbackPalette.background },
  title: { color: fallbackPalette.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  detail: { color: fallbackPalette.textMuted, marginTop: 12, textAlign: 'center' },
  button: { backgroundColor: fallbackPalette.accent, borderRadius: radius.md, paddingHorizontal: 24, paddingVertical: 14, marginTop: 24 },
  buttonText: { color: fallbackPalette.onAccent, fontWeight: '800' },
});
