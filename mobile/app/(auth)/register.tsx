import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Image, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  authProblem, referralCodeFrom, referralSourceFrom, validateSignUp,
  MIN_PASSWORD, type AuthField, type AuthProblem,
} from '@ridentrack/shared';
import { useAuth } from '../../src/hooks/useAuth';
import { useRideTheme, RidePalette } from '../../src/theme';
import { Dialog } from '../../src/components/ui/Dialog';
import { AuthInput, AuthProblemDialog } from '../../src/components/auth';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<AuthField, string>>>({});
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const displayRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const inviteRef = useRef<TextInput>(null);
  // F17: ridentrack://register?ref=ABC123&src=recap fills the invite code.
  const params = useLocalSearchParams<{ ref?: string; src?: string }>();
  const linkedCode = referralCodeFrom(typeof params.ref === 'string' ? params.ref : null);
  const [inviteCode, setInviteCode] = useState(linkedCode ?? '');
  const { signUp } = useAuth();
  const router = useRouter();
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  function edit(field: AuthField, set: (v: string) => void) {
    return (v: string) => {
      set(v);
      if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
    };
  }

  function goSignIn() {
    setProblem(null);
    setSentTo(null);
    if (router.canGoBack()) router.back();
    else router.replace('/(auth)/login');
  }

  async function handleRegister() {
    const fieldErrors = validateSignUp({ email, password, username, displayName });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;
    setLoading(true);
    try {
      const signedIn = await signUp(email.trim(), password, username.trim(), displayName.trim(), {
        code: referralCodeFrom(inviteCode),
        source: linkedCode && referralCodeFrom(inviteCode) === linkedCode ? referralSourceFrom(typeof params.src === 'string' ? params.src : null) : 'typed',
      });
      if (signedIn) router.replace('/(tabs)');
      else setSentTo(email.trim());
    } catch (error: any) {
      const p = authProblem(error, 'sign_up');
      if (p.field) setErrors({ [p.field]: p.title });
      setProblem(p);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Image source={require('../../assets/RnT_logo.png')} style={styles.logoImage} resizeMode="contain" />
          <Text style={styles.kicker}>THE ROAD IS BETTER TOGETHER</Text>
          <Text style={styles.logo}>RideNTrack</Text>
          <Text style={styles.subtitle}>Join the community</Text>
        </View>

        <View style={styles.form}>
          <AuthInput
            label="Username"
            icon="at-outline"
            placeholder="asha.rides"
            value={username}
            onChangeText={edit('username', setUsername)}
            error={errors.username}
            hint="Letters, numbers, dots or underscores."
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username-new"
            returnKeyType="next"
            onSubmitEditing={() => displayRef.current?.focus()}
          />
          <AuthInput
            ref={displayRef}
            label="Display name"
            icon="person-outline"
            placeholder="Asha Menon"
            value={displayName}
            onChangeText={edit('displayName', setDisplayName)}
            error={errors.displayName}
            autoComplete="name"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
          />
          <AuthInput
            ref={emailRef}
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
            placeholder={`At least ${MIN_PASSWORD} characters`}
            value={password}
            onChangeText={edit('password', setPassword)}
            error={errors.password}
            password
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => inviteRef.current?.focus()}
          />
          <AuthInput
            ref={inviteRef}
            label="Invite code (optional)"
            icon="gift-outline"
            placeholder="ABC123"
            value={inviteCode}
            onChangeText={setInviteCode}
            hint={linkedCode ? 'Filled from your invite link.' : undefined}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            returnKeyType="go"
            onSubmitEditing={handleRegister}
          />
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonBusy]}
            onPress={handleRegister}
            disabled={loading}
            accessibilityRole="button"
            accessibilityState={{ busy: loading, disabled: loading }}
          >
            {loading ? <ActivityIndicator color={theme.onAccent} /> : <Text style={styles.buttonText}>Create account</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={goSignIn} style={styles.link} accessibilityRole="link">
            <Text style={styles.linkMuted}>Already riding with us? <Text style={styles.linkText}>Sign in</Text></Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <AuthProblemDialog problem={problem} onClose={() => setProblem(null)} onGoSignIn={goSignIn} />
      <Dialog
        visible={sentTo !== null}
        title="Check your inbox"
        message={`We sent a confirmation link to ${sentTo ?? ''}. Open it, then sign in. It can take a minute, and may land in spam.`}
        icon="mail-open-outline"
        iconColor={theme.green}
        iconBackgroundColor={theme.greenSoft}
        actions={[{ text: 'Go to sign in', onPress: goSignIn, variant: 'primary' }]}
        onDismiss={goSignIn}
        testID="signup-check-email-dialog"
      />
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 32 },
  logoImage: { width: 76, height: 76, borderRadius: 18, marginBottom: 14 },
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
