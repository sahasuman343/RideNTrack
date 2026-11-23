import React from 'react';
import { View, StyleSheet, TouchableOpacity, StyleProp, ViewStyle, Platform } from 'react-native';
import { useRideTheme, RidePalette } from '../../theme';

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: 'default' | 'raised' | 'activeGlow' | 'dangerGlow' | 'flat' | 'glass' | 'glassHero';
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
    glass: styles.cardGlass,
    glassHero: styles.cardGlassHero,
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

const makeStyles = (c: RidePalette) => {
  const isDark = c.background !== '#F8FAFC';
  return StyleSheet.create({
    base: {
      borderRadius: 22,
      borderWidth: 1,
      padding: 16,
      overflow: 'hidden',
    },
    cardDefault: {
      backgroundColor: c.surface,
      borderColor: c.border,
    },
    cardRaised: {
      backgroundColor: isDark ? c.glassSurfaceRaised : 'rgba(255, 255, 255, 0.88)',
      borderColor: isDark ? c.glassBorder : 'rgba(255, 255, 255, 0.95)',
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.35 : 0.08,
      shadowRadius: 12,
      elevation: 4,
    },
    cardGlass: {
      backgroundColor: c.glassSurface,
      borderColor: c.glassBorder,
      borderWidth: 1,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.35 : 0.08,
      shadowRadius: 14,
      elevation: 4,
    },
    cardGlassHero: {
      backgroundColor: c.glassSurfaceRaised,
      borderColor: c.glassBorder,
      borderWidth: 1.2,
      padding: 18,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: isDark ? 0.45 : 0.1,
      shadowRadius: 18,
      elevation: 6,
    },
    cardActiveGlow: {
      backgroundColor: isDark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(236, 253, 245, 0.92)',
      borderColor: isDark ? 'rgba(16, 185, 129, 0.65)' : 'rgba(16, 185, 129, 0.5)',
      borderWidth: 1.5,
      shadowColor: c.green,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.35 : 0.15,
      shadowRadius: 14,
      elevation: 5,
    },
    cardDangerGlow: {
      backgroundColor: isDark ? 'rgba(239, 68, 68, 0.08)' : 'rgba(254, 242, 242, 0.92)',
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
};
