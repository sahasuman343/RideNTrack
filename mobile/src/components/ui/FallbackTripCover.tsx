import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useRideTheme, RidePalette } from '../../theme';
import { StatusBadge } from './StatusBadge';

export interface FallbackTripCoverProps {
  tripId: string;
  name: string;
  status: string;
  stageInfo?: string;
  elevation?: string | number | null;
  timeTag?: string | null;
  imageUri?: string | null;
}

export function FallbackTripCover({
  tripId,
  name,
  status,
  stageInfo,
  elevation,
  timeTag,
  imageUri,
}: FallbackTripCoverProps) {
  const theme = useRideTheme();
  const styles = makeStyles(theme);

  // Deterministic palette accent based on tripId string hash
  const hash = (tripId || name || '')
    .split('')
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);

  const themeVariants = [
    { bg: '#131A22', line: '#38BDF8', tag: '⛰️ Alpine Pass' }, // Sky blue
    { bg: '#1E1813', line: '#FF7A1A', tag: '🏜️ Desert Dune' }, // Action amber
    { bg: '#121F18', line: '#10B981', tag: '🌲 Forest Trail' }, // Pine green
    { bg: '#1B1424', line: '#A855F7', tag: '🌌 Highland Pass' }, // Purple
  ];

  const variant = themeVariants[hash % themeVariants.length];

  return (
    <View style={[styles.container, { backgroundColor: variant.bg }]}>
      {/* If real cover image is available, render it */}
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
      ) : (
        /* Generated Fallback Route Map Thumbnail */
        <View style={styles.graphicContainer}>
          {/* Topographic grid markings */}
          <View style={styles.gridLineH1} />
          <View style={styles.gridLineH2} />
          <View style={styles.gridLineV1} />
          <View style={styles.gridLineV2} />

          {/* Stylized vector route trail on the canvas */}
          <View style={[styles.curveSegment1, { borderColor: variant.line }]} />
          <View style={[styles.curveSegment2, { borderColor: variant.line }]} />
          <View style={[styles.startMarker, { backgroundColor: variant.line }]} />
          <View style={[styles.endMarker, { borderColor: variant.line }]} />
        </View>
      )}

      {/* Subtle vignette overlay */}
      <View style={styles.vignette} />

      {/* Top Left: Overlaid Status Badge (Icon + Color) */}
      <View style={styles.statusBadgeWrap}>
        <StatusBadge status={status} stageInfo={stageInfo} size="sm" />
      </View>

      {/* Top Right: Tag or Elevation */}
      <View style={styles.topRightWrap}>
        {elevation ? (
          <View style={styles.infoPill}>
            <Text style={styles.infoPillIcon}>⛰️</Text>
            <Text style={styles.infoPillText}>{elevation}m ELV</Text>
          </View>
        ) : timeTag ? (
          <View style={styles.infoPill}>
            <Text style={styles.infoPillText}>{timeTag}</Text>
          </View>
        ) : (
          <View style={styles.infoPill}>
            <Text style={styles.infoPillText}>{variant.tag}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    container: {
      height: 124,
      width: '100%',
      borderRadius: 16,
      overflow: 'hidden',
      position: 'relative',
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: 12,
    },
    image: {
      width: '100%',
      height: '100%',
    },
    graphicContainer: {
      ...StyleSheet.absoluteFill,
      overflow: 'hidden',
      justifyContent: 'center',
      alignItems: 'center',
    },
    gridLineH1: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 36,
      height: 1,
      backgroundColor: 'rgba(255, 255, 255, 0.04)',
    },
    gridLineH2: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 76,
      height: 1,
      backgroundColor: 'rgba(255, 255, 255, 0.04)',
    },
    gridLineV1: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: '33%',
      width: 1,
      backgroundColor: 'rgba(255, 255, 255, 0.04)',
    },
    gridLineV2: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: '66%',
      width: 1,
      backgroundColor: 'rgba(255, 255, 255, 0.04)',
    },
    curveSegment1: {
      position: 'absolute',
      left: 36,
      top: 50,
      width: 120,
      height: 40,
      borderTopWidth: 2.5,
      borderRightWidth: 2.5,
      borderTopRightRadius: 30,
      opacity: 0.65,
    },
    curveSegment2: {
      position: 'absolute',
      left: 140,
      top: 30,
      width: 130,
      height: 50,
      borderBottomWidth: 2.5,
      borderLeftWidth: 2.5,
      borderBottomLeftRadius: 35,
      opacity: 0.65,
    },
    startMarker: {
      position: 'absolute',
      left: 32,
      top: 68,
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    endMarker: {
      position: 'absolute',
      right: 48,
      top: 26,
      width: 10,
      height: 10,
      borderRadius: 5,
      borderWidth: 2,
      backgroundColor: '#FFFFFF',
    },
    vignette: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(0, 0, 0, 0.25)',
    },
    statusBadgeWrap: {
      position: 'absolute',
      top: 10,
      left: 10,
      zIndex: 10,
    },
    topRightWrap: {
      position: 'absolute',
      top: 10,
      right: 10,
      zIndex: 10,
    },
    infoPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(17, 19, 23, 0.75)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    infoPillIcon: {
      fontSize: 10,
    },
    infoPillText: {
      fontSize: 10,
      fontWeight: '700',
      color: '#E2E2E6',
      letterSpacing: 0.4,
    },
  });
