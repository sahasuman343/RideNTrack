import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, useColorScheme, ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/*
 * RideNTrack design system. See docs/DESIGN.md for the rationale behind each token.
 * Screens must read colours, spacing, radii and elevation from here rather than
 * hard-coding values, so light, dark and ride themes stay intentionally designed.
 */

export type ThemeMode = 'system' | 'light' | 'dark' | 'ride';
export type ColorScheme = 'light' | 'dark';

export type RidePalette = {
  scheme: ColorScheme;
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceHigh: string;
  text: string;
  textMuted: string;
  muted: string;
  subtle: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  green: string;
  greenSoft: string;
  tertiary: string;
  tertiarySoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  onDanger: string;
  input: string;
  shadow: string;
  scrim: string;
};

export const palettes: Record<'light' | 'dark' | 'ride', RidePalette> = {
  // Daylight: warm sand and chalk surfaces reduce glare; terracotta is deep enough for white labels.
  light: {
    scheme: 'light',
    background: '#F2F0E8',
    surface: '#FFFDF7',
    surfaceRaised: '#E9E6DC',
    surfaceHigh: '#DEDACD',
    text: '#1D2621',
    textMuted: '#5E6A62',
    muted: '#5E6A62',
    subtle: '#7E897F',
    border: '#D8D9CF',
    borderStrong: '#B9BCAF',
    accent: '#AD4C24',
    accentSoft: '#F4E2D6',
    onAccent: '#FFFFFF',
    green: '#2F6B50',
    greenSoft: '#E1ECE3',
    tertiary: '#2D5F86',
    tertiarySoft: '#DFE8EF',
    warning: '#94620F',
    warningSoft: '#F3E7CC',
    danger: '#B3402F',
    dangerSoft: '#F5DFDA',
    onDanger: '#FFFFFF',
    input: '#FFFDF7',
    shadow: 'rgba(29, 38, 33, 0.16)',
    scrim: 'rgba(16, 20, 18, 0.55)',
  },
  // Night: pine-tinted neutrals rather than an inverted light theme; desaturated accents avoid glare.
  dark: {
    scheme: 'dark',
    background: '#111A16',
    surface: '#18231E',
    surfaceRaised: '#202E27',
    surfaceHigh: '#2A3A32',
    text: '#ECEAE2',
    textMuted: '#A9B5AC',
    muted: '#A9B5AC',
    subtle: '#7D8B81',
    border: '#2B3B33',
    borderStrong: '#3E5246',
    accent: '#E2804F',
    accentSoft: 'rgba(226, 128, 79, 0.16)',
    onAccent: '#1A120D',
    green: '#86BFA0',
    greenSoft: 'rgba(134, 191, 160, 0.16)',
    tertiary: '#8DB4D4',
    tertiarySoft: 'rgba(141, 180, 212, 0.16)',
    warning: '#E3B65E',
    warningSoft: 'rgba(227, 182, 94, 0.16)',
    danger: '#EE8577',
    dangerSoft: 'rgba(238, 133, 119, 0.16)',
    onDanger: '#1A0E0C',
    input: '#141E19',
    shadow: '#000000',
    scrim: 'rgba(0, 0, 0, 0.6)',
  },
  // Ride HUD: maximum contrast for handlebar glances; saturated status colours are functional, not decorative.
  ride: {
    scheme: 'dark',
    background: '#050706',
    surface: '#0D110F',
    surfaceRaised: '#141A17',
    surfaceHigh: '#1C2420',
    text: '#FFFFFF',
    textMuted: '#B4C4BA',
    muted: '#B4C4BA',
    subtle: '#7F9488',
    border: '#2E3D35',
    borderStrong: '#46594E',
    accent: '#FF8A3D',
    accentSoft: 'rgba(255, 138, 61, 0.22)',
    onAccent: '#0A0A0A',
    green: '#3DDC84',
    greenSoft: 'rgba(61, 220, 132, 0.2)',
    tertiary: '#5CC8FF',
    tertiarySoft: 'rgba(92, 200, 255, 0.2)',
    warning: '#FFC247',
    warningSoft: 'rgba(255, 194, 71, 0.2)',
    danger: '#FF5A4D',
    dangerSoft: 'rgba(255, 90, 77, 0.24)',
    onDanger: '#0A0A0A',
    input: '#0D110F',
    shadow: '#000000',
    scrim: 'rgba(0, 0, 0, 0.7)',
  },
};

/** 4pt grid. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  screen: 20,
} as const;

/** Restrained radii: square-ish controls read as tools, not toys. */
export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  sheet: 24,
  round: 9999, // avatars and status dots only
} as const;

export type ElevationLevel = 'none' | 'floating' | 'overlay' | 'sheet';

/**
 * Shadows are reserved for elements that physically float above the map or content
 * (FABs, banners, sheets). In-flow content separates with borders, never shadows.
 */
export function elevation(level: ElevationLevel, c: RidePalette): ViewStyle {
  const strong = c.scheme === 'dark';
  switch (level) {
    case 'floating':
      return { shadowColor: c.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: strong ? 0.4 : 0.18, shadowRadius: 12, elevation: 4 };
    case 'overlay':
      return { shadowColor: c.shadow, shadowOffset: { width: 0, height: 6 }, shadowOpacity: strong ? 0.45 : 0.22, shadowRadius: 16, elevation: 8 };
    case 'sheet':
      return { shadowColor: c.shadow, shadowOffset: { width: 0, height: -4 }, shadowOpacity: strong ? 0.35 : 0.12, shadowRadius: 16, elevation: 12 };
    default:
      return {};
  }
}

const telemetryFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export const typography = {
  displayTelemetry: {
    fontFamily: telemetryFont,
    fontSize: 48,
    fontWeight: '700' as const,
    letterSpacing: -1,
    fontVariant: ['tabular-nums' as const],
  },
  headlineLg: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800' as const,
    letterSpacing: -0.4,
  },
  headlineMd: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700' as const,
    letterSpacing: -0.3,
  },
  headlineSm: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700' as const,
  },
  labelNumeric: {
    fontSize: 18,
    fontWeight: '700' as const,
    fontVariant: ['tabular-nums' as const],
  },
  labelCaps: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
  titleMd: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700' as const,
  },
  bodyLg: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
  },
  bodyMd: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
  },
  bodySm: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as const,
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
