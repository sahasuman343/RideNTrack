import React, { forwardRef, useMemo, useState } from 'react';
import { View, Text, TextInput, TextInputProps, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRideTheme, RidePalette } from '../../theme';

interface Props extends Omit<TextInputProps, 'style'> {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  error?: string;
  hint?: string;
  /** Adds a show/hide toggle and hides the text by default. */
  password?: boolean;
}

/** Labelled input with an icon, an inline error under it, and a password toggle. */
export const AuthInput = forwardRef<TextInput, Props>(function AuthInput(
  { label, icon, error, hint, password, onFocus, onBlur, ...rest },
  ref,
) {
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const borderColor = error ? theme.danger : focused ? theme.accent : theme.border;

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, { borderColor }, error ? { backgroundColor: theme.dangerSoft } : null]}>
        <Ionicons name={icon} size={18} color={error ? theme.danger : focused ? theme.accent : theme.subtle} />
        <TextInput
          ref={ref}
          style={styles.input}
          placeholderTextColor={theme.subtle}
          secureTextEntry={password ? hidden : rest.secureTextEntry}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          {...rest}
        />
        {password ? (
          <TouchableOpacity
            onPress={() => setHidden((h) => !h)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
          >
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={theme.subtle} />
          </TouchableOpacity>
        ) : null}
      </View>
      {error ? (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle" size={14} color={theme.danger} />
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
});

const makeStyles = (c: RidePalette) => StyleSheet.create({
  label: { color: c.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6, textTransform: 'uppercase' },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.input,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
  },
  input: { flex: 1, paddingVertical: 14, fontSize: 16, color: c.text },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  error: { color: c.danger, fontSize: 13, flex: 1 },
  hint: { color: c.subtle, fontSize: 12, marginTop: 6 },
});
