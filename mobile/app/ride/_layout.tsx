import { Redirect } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';
import { Stack } from 'expo-router';
import { useRideTheme } from '../../src/theme';

export default function RideLayout() {
  const { session, loading } = useAuth();
  const theme = useRideTheme();
  if (loading) return null;
  if (!session) return <Redirect href="/(auth)/login" />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: theme.background }, headerTintColor: theme.text }}>
      <Stack.Screen name="[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
