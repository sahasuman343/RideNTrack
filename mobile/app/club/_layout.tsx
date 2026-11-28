import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme } from '../../src/theme';

export default function ClubLayout() {
  const { session, loading } = useAuth();
  const theme = useRideTheme();
  if (loading) return null;
  if (!session) return <Redirect href="/(auth)/login" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }} />;
}
