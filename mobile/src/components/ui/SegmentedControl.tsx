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
  const isDark = theme.background === '#090B0E' || theme.background === '#050706' || theme.background === '#111317';
  const styles = makeStyles(theme, isDark);
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

const makeStyles = (c: RidePalette, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      backgroundColor: isDark ? c.surfaceRaised : '#F1F5F9',
      borderRadius: 9999,
      borderWidth: 1,
      borderColor: c.border,
      padding: 4,
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
      paddingHorizontal: 20,
      paddingVertical: 2,
    },
    tab: {
      minHeight: 38,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 9999,
      paddingHorizontal: 15,
      paddingVertical: 7,
      flexDirection: 'row',
      gap: 6,
      flexShrink: 0,
    },
    tabFixed: {
      flex: 1,
    },
    tabScrollable: isDark
      ? {
          backgroundColor: c.surfaceRaised,
          borderWidth: 1,
          borderColor: c.border,
        }
      : {
          backgroundColor: '#FFFFFF',
          borderWidth: 1,
          borderColor: '#E2E8F0',
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.04,
          shadowRadius: 3,
          elevation: 1,
        },
    tabActive: isDark
      ? {
          backgroundColor: c.surfaceHigh,
          borderColor: c.accent,
          borderWidth: 1.5,
          shadowColor: c.accent,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 6,
          elevation: 3,
        }
      : {
          backgroundColor: '#0F172A',
          borderColor: '#0F172A',
          borderWidth: 1.5,
          shadowColor: '#0F172A',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.18,
          shadowRadius: 5,
          elevation: 3,
        },
    liveDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      marginRight: 2,
    },
    icon: {
      fontSize: 13,
      color: c.textMuted,
    },
    iconActive: {
      color: isDark ? c.accent : '#FFFFFF',
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: isDark ? c.textMuted : '#475569',
      letterSpacing: 0.2,
    },
    labelActive: {
      color: '#FFFFFF',
      fontWeight: '800',
    },
    badge: {
      paddingHorizontal: 6,
      paddingVertical: 1.5,
      borderRadius: 9999,
      backgroundColor: isDark ? c.surfaceHigh : '#F1F5F9',
      minWidth: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeActive: isDark
      ? {
          backgroundColor: c.accentSoft,
        }
      : {
          backgroundColor: 'rgba(255, 255, 255, 0.2)',
        },
    badgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: isDark ? c.textMuted : '#64748B',
    },
    badgeTextActive: {
      color: isDark ? c.accent : '#FFFFFF',
      fontWeight: '800',
    },
  });
