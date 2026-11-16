import { useColorScheme } from 'react-native';
import { useMemo } from 'react';

export type RidePalette = {
  background: string; surface: string; surfaceRaised: string; text: string; muted: string;
  subtle: string; border: string; accent: string; accentSoft: string; green: string;
  greenSoft: string; danger: string; input: string; shadow: string;
};

const palettes: Record<'light' | 'dark', RidePalette> = {
  light: {
    background: '#F2F0E8', surface: '#FFFDF7', surfaceRaised: '#E9E6DC',
    text: '#202B25', muted: '#68756D', subtle: '#8A948A', border: '#D8D9CF',
    accent: '#D96535', accentSoft: '#F8E5D9', green: '#356B53', greenSoft: '#E2EDE3',
    danger: '#B94E40', input: '#FFFFFF', shadow: '#26352B',
  },
  dark: {
    background: '#14221D', surface: '#1D3028', surfaceRaised: '#263B32',
    text: '#F2F0E8', muted: '#B1BDB3', subtle: '#87968B', border: '#3B5045',
    accent: '#E47A49', accentSoft: '#493326', green: '#82B69A', greenSoft: '#294438',
    danger: '#F08B7D', input: '#192B23', shadow: '#000000',
  },
};

export function useRideTheme() {
  const scheme = useColorScheme();
  return useMemo(() => palettes[scheme === 'dark' ? 'dark' : 'light'], [scheme]);
}
