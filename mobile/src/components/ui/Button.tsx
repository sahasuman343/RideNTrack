import React from 'react';
import {
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StyleProp,
  ViewStyle,
  TextStyle,
  Platform,
  Vibration,
} from 'react-native';
import { useRideTheme, RidePalette, radius } from '../../theme';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  disabled = false,
  loading = false,
  style,
  textStyle,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const theme = useRideTheme();
  const styles = makeStyles(theme);

  const handlePress = () => {
    if (disabled || loading) return;
    if (Platform.OS !== 'web') {
      try {
        Vibration.vibrate(20);
      } catch {}
    }
    onPress();
  };

  const buttonStyle = {
    primary: styles.btnPrimary,
    secondary: styles.btnSecondary,
    danger: styles.btnDanger,
    ghost: styles.btnGhost,
    outline: styles.btnOutline,
  }[variant];

  const sizeStyle = {
    sm: styles.sizeSm,
    md: styles.sizeMd,
    lg: styles.sizeLg,
  }[size];

  const textVariantStyle = {
    primary: styles.textPrimary,
    secondary: styles.textSecondary,
    danger: styles.textDanger,
    ghost: styles.textGhost,
    outline: styles.textOutline,
  }[variant];

  const textSizeStyle = {
    sm: styles.textSizeSm,
    md: styles.textSizeMd,
    lg: styles.textSizeLg,
  }[size];

  return (
    <TouchableOpacity
      style={[
        styles.base,
        sizeStyle,
        buttonStyle,
        (disabled || loading) && styles.disabled,
        style,
      ]}
      onPress={handlePress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? theme.onAccent : variant === 'danger' ? theme.onDanger : theme.text}
        />
      ) : (
        <>
          {icon}
          <Text style={[styles.textBase, textSizeStyle, textVariantStyle, textStyle]}>
            {title}
          </Text>
          {iconRight}
        </>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    base: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      gap: 8,
      overflow: 'hidden',
    },
    sizeSm: {
      minHeight: 40,
      paddingHorizontal: 12,
    },
    sizeMd: {
      minHeight: 48,
      paddingHorizontal: 16,
    },
    sizeLg: {
      minHeight: 64,
      paddingHorizontal: 24,
    },
    btnPrimary: {
      backgroundColor: c.accent,
    },
    btnSecondary: {
      backgroundColor: c.surfaceRaised,
      borderWidth: 1,
      borderColor: c.border,
    },
    btnDanger: {
      backgroundColor: c.danger,
    },
    btnGhost: {
      backgroundColor: 'transparent',
    },
    btnOutline: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: c.borderStrong,
    },
    textBase: {
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    textSizeSm: {
      fontSize: 13,
    },
    textSizeMd: {
      fontSize: 15,
    },
    textSizeLg: {
      fontSize: 17,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    textPrimary: {
      color: c.onAccent,
    },
    textSecondary: {
      color: c.text,
    },
    textDanger: {
      color: c.onDanger,
    },
    textGhost: {
      color: c.textMuted,
    },
    textOutline: {
      color: c.text,
    },
    disabled: {
      opacity: 0.5,
    },
  });
