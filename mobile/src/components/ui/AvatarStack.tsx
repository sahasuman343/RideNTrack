import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRideTheme, RidePalette } from '../../theme';
import { Avatar } from './Avatar';

export interface AvatarItem {
  id?: string;
  name?: string;
  avatar_url?: string | null;
}

export interface AvatarStackProps {
  users?: AvatarItem[];
  totalCount?: number;
  maxDisplay?: number;
  size?: number;
  showCountSummary?: boolean;
}

export function AvatarStack({
  users = [],
  totalCount,
  maxDisplay = 4,
  size = 28,
  showCountSummary = false,
}: AvatarStackProps) {
  const theme = useRideTheme();
  const styles = makeStyles(theme);

  const displayed = users.slice(0, maxDisplay);
  const total = totalCount != null ? totalCount : users.length;
  const remaining = Math.max(0, total - displayed.length);

  return (
    <View style={styles.container}>
      <View style={styles.stack}>
        {displayed.map((user, index) => (
          <View
            key={user.id || index}
            style={[styles.avatarWrap, { zIndex: maxDisplay - index }]}
          >
            <Avatar
              uri={user.avatar_url}
              name={user.name}
              size={size}
              borderColor={theme.surfaceRaised}
              borderWidth={2}
            />
          </View>
        ))}

        {remaining > 0 && (
          <View
            style={[
              styles.overflowBadge,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: theme.surfaceHigh,
                borderColor: theme.surfaceRaised,
                zIndex: 0,
              },
            ]}
          >
            <Text style={[styles.overflowText, { fontSize: Math.max(9, size * 0.38) }]}>
              +{remaining}
            </Text>
          </View>
        )}
      </View>

      {showCountSummary && total > 0 && (
        <Text style={styles.summaryText}>
          {total} {total === 1 ? 'Rider' : 'Riders'}
        </Text>
      )}
    </View>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    stack: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    avatarWrap: {
      marginRight: -8,
    },
    overflowBadge: {
      borderWidth: 2,
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: -4,
    },
    overflowText: {
      color: c.text,
      fontWeight: '700',
    },
    summaryText: {
      fontSize: 12,
      color: c.textMuted,
      fontWeight: '600',
    },
  });
