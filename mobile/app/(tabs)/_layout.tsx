import { Redirect } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';
import { Tabs } from 'expo-router';
import { BottomTabBar } from 'expo-router/tabs';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRideTheme } from '../../src/theme';
import { ActiveRideBanner } from '../../src/components/ActiveRideBanner';

export default function TabsLayout() {
  const { session, loading } = useAuth();
  const theme = useRideTheme();
  const insets = useSafeAreaInsets();
  if (loading) return null;
  if (!session) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      tabBar={props => (
        <>
          <ActiveRideBanner />
          <BottomTabBar {...props} />
        </>
      )}
      screenOptions={{
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          borderTopWidth: 1,
          height: 56 + Math.max(insets.bottom, 10),
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 6),
          elevation: 0,
        },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        },
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: '800', fontSize: 16 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerShown: false,
          tabBarLabel: 'Home',
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 18, fontWeight: '700' }}>🏍️</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          headerShown: false,
          tabBarLabel: 'Trips',
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 18, fontWeight: '700' }}>⌁</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerShown: false,
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 18, fontWeight: '700' }}>◉</Text>
          ),
        }}
      />

      {/* Full-screen / modal routes preserved in navigation for direct navigation and deep links */}
      <Tabs.Screen
        name="create"
        options={{
          href: null,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="join"
        options={{
          href: null,
          headerShown: false,
        }}
      />
    </Tabs>
  );
}
