import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useRideTheme, RidePalette } from '../../theme';

export interface RouteLineProps {
  origin?: string;
  destination?: string;
  stopsCount?: number;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}

export function RouteLine({
  origin,
  destination,
  stopsCount = 0,
  style,
  compact = false,
}: RouteLineProps) {
  const theme = useRideTheme();
  const styles = makeStyles(theme);

  return (
    <View style={[styles.container, style]}>
      {/* Route Graphic */}
      <View style={styles.lineContainer}>
        {/* Origin Dot */}
        <View style={styles.originDot} />

        {/* Amber Line Core with Halo */}
        <View style={styles.lineTrack}>
          <View style={styles.lineHalo} />
          <View style={styles.lineCore} />
          {stopsCount > 0 && (
            <View style={styles.stopDotsContainer}>
              {Array.from({ length: Math.min(stopsCount, 4) }).map((_, i) => (
                <View key={i} style={styles.intermediateDot} />
              ))}
            </View>
          )}
        </View>

        {/* Destination Dot */}
        <View style={styles.destinationDot} />
      </View>

      {/* Origin / Destination Text Labels if provided and not compact */}
      {!compact && (origin || destination) && (
        <View style={styles.labelsContainer}>
          <Text style={styles.originText} numberOfLines={1}>
            {origin || 'Start'}
          </Text>
          <Text style={styles.arrowText}>→</Text>
          <Text style={styles.destText} numberOfLines={1}>
            {destination || 'Finish'}
          </Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    container: {
      width: '100%',
      gap: 6,
    },
    lineContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      width: '100%',
    },
    originDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.accent,
      borderWidth: 1.5,
      borderColor: c.text,
      zIndex: 2,
    },
    lineTrack: {
      flex: 1,
      height: 6,
      justifyContent: 'center',
      position: 'relative',
    },
    lineHalo: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 6,
      backgroundColor: c.accentSoft,
      borderRadius: 3,
    },
    lineCore: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 2.5,
      backgroundColor: c.accent,
      borderRadius: 1.5,
    },
    stopDotsContainer: {
      position: 'absolute',
      left: 0,
      right: 0,
      flexDirection: 'row',
      justifyContent: 'space-evenly',
      alignItems: 'center',
    },
    intermediateDot: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: c.surfaceRaised,
      borderWidth: 1,
      borderColor: c.accent,
    },
    destinationDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.green,
      borderWidth: 1.5,
      borderColor: c.text,
      zIndex: 2,
    },
    labelsContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
    },
    originText: {
      fontSize: 13,
      fontWeight: '600',
      color: c.text,
      flex: 1,
    },
    arrowText: {
      fontSize: 12,
      color: c.accent,
      fontWeight: 'bold',
    },
    destText: {
      fontSize: 13,
      fontWeight: '600',
      color: c.text,
      flex: 1,
      textAlign: 'right',
    },
  });
