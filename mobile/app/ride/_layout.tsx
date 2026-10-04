import { Redirect } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';
import { Stack } from 'expo-router';

export default function RideLayout() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Redirect href="/(auth)/login" />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}>
      <Stack.Screen name="[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
