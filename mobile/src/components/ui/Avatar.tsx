import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useRideTheme, RidePalette } from '../../theme';

export interface AvatarProps {
  uri?: string | null;
  name?: string;
  size?: number;
  borderWidth?: number;
  borderColor?: string;
}

export function Avatar({
  uri,
  name = 'Rider',
  size = 32,
  borderWidth = 1.5,
  borderColor,
}: AvatarProps) {
  const theme = useRideTheme();
  const styles = makeStyles(theme);
  const border = borderColor || theme.border;

  const initials = (name || 'R')
    .split(' ')
    .map(p => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[
          styles.image,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth,
            borderColor: border,
          },
        ]}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth,
          borderColor: border,
          backgroundColor: theme.surfaceHigh,
        },
      ]}
      accessibilityRole="image"
      accessibilityLabel={name}
    >
      <Text style={[styles.initials, { fontSize: Math.max(10, size * 0.4) }]}>
        {initials}
      </Text>
    </View>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    image: {
      backgroundColor: c.surfaceHigh,
    },
    fallback: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    initials: {
      fontWeight: '700',
      color: c.text,
    },
  });
