import { Redirect } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useRideTheme } from '../../src/theme';

export default function TabsLayout() {
  const { session, loading } = useAuth();
  const theme = useRideTheme();
  if (loading) return null;
  if (!session) return <Redirect href="/(auth)/login" />;
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border, height: 62, paddingTop: 7, paddingBottom: 8, elevation: 0 },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.subtle,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: '800', fontSize: 16 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'My Trips',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 17, fontWeight: '900' }}>⌁</Text>,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Plan Trip',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 19, fontWeight: '600' }}>＋</Text>,
        }}
      />
      <Tabs.Screen
        name="join"
        options={{
          title: 'Join Ride',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>↗</Text>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 17 }}>◉</Text>,
        }}
      />
    </Tabs>
  );
}
