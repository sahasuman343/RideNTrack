import { Redirect } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';
import { Tabs } from 'expo-router';
import { BottomTabBar } from 'expo-router/tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
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
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.2,
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
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'compass' : 'compass-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          headerShown: false,
          tabBarLabel: 'Trips',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'map' : 'map-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerShown: false,
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person-circle' : 'person-circle-outline'} size={22} color={color} />
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
