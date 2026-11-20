import 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { AuthProvider } from '../src/hooks/useAuth';
import { RideThemeProvider, useRideTheme } from '../src/theme';
import '../src/services/backgroundLocation';

function AppNavigator() {
  const theme = useRideTheme();
  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="ride" options={{ headerShown: false }} />
      </Stack>
    </AuthProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <RideThemeProvider>
        <AppNavigator />
      </RideThemeProvider>
    </SafeAreaProvider>
  );
}
