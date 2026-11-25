import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  StyleProp,
  ViewStyle,
  TextStyle,
  Platform,
  Vibration,
} from 'react-native';
import { useRideTheme, RidePalette, radius, motion } from '../../theme';

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
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const scale = useRef(new Animated.Value(1)).current;
  const inactive = disabled || loading;

  // A short spring on press-in/out gives every tap a physical response
  // without buzzing the phone; only destructive actions get a haptic tick.
  const pressIn = () => {
    Animated.spring(scale, { toValue: motion.pressScale, useNativeDriver: true, ...motion.pressIn }).start();
  };
  const pressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, ...motion.pressOut }).start();
  };

  // Layout props position the pressable; everything else styles the face.
  const { outerStyle, innerStyle } = React.useMemo(() => {
    const flat = (StyleSheet.flatten(style) || {}) as ViewStyle;
    const outer: ViewStyle = {};
    const inner: ViewStyle = {};
    for (const [key, value] of Object.entries(flat)) {
      const target = /^(flex|flexGrow|flexShrink|flexBasis|alignSelf|margin|position|top|left|right|bottom|zIndex|width|minWidth|maxWidth)/.test(key) ? outer : inner;
      (target as Record<string, unknown>)[key] = value;
    }
    if (outer.width !== undefined || outer.flex !== undefined || outer.flexGrow !== undefined || outer.alignSelf === 'stretch') {
      inner.width = '100%';
    }
    return { outerStyle: outer, innerStyle: inner };
  }, [style]);

  const handlePress = () => {
    if (inactive) return;
    if (variant === 'danger' && Platform.OS === 'android') {
      try {
        Vibration.vibrate(12);
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
    <Pressable
      onPress={handlePress}
      onPressIn={inactive ? undefined : pressIn}
      onPressOut={inactive ? undefined : pressOut}
      disabled={inactive}
      hitSlop={size === 'sm' ? 6 : 0}
      android_ripple={variant === 'ghost' || variant === 'outline' ? { color: theme.border, borderless: false } : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      testID={testID}
      style={outerStyle}
    >
      <Animated.View
        style={[
          styles.base,
          sizeStyle,
          buttonStyle,
          inactive && styles.disabled,
          innerStyle,
          { transform: [{ scale }] },
        ]}
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
      </Animated.View>
    </Pressable>
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
