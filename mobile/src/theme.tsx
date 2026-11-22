import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'system' | 'light' | 'dark' | 'ride';

export type RidePalette = {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceHigh: string;
  text: string;
  textMuted: string;
  muted: string;
  subtle: string;
  border: string;
  accent: string;
  accentSoft: string;
  green: string;
  greenSoft: string;
  tertiary: string;
  danger: string;
  dangerSoft: string;
  input: string;
  shadow: string;
};

export const palettes: Record<'light' | 'dark' | 'ride', RidePalette> = {
  dark: {
    background: '#090B0E',
    surface: '#11141B',
    surfaceRaised: '#171D27',
    surfaceHigh: '#212836',
    text: '#F1F5F9',
    textMuted: '#94A3B8',
    muted: '#94A3B8',
    subtle: '#64748B',
    border: '#212836',
    accent: '#FF7A1A',
    accentSoft: 'rgba(255, 122, 26, 0.15)',
    green: '#10B981',
    greenSoft: 'rgba(16, 185, 129, 0.15)',
    tertiary: '#38BDF8',
    danger: '#EF4444',
    dangerSoft: 'rgba(239, 68, 68, 0.18)',
    input: '#151921',
    shadow: '#000000',
  },
  ride: {
    background: '#050706',
    surface: '#0D110F',
    surfaceRaised: '#141A17',
    surfaceHigh: '#1C2420',
    text: '#FFFFFF',
    textMuted: '#A3B8AD',
    muted: '#A3B8AD',
    subtle: '#6B8276',
    border: '#2E3D35',
    accent: '#FF7A1A',
    accentSoft: 'rgba(255, 122, 26, 0.25)',
    green: '#00E676',
    greenSoft: 'rgba(0, 230, 118, 0.25)',
    tertiary: '#00E5FF',
    danger: '#FF1744',
    dangerSoft: 'rgba(255, 23, 68, 0.3)',
    input: '#0D110F',
    shadow: '#000000',
  },
  light: {
    background: '#F8FAFC',
    surface: '#FFFFFF',
    surfaceRaised: '#F1F5F9',
    surfaceHigh: '#E2E8F0',
    text: '#0F172A',
    textMuted: '#64748B',
    muted: '#64748B',
    subtle: '#94A3B8',
    border: '#E2E8F0',
    accent: '#FF7A1A',
    accentSoft: '#FFF7ED',
    green: '#10B981',
    greenSoft: '#ECFDF5',
    tertiary: '#0284C7',
    danger: '#EF4444',
    dangerSoft: 'rgba(239, 68, 68, 0.12)',
    input: '#FFFFFF',
    shadow: 'rgba(15, 23, 42, 0.08)',
  },
};

export const typography = {
  displayTelemetry: {
    fontFamily: Platform.select({ ios: 'SpaceGrotesk-Bold', android: 'SpaceGrotesk-Bold', default: 'monospace' }),
    fontSize: 56,
    fontWeight: '700' as const,
    letterSpacing: -1.5,
  },
  headlineLg: {
    fontSize: 32,
    fontWeight: '800' as const,
    letterSpacing: -0.5,
  },
  headlineMd: {
    fontSize: 24,
    fontWeight: '700' as const,
    letterSpacing: -0.3,
  },
  headlineSm: {
    fontSize: 20,
    fontWeight: '600' as const,
  },
  labelNumeric: {
    fontSize: 18,
    fontWeight: '700' as const,
    fontVariant: ['tabular-nums' as const],
  },
  labelCaps: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.0,
    textTransform: 'uppercase' as const,
  },
  titleMd: {
    fontSize: 16,
    fontWeight: '600' as const,
  },
  bodyLg: {
    fontSize: 16,
    fontWeight: '400' as const,
  },
  bodyMd: {
    fontSize: 14,
    fontWeight: '400' as const,
  },
  bodySm: {
    fontSize: 12,
    fontWeight: '400' as const,
  },
};

type ThemeContextValue = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  palette: RidePalette;
  isRideMode: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function RideThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('dark');

  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem('ridentrack.theme-mode')
      .then(value => {
        if (mounted && (value === 'light' || value === 'dark' || value === 'ride' || value === 'system')) {
          setModeState(value);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem('ridentrack.theme-mode', next).catch(() => {});
  };

  const resolved = mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;
  const palette = palettes[resolved];
  const isRideMode = resolved === 'ride';

  const value = useMemo(
    () => ({ mode, setMode, palette, isRideMode }),
    [mode, resolved, palette, isRideMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useRideTheme() {
  const context = useContext(ThemeContext);
  const systemScheme = useColorScheme();
  return context?.palette || palettes[systemScheme === 'light' ? 'light' : 'dark'];
}

export function useRideThemeSettings() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useRideThemeSettings must be used inside RideThemeProvider');
  return {
    mode: context.mode,
    setMode: context.setMode,
    isRideMode: context.isRideMode,
  };
}
