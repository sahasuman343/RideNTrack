import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useRideTheme, RidePalette, radius } from '../../theme';
import { StatusBadge } from './StatusBadge';
import { LiveDot } from './LiveDot';

export interface FallbackTripCoverProps {
  tripId: string;
  name: string;
  status: string;
  stageInfo?: string;
  elevation?: string | number | null;
  timeTag?: string | null;
  imageUri?: string | null;
  hero?: boolean;
  distance?: string | null;
  galleryPhotos?: string[];
  hideBadges?: boolean;
}

const SCENIC_TOURING_PHOTOS = [
  'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=1200&q=80', // Mountain pass adventure
  'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&w=1200&q=80', // Coastal highway tour
  'https://images.unsplash.com/photo-1609630875171-b1321377ee65?auto=format&fit=crop&w=1200&q=80', // Alpine twisties
  'https://images.unsplash.com/photo-1508974239320-0a029497e820?auto=format&fit=crop&w=1200&q=80', // Golden hour highway
  'https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?auto=format&fit=crop&w=1200&q=80', // Canyon expedition
];

export function FallbackTripCover({
  tripId,
  name,
  status,
  stageInfo,
  elevation,
  timeTag,
  imageUri,
  hero = false,
  distance,
  galleryPhotos,
  hideBadges = false,
}: FallbackTripCoverProps) {
  const theme = useRideTheme();
  const styles = makeStyles(theme, hero);
  const [imageFailed, setImageFailed] = useState(false);

  const isLive = status === 'active' || status === 'live';
  const isCompleted = status === 'completed' || status === 'archived';

  // Deterministic hash based on tripId / name
  const hash = Math.abs(
    (tripId || name || '')
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0)
  );

  // Theme-aware map-paper tones; the route line follows brand accent so covers read as one family.
  const coverTones = theme.coverTones;
  const coverTone = coverTones[hash % coverTones.length];
  // Live cards always feature scenic motorcycle photo; other cards prefer imageUri or scenic fallback
  const resolvedPhoto = imageUri || (isLive ? SCENIC_TOURING_PHOTOS[hash % SCENIC_TOURING_PHOTOS.length] : null);
  const shouldRenderPhoto = !!resolvedPhoto && !imageFailed;

  const routeLineColor = theme.coverRoute;

  return (
    <View style={[styles.container, { backgroundColor: coverTone }]}>
      {shouldRenderPhoto ? (
        <Image
          source={{ uri: resolvedPhoto }}
          style={styles.image}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        /* Generated Fallback Route Map / Topographic Visual Canvas */
        <View style={styles.graphicContainer}>
          {/* Topographic grid markings */}
          <View style={styles.gridLineH1} />
          <View style={styles.gridLineH2} />
          <View style={styles.gridLineV1} />
          <View style={styles.gridLineV2} />

          {/* Stylized vector route trail on the canvas with orange accent for completed */}
          <View style={[styles.curveSegment1, { borderColor: routeLineColor }]} />
          <View style={[styles.curveSegment2, { borderColor: routeLineColor }]} />
          <View style={[styles.startMarker, { backgroundColor: routeLineColor }]} />
          <View style={[styles.endMarker, { borderColor: routeLineColor }]} />
        </View>
      )}

      {/* Top subtle vignette */}
      <View style={styles.topVignette} />

      {/* Bottom gradient overlay for hero title readability */}
      {hero ? (
        <View style={styles.heroBottomOverlay}>
          <Text style={styles.heroTripName} numberOfLines={1}>
            {name}
          </Text>
        </View>
      ) : (
        <View style={styles.vignette} />
      )}

      {/* Top left: status */}
      {!hideBadges && (
        <View style={styles.statusBadgeWrap}>
          {isLive ? (
            <View style={styles.floatingLiveBadge}>
              <LiveDot size={7} color={theme.green} />
              <Text style={styles.floatingLiveText}>
                {stageInfo ? `LIVE • ${stageInfo}` : 'LIVE'}
              </Text>
            </View>
          ) : (
            <StatusBadge status={status} stageInfo={stageInfo} size="sm" />
          )}
        </View>
      )}

      {/* Top right: factual route data only */}
      {!hideBadges && (
        <View style={styles.topRightWrap}>
          {distance && (
            <View style={styles.infoTag}>
              <Text style={styles.infoTagText}>{distance}</Text>
            </View>
          )}
          {elevation ? (
            <View style={styles.infoTag}>
              <Text style={styles.infoTagText}>
                {typeof elevation === 'number' || !String(elevation).includes('m')
                  ? `${elevation}m ELV`
                  : elevation}
              </Text>
            </View>
          ) : timeTag ? (
            <View style={styles.infoTag}>
              <Text style={styles.infoTagText}>{timeTag}</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* Overlapping Photo Gallery Preview (for Completed Trips) */}
      {isCompleted && Array.isArray(galleryPhotos) && galleryPhotos.length > 0 && (
        <View style={styles.galleryPreviewWrap}>
          {galleryPhotos.slice(0, 3).map((photoUri, index) => (
            <Image
              key={index}
              source={{ uri: photoUri }}
              style={[styles.galleryThumb, { marginLeft: index === 0 ? 0 : -8 }]}
            />
          ))}
          {galleryPhotos.length > 3 && (
            <View style={[styles.galleryMorePill, { marginLeft: -8 }]}>
              <Text style={styles.galleryMoreText}>+{galleryPhotos.length - 3}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const COVER_ROUTE_COLOR = '#E2804F';

const makeStyles = (c: RidePalette, hero: boolean) =>
  StyleSheet.create({
    container: {
      height: hero ? 210 : 130,
      width: '100%',
      borderRadius: radius.md,
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
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    gridLineH2: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 80,
      height: 1,
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    gridLineV1: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: '33%',
      width: 1,
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    gridLineV2: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: '66%',
      width: 1,
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    curveSegment1: {
      position: 'absolute',
      left: 36,
      top: 48,
      width: 130,
      height: 44,
      borderTopWidth: 3,
      borderRightWidth: 3,
      borderTopRightRadius: 32,
      opacity: 0.85,
    },
    curveSegment2: {
      position: 'absolute',
      left: 150,
      top: 26,
      width: 140,
      height: 56,
      borderBottomWidth: 3,
      borderLeftWidth: 3,
      borderBottomLeftRadius: 38,
      opacity: 0.85,
    },
    startMarker: {
      position: 'absolute',
      left: 32,
      top: 66,
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    endMarker: {
      position: 'absolute',
      right: 42,
      top: 22,
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 2,
      backgroundColor: '#FFFFFF',
      justifyContent: 'center',
      alignItems: 'center',
    },
    topVignette: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 60,
      backgroundColor: 'rgba(0, 0, 0, 0.35)',
    },
    vignette: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(0, 0, 0, 0.2)',
    },
    heroBottomOverlay: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      paddingHorizontal: 16,
      paddingTop: 36,
      paddingBottom: 14,
      backgroundColor: 'rgba(8, 12, 10, 0.72)',
      justifyContent: 'flex-end',
    },
    heroTripName: {
      fontSize: 20,
      fontWeight: '800',
      color: '#FFFFFF',
      letterSpacing: -0.3,
    },
    statusBadgeWrap: {
      position: 'absolute',
      top: 12,
      left: 12,
      zIndex: 10,
    },
    floatingLiveBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: 'rgba(8, 12, 10, 0.78)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.xs,
    },
    floatingLiveText: {
      fontSize: 11,
      fontWeight: '800',
      color: c.green,
      letterSpacing: 0.8,
    },
    topRightWrap: {
      position: 'absolute',
      top: 12,
      right: 12,
      zIndex: 10,
      flexDirection: 'row',
      gap: 6,
    },
    // Solid scrim tags keep data legible over any photo without blur or glass effects.
    infoTag: {
      backgroundColor: 'rgba(8, 12, 10, 0.72)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.xs,
    },
    infoTagText: {
      fontSize: 11,
      fontWeight: '700',
      color: '#ECEAE2',
      letterSpacing: 0.4,
      fontVariant: ['tabular-nums'],
    },
    galleryPreviewWrap: {
      position: 'absolute',
      bottom: 10,
      right: 12,
      flexDirection: 'row',
      alignItems: 'center',
      zIndex: 10,
    },
    galleryThumb: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 2,
      borderColor: '#FFFFFF',
    },
    galleryMorePill: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: 'rgba(8, 12, 10, 0.85)',
      borderWidth: 1.5,
      borderColor: '#FFFFFF',
      justifyContent: 'center',
      alignItems: 'center',
    },
    galleryMoreText: {
      fontSize: 10,
      fontWeight: '800',
      color: '#FFFFFF',
    },
  });
