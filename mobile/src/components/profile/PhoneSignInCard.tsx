import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatLoginPhone, type AuthProblem } from '@ridentrack/shared';
import { useAuth } from '../../hooks/useAuth';
import { AuthProblemDialog, PhoneCodeForm, PHONE_LOGIN_ENABLED } from '../auth';
import { useRideTheme, radius, spacing, type RidePalette } from '../../theme';

/**
 * "Sign in with your phone": an email account adds a mobile number, confirmed
 * by a texted code, and can then sign in with either. Hidden until phone
 * sign-in is switched on for this build.
 */
export function PhoneSignInCard() {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { user, profile, startPhoneLink, confirmPhoneLink } = useAuth();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const [done, setDone] = useState(false);
  if (!PHONE_LOGIN_ENABLED || !user) return null;
  const linked = user.phone ? formatLoginPhone(user.phone) : null;

  return (
    <View style={s.card}>
      <Text style={s.title}>Sign in with your phone</Text>
      <Text style={s.hint}>
        {linked
          ? `You can sign in with a code texted to ${linked}${user.email ? ', or with your email' : ''}.`
          : 'Add your mobile number to sign in with a texted code instead of your password.'}
      </Text>
      {done && <Text style={s.ok} accessibilityLiveRegion="polite">Number confirmed.</Text>}
      {open ? (
        <PhoneCodeForm
          mode="sign_in"
          initialPhone={linked ? '' : profile?.phone ?? ''}
          sendLabel="Text me a code"
          verifyLabel="Confirm number"
          onSend={startPhoneLink}
          onVerify={async (phone, code) => { await confirmPhoneLink(phone, code); setOpen(false); setDone(true); }}
          onProblem={setProblem}
        />
      ) : (
        <TouchableOpacity style={s.button} onPress={() => { setDone(false); setOpen(true); }} accessibilityRole="button">
          <Text style={s.buttonText}>{linked ? 'Change number' : 'Add mobile number'}</Text>
        </TouchableOpacity>
      )}
      {open && (
        <TouchableOpacity onPress={() => setOpen(false)} accessibilityRole="button" style={s.cancel}>
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
      )}
      <AuthProblemDialog problem={problem} onClose={() => setProblem(null)} />
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.lg, gap: spacing.sm },
  title: { color: c.text, fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  hint: { color: c.textMuted, fontSize: 12, lineHeight: 18 },
  ok: { color: c.green, fontSize: 13, fontWeight: '700' },
  button: { minHeight: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: c.accent, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  buttonText: { color: c.accent, fontSize: 15, fontWeight: '700' },
  cancel: { alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  cancelText: { color: c.textMuted, fontSize: 14, fontWeight: '700' },
});
