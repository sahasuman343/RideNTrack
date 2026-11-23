import React, { type ComponentProps } from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRideTheme } from '../../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export const iconSize = { xs: 12, sm: 14, md: 18, lg: 22, xl: 28, hero: 40 } as const;
export type IconSize = keyof typeof iconSize;

export interface IconProps {
  name: IconName;
  size?: IconSize | number;
  color?: string;
  style?: StyleProp<TextStyle>;
}

/** The only icon primitive in the app. Ionicons, decorative by default (labels carry meaning). */
export function Icon({ name, size = 'md', color, style }: IconProps) {
  const theme = useRideTheme();
  return (
    <Ionicons
      name={name}
      size={typeof size === 'number' ? size : iconSize[size]}
      color={color ?? theme.textMuted}
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
