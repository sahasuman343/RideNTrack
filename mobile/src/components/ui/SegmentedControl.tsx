import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRideTheme, RidePalette } from '../../theme';

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
  const isScrollable = scrollable ?? options.length > 4;

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
      borderRadius: 14,
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
      gap: 8,
      paddingHorizontal: 2,
    },
    tab: {
      minHeight: 38,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 11,
      paddingHorizontal: 14,
      paddingVertical: 7,
      flexDirection: 'row',
      gap: 6,
    },
    tabFixed: {
      flex: 1,
    },
    tabScrollable: {
      backgroundColor: c.surfaceRaised,
      borderWidth: 1,
      borderColor: c.border,
    },
    tabActive: {
      backgroundColor: c.surface,
      borderColor: c.accent,
      borderWidth: 1.5,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 4,
      elevation: 2,
    },
    liveDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    icon: {
      fontSize: 13,
      color: c.textMuted,
    },
    iconActive: {
      color: c.accent,
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: c.textMuted,
      letterSpacing: 0.2,
    },
    labelActive: {
      color: c.text,
      fontWeight: '800',
    },
    badge: {
      paddingHorizontal: 6,
      paddingVertical: 1.5,
      borderRadius: 10,
      backgroundColor: c.surfaceHigh,
      minWidth: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeActive: {
      backgroundColor: c.accentSoft,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: c.textMuted,
    },
    badgeTextActive: {
      color: c.accent,
    },
  });
