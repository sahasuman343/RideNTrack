import React from 'react';
import { View, StyleSheet, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { useRideTheme, RidePalette, radius, spacing } from '../../theme';

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: 'default' | 'raised' | 'activeGlow' | 'dangerGlow' | 'flat';
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'none';
  testID?: string;
}

export function Card({
  children,
  style,
  variant = 'default',
  onPress,
  accessibilityLabel,
  accessibilityRole = onPress ? 'button' : 'none',
  testID,
}: CardProps) {
  const theme = useRideTheme();
  const styles = makeStyles(theme);

  const variantStyle = {
    default: styles.cardDefault,
    raised: styles.cardRaised,
    activeGlow: styles.cardActiveGlow,
    dangerGlow: styles.cardDangerGlow,
    flat: styles.cardFlat,
  }[variant];

  if (onPress) {
    return (
      <TouchableOpacity
        style={[styles.base, variantStyle, style]}
        onPress={onPress}
        activeOpacity={0.88}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return (
    <View
      style={[styles.base, variantStyle, style]}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {children}
    </View>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    base: {
      borderRadius: radius.md,
      borderWidth: 1,
      padding: spacing.lg,
      overflow: 'hidden',
    },
    cardDefault: {
      backgroundColor: c.surface,
      borderColor: c.border,
    },
    // In-flow content is separated by tone and hairlines, never by drop shadows.
    cardRaised: {
      backgroundColor: c.surface,
      borderColor: c.border,
    },
    cardActiveGlow: {
      backgroundColor: c.surface,
      borderColor: c.green,
      borderLeftWidth: 3,
    },
    cardDangerGlow: {
      backgroundColor: c.dangerSoft,
      borderColor: c.danger,
    },
    cardFlat: {
      backgroundColor: 'transparent',
      borderColor: c.border,
    },
  });