import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { bikeRangeKm, searchBikeModels, type BikeModel } from '@ridentrack/shared';
import { useRideTheme, radius, spacing, type RidePalette } from '../../theme';
import { Icon } from '../ui';

/*
 * F3: type a few letters of your bike, tap it, and tank, mileage and reserve
 * are filled in for fuel planning. Bikes not in the list still work: the
 * rider types make and model by hand below.
 */

export function BikeModelPicker({ selectedId, onPick }: { selectedId: string | null; onPick: (bike: BikeModel) => void }) {
  const theme = useRideTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchBikeModels(query, 6), [query]);

  return (
    <View style={s.wrap}>
      <View style={s.searchRow}>
        <Icon name="search" size="sm" color={theme.subtle} />
        <TextInput
          style={s.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Find your bike, e.g. Himalayan or 390"
          placeholderTextColor={theme.subtle}
          autoCorrect={false}
          accessibilityLabel="Search bike models"
        />
      </View>
      {results.map(bike => {
        const selected = bike.id === selectedId;
        return (
          <TouchableOpacity
            key={bike.id}
            style={[s.result, selected && { borderColor: theme.accent }]}
            accessibilityRole="button"
            accessibilityLabel={`${bike.make} ${bike.model}, about ${bikeRangeKm(bike)} kilometres per tank`}
            onPress={() => { onPick(bike); setQuery(''); }}
          >
            <View style={s.resultText}>
              <Text style={s.make}>{bike.make}</Text>
              <Text style={s.model}>{bike.model}</Text>
            </View>
            <Text style={s.spec}>{bike.tankLiters} L · {bike.mileageKmpl} km/l{'\n'}~{bikeRangeKm(bike)} km range</Text>
          </TouchableOpacity>
        );
      })}
      {query.trim().length > 1 && results.length === 0 ? (
        <Text style={s.empty}>Not in our list yet. Type make and model below and add your own figures.</Text>
      ) : null}
    </View>
  );
}

const makeStyles = (c: RidePalette) => StyleSheet.create({
  wrap: { gap: spacing.sm, marginVertical: spacing.sm },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1.5, borderColor: c.borderStrong, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 48,
    backgroundColor: c.surface,
  },
  input: { flex: 1, color: c.text, fontSize: 15, paddingVertical: spacing.sm },
  result: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: c.surfaceRaised,
  },
  resultText: { flex: 1, minWidth: 0 },
  make: { color: c.subtle, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  model: { color: c.text, fontSize: 16, fontWeight: '800' },
  spec: { color: c.textMuted, fontSize: 12, lineHeight: 17, textAlign: 'right', fontWeight: '600' },
  empty: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
});
