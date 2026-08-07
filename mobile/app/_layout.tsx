import { Slot } from 'expo-router';
import { AuthProvider } from '../src/hooks/useAuth';

export default function RootLayout() {
  return (
    <AuthProvider>
      <Slot />
    </AuthProvider>
  );
}
