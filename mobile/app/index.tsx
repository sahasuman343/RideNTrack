import { Redirect } from 'expo-router';
import { useAuth } from '../src/hooks/useAuth';
import { ActivityIndicator, View } from 'react-native';
import { useRideTheme } from '../src/theme';

export default function Index() {
  const { session, loading } = useAuth();
  const theme = useRideTheme();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (session) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(auth)/login" />;
}
