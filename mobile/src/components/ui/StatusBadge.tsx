import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRideTheme, RidePalette, radius } from '../../theme';
import { LiveDot } from './LiveDot';

export type TripStatusType = 'live' | 'active' | 'planned' | 'completed' | 'cancelled' | 'archived';

export interface StatusBadgeProps {
  status: TripStatusType | string;
  label?: string;
  stageInfo?: string;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, label, stageInfo, size = 'md' }: StatusBadgeProps) {
  const theme = useRideTheme();
  const styles = makeStyles(theme);
  const normalized = (status || '').toLowerCase();
  let title = label;
  let bg = theme.surfaceHigh;
  let fg = theme.text;
  let isLive = false;

  switch (normalized) {
    case 'live':
    case 'active':
      isLive = true;
      title = label || (stageInfo ? `LIVE • ${stageInfo}` : 'LIVE');
      bg = theme.greenSoft;
      fg = theme.green;
      break;
    case 'planned':
      title = label || 'Planned';
      bg = theme.tertiarySoft;
      fg = theme.tertiary;
      break;
    case 'completed':
      title = label || 'Completed';
      bg = theme.surfaceHigh;
      fg = theme.muted;
      break;
    case 'cancelled':
      title = label || 'Cancelled';
      bg = theme.dangerSoft;
      fg = theme.danger;
      break;
    case 'archived':
      title = label || 'Archived';
      bg = theme.surfaceHigh;
      fg = theme.muted;
      break;
    default:
      title = label || status;
      break;
  }

  const isSmall = size === 'sm';

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: bg },
        isSmall && styles.badgeSm,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Status: ${title}`}
    >
      {isLive ? (
        <LiveDot size={isSmall ? 6 : 7} color={theme.green} />
      ) : (
        <View style={[styles.dot, isSmall && styles.dotSm, { backgroundColor: fg }]} />
      )}
      <Text
        style={[
          styles.label,
          { color: fg },
          isSmall && styles.labelSm,
        ]}
        numberOfLines={1}
      >
        {title}
      </Text>
    </View>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radius.xs,
      gap: 6,
      alignSelf: 'flex-start',
    },
    badgeSm: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      gap: 4,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: radius.round,
    },
    dotSm: {
      width: 5,
      height: 5,
    },
    label: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    labelSm: {
      fontSize: 10,
      letterSpacing: 0.3,
    },
  });
