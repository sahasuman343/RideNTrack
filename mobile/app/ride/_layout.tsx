import { Stack } from 'expo-router';

export default function RideLayout() {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}>
      <Stack.Screen name="[id]" options={{ title: 'Live Ride' }} />
    </Stack>
  );
}
