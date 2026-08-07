import { Tabs } from 'expo-router';
import { Text } from 'react-native';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: { backgroundColor: '#1a1a2e', borderTopColor: '#0f3460' },
        tabBarActiveTintColor: '#FF6B00',
        tabBarInactiveTintColor: '#666',
        headerStyle: { backgroundColor: '#1a1a2e' },
        headerTintColor: '#fff',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'My Rides',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🏍️</Text>,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create Ride',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>➕</Text>,
        }}
      />
      <Tabs.Screen
        name="join"
        options={{
          title: 'Join Ride',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🔗</Text>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>👤</Text>,
        }}
      />
    </Tabs>
  );
}
