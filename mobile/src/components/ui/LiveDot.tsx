import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { useRideTheme } from '../../theme';

export interface LiveDotProps {
  size?: number;
  color?: string;
  pulse?: boolean;
}

export function LiveDot({ size = 8, color, pulse = true }: LiveDotProps) {
  const theme = useRideTheme();
  const dotColor = color || theme.green;
  const animValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!pulse) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(animValue, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(animValue, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, animValue]);

  const haloScale = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 2.4],
  });

  const haloOpacity = animValue.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0.6, 0.3, 0],
  });

  return (
    <View style={[styles.container, { width: size * 2.5, height: size * 2.5 }]}>
      {pulse && (
        <Animated.View
          style={[
            styles.halo,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: dotColor,
              transform: [{ scale: haloScale }],
              opacity: haloOpacity,
            },
          ]}
        />
      )}
      <View
        style={[
          styles.dot,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: dotColor,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  halo: {
    position: 'absolute',
  },
  dot: {
    zIndex: 2,
  },
});
