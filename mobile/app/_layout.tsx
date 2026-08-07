import { Slot } from 'expo-router';
import { AuthProvider } from '../src/hooks/useAuth';
// Initialize background location task definition
import '../src/services/backgroundLocation';

export default function RootLayout() {
  return (
    <AuthProvider>
      <Slot />
    </AuthProvider>
  );
}
