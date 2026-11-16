import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'system' | 'light' | 'dark';
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

type ThemeContextValue = { mode: ThemeMode; setMode: (mode: ThemeMode) => void; palette: RidePalette };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function RideThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem('ridentrack.theme-mode').then(value => {
      if (mounted && (value === 'light' || value === 'dark' || value === 'system')) setModeState(value);
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  const setMode = (next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem('ridentrack.theme-mode', next).catch(() => {});
  };
  const resolved = mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;
  const value = useMemo(() => ({ mode, setMode, palette: palettes[resolved] }), [mode, resolved]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useRideTheme() {
  const context = useContext(ThemeContext);
  const systemScheme = useColorScheme();
  return context?.palette || palettes[systemScheme === 'dark' ? 'dark' : 'light'];
}

export function useRideThemeSettings() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useRideThemeSettings must be used inside RideThemeProvider');
  return { mode: context.mode, setMode: context.setMode };
}
