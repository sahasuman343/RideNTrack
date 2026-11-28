import React, { memo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Icon } from '../ui';
import type { RidePalette } from '../../theme';
import type { RideStyles } from './rideStyles';

function formatDistance(meters: number | null): string {
  if (meters == null) return '—';
  return meters >= 1000 ? (meters / 1000).toFixed(1) + ' km' : meters + ' m';
}

export interface RideHudProps {
  s: RideStyles;
  theme: RidePalette;
  targetName: string;
  distanceToNextStopMeters: number | null;
  distanceCoveredMeters: number;
  currentSpeedKmh: number | string;
  onOpenStats: () => void;
}

/**
 * Hero target, speed, trail and next stop. Memoised and fed throttled values,
 * so it repaints at most once a second however fast GPS fixes arrive.
 */
export const RideHud = memo(function RideHud({ s, theme, targetName, distanceToNextStopMeters, distanceCoveredMeters, currentSpeedKmh, onOpenStats }: RideHudProps) {
  return (
    <>
      <View style={s.heroApexSplitRow}>
        <View style={s.heroApexTargetCol}>
          <Text style={s.apexSubLabel}>NEXT APEX TARGET</Text>
          <View style={s.apexTitleRow}>
            <Icon name="navigate" size="md" color={theme.accent} />
            <Text style={s.apexTargetTitle} numberOfLines={1}>{targetName}</Text>
          </View>
        </View>
        <View style={s.heroApexDistCol}>
          <Text style={s.apexSubLabel}>DIST REMAINING</Text>
          <View style={s.apexDistRow}>
            <Text style={s.apexDistNumeral}>
              {distanceToNextStopMeters != null ? (distanceToNextStopMeters / 1000).toFixed(1) : (distanceCoveredMeters / 1000).toFixed(1)}
            </Text>
            <Text style={s.apexDistUnit}>KM</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity activeOpacity={0.88} onPress={onOpenStats} style={s.hudContainer}>
        <View style={s.hudItem}>
          <Text style={s.hudValue}>{currentSpeedKmh}</Text>
          <Text style={s.hudLabel}>KM/H</Text>
        </View>
        <View style={s.hudDivider} />
        <View style={s.hudItem}>
          <Text style={s.hudValue}>{formatDistance(distanceCoveredMeters)}</Text>
          <Text style={s.hudLabel}>TRAIL</Text>
        </View>
        <View style={s.hudDivider} />
        <View style={s.hudItem}>
          <Text style={s.hudValue}>{formatDistance(distanceToNextStopMeters)}</Text>
          <Text style={s.hudLabel}>NEXT STOP</Text>
        </View>
        <View style={s.hudDivider} />
        <View style={s.hudItem}>
          <Icon name="stats-chart-outline" size="lg" color={theme.accent} />
          <Text style={s.hudLabel}>STATS</Text>
        </View>
      </TouchableOpacity>
    </>
  );
});
