import React, { useState, useRef } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Platform,
  Vibration,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useRideTheme, RidePalette } from '../../theme';

export interface HoldToConfirmButtonProps {
  onConfirm: () => void;
  title?: string;
  confirmTitle?: string;
  durationMs?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export function HoldToConfirmButton({
  onConfirm,
  title = 'HOLD FOR SOS',
  confirmTitle = 'SOS DISPATCHED',
  durationMs = 2000,
  style,
  accessibilityLabel = 'Emergency SOS. Press and hold for 2 seconds to broadcast emergency.',
  testID = 'sos-hold-to-confirm',
}: HoldToConfirmButtonProps) {
  const theme = useRideTheme();
  const styles = makeStyles(theme);

  const [isHolding, setIsHolding] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(durationMs / 1000);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasHoldCompletedRef = useRef(false);

  const triggerHaptic = (pattern: number | number[]) => {
    if (Platform.OS !== 'web') {
      try {
        Vibration.vibrate(pattern);
      } catch {}
    }
  };

  const handlePressIn = () => {
    hasHoldCompletedRef.current = false;
    setIsHolding(true);
    setSecondsRemaining(durationMs / 1000);
    triggerHaptic(50);

    // Progress animation
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: durationMs,
      useNativeDriver: false,
    }).start();

    const startTime = Date.now();
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const left = Math.max(0, (durationMs - elapsed) / 1000);
      setSecondsRemaining(Math.round(left * 10) / 10);
    }, 100);

    timerRef.current = setTimeout(() => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      hasHoldCompletedRef.current = true;
      triggerHaptic([100, 100, 300]);
      setIsHolding(false);
      progressAnim.setValue(0);
      onConfirm();
    }, durationMs);
  };

  const handlePressOut = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: false,
    }).start();
    setIsHolding(false);
    setSecondsRemaining(durationMs / 1000);
  };

  const handleAccessiblePress = () => {
    // If the touch-hold already triggered the action, suppress the alert click
    if (hasHoldCompletedRef.current) {
      hasHoldCompletedRef.current = false;
      return;
    }

    Alert.alert(
      'Confirm Emergency SOS',
      'Are you sure you want to broadcast an emergency SOS alert with your live GPS location to your riding group?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Broadcast SOS',
          style: 'destructive',
          onPress: () => {
            triggerHaptic([100, 100, 300]);
            onConfirm();
          },
        },
      ]
    );
  };

  const fillWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handleAccessiblePress}
      style={({ pressed }) => [
        styles.container,
        pressed && styles.pressed,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Hold for 2 seconds, or activate to open emergency confirmation dialog"
      testID={testID}
    >
      {/* Animated Fill Bar */}
      <Animated.View
        style={[
          styles.fillBar,
          {
            width: fillWidth,
            backgroundColor: theme.danger,
          },
        ]}
      />

      <View style={styles.content}>
        <Text style={styles.icon}>🚨</Text>
        <View style={styles.textContainer}>
          <Text style={styles.title}>
            {isHolding ? `ARMING SOS (${secondsRemaining.toFixed(1)}s)` : title}
          </Text>
          <Text style={styles.hint}>
            {isHolding ? 'Release to cancel' : 'Hold 2s to broadcast emergency GPS'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    container: {
      minHeight: 64,
      borderRadius: 16,
      backgroundColor: c.surfaceRaised,
      borderWidth: 2,
      borderColor: c.danger,
      overflow: 'hidden',
      justifyContent: 'center',
      position: 'relative',
    },
    pressed: {
      transform: [{ scale: 0.98 }],
    },
    fillBar: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      opacity: 0.35,
    },
    content: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 18,
      paddingVertical: 12,
      gap: 12,
      zIndex: 2,
    },
    icon: {
      fontSize: 24,
    },
    textContainer: {
      flex: 1,
    },
    title: {
      fontSize: 16,
      fontWeight: '800',
      color: c.danger,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    hint: {
      fontSize: 11,
      color: c.textMuted,
      fontWeight: '600',
      marginTop: 2,
    },
  });
