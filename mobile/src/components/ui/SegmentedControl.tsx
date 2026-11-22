import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRideTheme, RidePalette } from '../../theme';

export interface SegmentOption<T extends string = string> {
  key: T;
  label: string;
  count?: number;
  icon?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentOption<T>[];
  selectedKey: T;
  onSelect: (key: T) => void;
  accessibilityLabel?: string;
}

export function SegmentedControl<T extends string = string>({
  options,
  selectedKey,
  onSelect,
  accessibilityLabel = 'Filter segments',
}: SegmentedControlProps<T>) {
  const theme = useRideTheme();
  const styles = makeStyles(theme);

  return (
    <View
      style={styles.container}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map(option => {
        const isSelected = option.key === selectedKey;
        return (
          <TouchableOpacity
            key={option.key}
            style={[styles.tab, isSelected && styles.tabActive]}
            onPress={() => onSelect(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${option.label}${option.count != null ? ` (${option.count})` : ''}`}
            activeOpacity={0.8}
          >
            {option.icon ? (
              <Text style={[styles.icon, isSelected && styles.iconActive]}>{option.icon}</Text>
            ) : null}
            <Text style={[styles.label, isSelected && styles.labelActive]}>
              {option.label}
              {option.count != null ? ` (${option.count})` : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (c: RidePalette) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      backgroundColor: c.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      padding: 4,
      minHeight: 48,
      alignItems: 'center',
    },
    tab: {
      flex: 1,
      minHeight: 40,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 10,
      paddingHorizontal: 8,
      flexDirection: 'row',
      gap: 4,
    },
    tabActive: {
      backgroundColor: c.surfaceHigh,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 2,
    },
    icon: {
      fontSize: 13,
      color: c.textMuted,
    },
    iconActive: {
      color: c.text,
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: c.textMuted,
      letterSpacing: 0.2,
    },
    labelActive: {
      color: c.text,
      fontWeight: '700',
    },
  });
