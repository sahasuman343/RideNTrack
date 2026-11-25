import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { motion, useRideTheme } from '../../theme';

export interface SheetModalProps {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
  /** Tapping the scrim closes the sheet. Off for flows that must be answered. */
  dismissOnScrimPress?: boolean;
  testID?: string;
}

/**
 * Bottom sheet with a fading scrim and a sheet that springs up on its own.
 * React Native's built-in `animationType="slide"` moves the dark backdrop up
 * together with the sheet, which reads as a cheap full-screen wipe; here the
 * scrim fades in place and only the sheet moves. Runs on the native driver,
 * and respects the system "reduce motion" setting.
 */
export function SheetModal({ visible, onRequestClose, children, dismissOnScrimPress = true, testID }: SheetModalProps) {
  const theme = useRideTheme();
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) reduceMotion.current = value; }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.stopAnimation();
      if (reduceMotion.current) {
        Animated.timing(progress, { toValue: 1, duration: 120, useNativeDriver: true }).start();
      } else {
        Animated.spring(progress, { toValue: 1, useNativeDriver: true, ...motion.sheetIn }).start();
      }
    } else if (mounted) {
      progress.stopAnimation();
      Animated.timing(progress, {
        toValue: 0,
        duration: motion.sheetOutMs,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => { if (finished) setMounted(false); });
    }
    // `mounted` is intentionally read, not tracked: it only gates the exit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, progress]);

  if (!mounted) return null;

  const travel = reduceMotion.current ? 0 : Math.min(height * 0.5, 420);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] });

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onRequestClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim, opacity: progress }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={dismissOnScrimPress ? onRequestClose : undefined}
            accessibilityRole="button"
            accessibilityLabel="Close"
            importantForAccessibility={dismissOnScrimPress ? 'yes' : 'no-hide-descendants'}
          />
        </Animated.View>
        {/* Full-screen, transparent and touch-through: the sheet content keeps
            sizing itself against the screen (e.g. maxHeight: '90%') exactly
            as it did inside the old full-screen overlay. */}
        <Animated.View
          style={[styles.sheetLayer, { transform: [{ translateY }] }]}
          pointerEvents="box-none"
          testID={testID}
        >
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheetLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'flex-end' },
});
