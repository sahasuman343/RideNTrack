import React from 'react';
import { View, StyleSheet, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { useRideTheme, RidePalette } from '../../theme';

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
      borderRadius: 20,
      borderWidth: 1,
      padding: 16,
      overflow: 'hidden',
    },
    cardDefault: {
      backgroundColor: c.surface,
      borderColor: c.border,
    },
    cardRaised: {
      backgroundColor: c.surfaceRaised,
      borderColor: c.border,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 4,
    },
    cardActiveGlow: {
      backgroundColor: c.surfaceRaised,
      borderColor: c.green,
      borderWidth: 1.5,
      shadowColor: c.green,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.35,
      shadowRadius: 10,
      elevation: 6,
    },
    cardDangerGlow: {
      backgroundColor: c.surfaceRaised,
      borderColor: c.danger,
      borderWidth: 1.5,
      shadowColor: c.danger,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.4,
      shadowRadius: 12,
      elevation: 6,
    },
    cardFlat: {
      backgroundColor: 'transparent',
      borderColor: c.border,
    },
  });
