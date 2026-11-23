import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRideTheme, RidePalette, radius, spacing } from '../../theme';

export interface SegmentOption<T extends string = string> {
  key: T;
  label: string;
  count?: number;
  icon?: string;
  accessibilityLabel?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentOption<T>[];
  selectedKey: T;
  onSelect: (key: T) => void;
  accessibilityLabel?: string;
  scrollable?: boolean;
}

export function SegmentedControl<T extends string = string>({
  options,
  selectedKey,
  onSelect,
  accessibilityLabel = 'Filter segments',
  scrollable,
}: SegmentedControlProps<T>) {
  const theme = useRideTheme();
  const styles = makeStyles(theme);
  const isScrollable = scrollable ?? options.length > 3;

  const renderTabs = () =>
    options.map(option => {
      const isSelected = option.key === selectedKey;
      const isLive = option.key === 'live';

      return (
        <TouchableOpacity
          key={option.key}
          style={[
            styles.tab,
            isScrollable ? styles.tabScrollable : styles.tabFixed,
            isSelected && styles.tabActive,
          ]}
          onPress={() => onSelect(option.key)}
          accessibilityRole="tab"
          accessibilityState={{ selected: isSelected }}
          accessibilityLabel={
            option.accessibilityLabel ||
            `${option.label}${option.count != null ? ` (${option.count})` : ''}`
          }
          activeOpacity={0.75}
        >
          {isLive && (
            <View style={[styles.liveDot, { backgroundColor: theme.green }]} />
          )}
          {option.icon ? (
            <Text style={[styles.icon, isSelected && styles.iconActive]}>{option.icon}</Text>
          ) : null}
          <Text
            numberOfLines={1}
            style={[styles.label, isSelected && styles.labelActive]}
          >
            {option.label}
          </Text>
          {option.count != null && (
            <View style={[styles.badge, isSelected && styles.badgeActive]}>
              <Text style={[styles.badgeText, isSelected && styles.badgeTextActive]}>
                {option.count}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      );
    });

  if (isScrollable) {
    return (
      <View
        style={styles.scrollWrapper}
        accessibilityRole="tablist"
        accessibilityLabel={accessibilityLabel}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {renderTabs()}
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      style={styles.container}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {renderTabs()}
    </View>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      backgroundColor: c.surfaceRaised,
      borderRadius: radius.sm + 2,
      borderWidth: 1,
      borderColor: c.border,
      padding: 3,
      minHeight: 48,
      alignItems: 'center',
    },
    scrollWrapper: {
      minHeight: 48,
      justifyContent: 'center',
    },
    scrollContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.screen,
      paddingVertical: spacing.xxs,
    },
    tab: {
      minHeight: 40,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: radius.sm,
      paddingHorizontal: 14,
      paddingVertical: 8,
      flexDirection: 'row',
      gap: 6,
      flexShrink: 0,
    },
    tabFixed: {
      flex: 1,
    },
    tabScrollable: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: c.border,
    },
    // High-contrast inverse fill gives one unambiguous selected state in every theme.
    tabActive: {
      backgroundColor: c.text,
      borderColor: c.text,
      borderWidth: 1,
    },
    liveDot: {
      width: 7,
      height: 7,
      borderRadius: radius.round,
      marginRight: 2,
    },
    icon: {
      fontSize: 13,
      color: c.textMuted,
    },
    iconActive: {
      color: c.background,
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: c.textMuted,
      letterSpacing: 0.1,
    },
    labelActive: {
      color: c.background,
      fontWeight: '700',
    },
    badge: {
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: radius.xs,
      backgroundColor: c.surfaceHigh,
      minWidth: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeActive: {
      backgroundColor: c.textMuted,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: c.textMuted,
      fontVariant: ['tabular-nums'],
    },
    badgeTextActive: {
      color: c.background,
    },
  });