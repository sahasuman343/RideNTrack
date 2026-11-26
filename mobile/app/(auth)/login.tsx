import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Image, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { authProblem, validateSignIn, type AuthField, type AuthProblem } from '@ridentrack/shared';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, RidePalette } from '../../src/theme';
import { AuthInput, AuthProblemDialog, useResendConfirmation } from '../../src/components/auth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<AuthField, string>>>({});
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const { signIn } = useAuth();
  const { resend, resending } = useResendConfirmation();
  const router = useRouter();
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  function edit(field: AuthField, set: (v: string) => void) {
    return (v: string) => {
      set(v);
      if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
    };
  }

  async function handleLogin() {
    const fieldErrors = validateSignIn({ email, password });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      router.replace('/(tabs)');
    } catch (error: any) {
      const p = authProblem(error, 'sign_in');
      if (p.field && p.next !== 'resend_confirmation') setErrors({ [p.field]: p.title });
      setProblem(p);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setProblem(await resend(email));
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Image source={require('../../assets/RnT_logo.png')} style={styles.logoImage} resizeMode="contain" />
          <Text style={styles.kicker}>THE ROAD IS BETTER TOGETHER</Text>
          <Text style={styles.logo}>RideNTrack</Text>
          <Text style={styles.subtitle}>Welcome back, rider</Text>
        </View>

        <View style={styles.form}>
          <AuthInput
            label="Email"
            icon="mail-outline"
            placeholder="you@example.com"
            value={email}
            onChangeText={edit('email', setEmail)}
            error={errors.email}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <AuthInput
            ref={passwordRef}
            label="Password"
            icon="lock-closed-outline"
            placeholder="Your password"
            value={password}
            onChangeText={edit('password', setPassword)}
            error={errors.password}
            password
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={handleLogin}
          />
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonBusy]}
            onPress={handleLogin}
            disabled={loading}
            accessibilityRole="button"
            accessibilityState={{ busy: loading, disabled: loading }}
          >
            {loading ? <ActivityIndicator color={theme.onAccent} /> : <Text style={styles.buttonText}>Sign In</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/(auth)/register')} style={styles.link} accessibilityRole="link">
            <Text style={styles.linkMuted}>New to RideNTrack? <Text style={styles.linkText}>Create an account</Text></Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <AuthProblemDialog
        problem={problem}
        onClose={() => setProblem(null)}
        onResend={handleResend}
        resending={resending}
      />
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 40 },
  logoImage: { width: 88, height: 88, borderRadius: 20, marginBottom: 16 },
  kicker: { color: c.green, fontSize: 9, fontWeight: '900', letterSpacing: 2.2, marginBottom: 10 },
  logo: { fontSize: 36, fontWeight: '900', color: c.accent },
  subtitle: { fontSize: 16, color: c.muted, marginTop: 8 },
  form: { gap: 16 },
  button: { backgroundColor: c.accent, borderRadius: 12, padding: 16, minHeight: 56, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  buttonBusy: { opacity: 0.8 },
  buttonText: { color: c.onAccent, fontSize: 18, fontWeight: '700' },
  link: { alignItems: 'center', marginTop: 12, paddingVertical: 8 },
  linkMuted: { color: c.muted, fontSize: 14 },
  linkText: { color: c.accent, fontSize: 14, fontWeight: '700' },
});
