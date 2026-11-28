import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import {
  authProblem, cleanOtp, formatLoginPhone, otpProblem, phoneProblem,
  OTP_LENGTH, OTP_RESEND_SECONDS, type AuthProblem,
} from '@ridentrack/shared';
import { useRideTheme, RidePalette } from '../../theme';
import { AuthInput } from './AuthInput';

/** Phone sign-in shows only once SMS codes are set up (docs/features/phone-login.md). */
export const PHONE_LOGIN_ENABLED = process.env.EXPO_PUBLIC_PHONE_LOGIN === 'true';

/** Throw this from onSend after showing your own field errors. */
export const HANDLED = Object.assign(new Error('handled'), { code: 'handled' });

export type SignInMethod = 'email' | 'phone';

/** Email | Phone switch above the sign-in and sign-up forms. */
export function SignInMethodSwitch({ value, onChange }: { value: SignInMethod; onChange: (m: SignInMethod) => void }) {
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.switch} accessibilityRole="tablist">
      {(['email', 'phone'] as const).map((m) => {
        const on = value === m;
        return (
          <TouchableOpacity
            key={m}
            style={[styles.switchItem, on && styles.switchItemOn]}
            onPress={() => onChange(m)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            testID={`auth-method-${m}`}
          >
            <Text style={[styles.switchText, on && styles.switchTextOn]}>{m === 'email' ? 'Email' : 'Phone'}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

interface Props {
  mode: 'sign_in' | 'sign_up';
  /** Sends the code and returns the number in E.164. */
  onSend: (phone: string) => Promise<string>;
  onVerify: (e164: string, code: string) => Promise<void>;
  /** Problems that don't belong to the phone or code field. */
  onProblem: (p: AuthProblem) => void;
  sendLabel?: string;
  verifyLabel?: string;
  /** Prefill, e.g. a number already in the profile. */
  initialPhone?: string;
}

/** Two steps: the number, then the 6-digit code with a resend timer. */
export function PhoneCodeForm({ mode, onSend, onVerify, onProblem, sendLabel = 'Send code', verifyLabel = 'Verify and sign in', initialPhone = '' }: Props) {
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [codeError, setCodeError] = useState<string | undefined>();
  const [wait, setWait] = useState(0);
  const codeRef = useRef<TextInput>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  function fail(error: any) {
    if (error?.code === 'handled') return;
    const p = authProblem(error, mode);
    if (p.field === 'phone' && !p.next) { setPhoneError(p.message); return; }
    if (p.field === 'code' && p.next !== 'retry') { setCodeError(p.message); return; }
    if (p.field === 'code') setCodeError(p.title);
    if (p.field === 'phone') setPhoneError(p.title);
    onProblem(p);
  }

  async function send() {
    if (busy) return;
    const problem = phoneProblem(phone);
    if (problem) { setPhoneError(problem); return; }
    setBusy(true);
    try {
      const e164 = await onSend(phone);
      setSentTo(e164);
      setCode('');
      setCodeError(undefined);
      setWait(OTP_RESEND_SECONDS);
      setTimeout(() => codeRef.current?.focus(), 100);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    if (busy || !sentTo) return;
    const problem = otpProblem(value);
    if (problem) { setCodeError(problem); return; }
    setBusy(true);
    try {
      await onVerify(sentTo, value);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  if (!sentTo) {
    return (
      <View style={styles.form}>
        <AuthInput
          label="Mobile number"
          icon="call-outline"
          placeholder="98765 43210"
          value={phone}
          onChangeText={(v) => { setPhone(v); if (phoneError) setPhoneError(undefined); }}
          error={phoneError}
          hint="Indian numbers need no +91. We text you a 6-digit code."
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="go"
          onSubmitEditing={send}
          testID="phone-input"
        />
        <TouchableOpacity
          style={[styles.button, busy && styles.buttonBusy]}
          onPress={send}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy }}
        >
          {busy ? <ActivityIndicator color={theme.onAccent} /> : <Text style={styles.buttonText}>{sendLabel}</Text>}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.form}>
      <Text style={styles.sent} accessibilityLiveRegion="polite">
        We texted a code to <Text style={styles.sentNumber}>{formatLoginPhone(sentTo)}</Text>.
      </Text>
      <AuthInput
        ref={codeRef}
        label="Code"
        icon="keypad-outline"
        placeholder={'0'.repeat(OTP_LENGTH)}
        value={code}
        onChangeText={(v) => {
          const clean = cleanOtp(v);
          setCode(clean);
          if (codeError) setCodeError(undefined);
          // Autofill or paste of the whole code signs in straight away.
          if (clean.length === OTP_LENGTH && v.length >= OTP_LENGTH && code.length < OTP_LENGTH - 1) void verify(clean);
        }}
        error={codeError}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={OTP_LENGTH + 2}
        returnKeyType="go"
        onSubmitEditing={() => verify()}
        testID="otp-input"
      />
      <TouchableOpacity
        style={[styles.button, busy && styles.buttonBusy]}
        onPress={() => verify()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
      >
        {busy ? <ActivityIndicator color={theme.onAccent} /> : <Text style={styles.buttonText}>{verifyLabel}</Text>}
      </TouchableOpacity>
      <View style={styles.row}>
        <TouchableOpacity onPress={() => { setSentTo(null); setCode(''); setCodeError(undefined); }} accessibilityRole="button" style={styles.small}>
          <Text style={styles.linkText}>Change number</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={send} disabled={wait > 0 || busy} accessibilityRole="button" accessibilityState={{ disabled: wait > 0 || busy }} style={styles.small}>
          <Text style={wait > 0 ? styles.linkMuted : styles.linkText}>{wait > 0 ? `Resend in ${wait}s` : 'Resend code'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  switch: { flexDirection: 'row', backgroundColor: c.input, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: c.border },
  switchItem: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  switchItemOn: { backgroundColor: c.accent },
  switchText: { color: c.muted, fontSize: 15, fontWeight: '700' },
  switchTextOn: { color: c.onAccent },
  form: { gap: 16 },
  sent: { color: c.muted, fontSize: 15, lineHeight: 21 },
  sentNumber: { color: c.text, fontWeight: '700' },
  button: { backgroundColor: c.accent, borderRadius: 12, padding: 16, minHeight: 56, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  buttonBusy: { opacity: 0.8 },
  buttonText: { color: c.onAccent, fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  small: { paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  linkMuted: { color: c.muted, fontSize: 14 },
  linkText: { color: c.accent, fontSize: 14, fontWeight: '700' },
});
