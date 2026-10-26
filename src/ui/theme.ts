import 'expo-sqlite/localStorage/install'; // synchronous localStorage on phones (the browser has its own)
import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

const light = {
  bg: '#F4F5FC',
  surface: '#FFFFFF',
  surface2: '#EDEFFB',
  text: '#14142B',
  muted: '#62667E',
  faint: '#A3A7BD',
  border: '#E4E6F4',
  accent: '#5B5CF0',
  accentText: '#FFFFFF',
  accentSoft: '#E8E9FE',
  good: '#15803D',
  goodSoft: '#E2F6E9',
  warn: '#B45F06',
  warnSoft: '#FEF1D6',
  bad: '#D92D3A',
  badSoft: '#FDE8EA',
  overlay: 'rgba(20,20,43,0.38)',
  shadow: '#3B3F9A',
};

const dark: typeof light = {
  bg: '#0E0F1F',
  surface: '#181A33',
  surface2: '#23254A',
  text: '#F2F3FF',
  muted: '#A0A4C2',
  faint: '#6A6E92',
  border: '#2A2D54',
  accent: '#7B7EFF',
  accentText: '#0B0B22',
  accentSoft: '#26285A',
  good: '#6BD48F',
  goodSoft: '#173222',
  warn: '#F2B35E',
  warnSoft: '#372A12',
  bad: '#FF7B82',
  badSoft: '#3B1A1F',
  overlay: 'rgba(0,0,0,0.6)',
  shadow: '#000000',
};

export type Colors = typeof light;

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

export const radius = { sm: 12, md: 16, lg: 24, pill: 999 };
export const space = (n: number) => n * 4;

/* ---------------------------------------------------------- appearance */

export type ThemeMode = 'light' | 'dark';
const MODE_KEY = 'appearance';

function readMode(): ThemeMode {
  try {
    return globalThis.localStorage.getItem(MODE_KEY) === 'dark' ? 'dark' : 'light'; // Light is the default
  } catch {
    return 'light';
  }
}

let mode: ThemeMode = readMode();
const listeners = new Set<() => void>();
try { Appearance.setColorScheme(mode); } catch { /* not supported everywhere */ }

export function getThemeMode(): ThemeMode {
  return mode;
}

export function setThemeMode(next: ThemeMode) {
  if (next === mode) return;
  mode = next;
  try { globalThis.localStorage.setItem(MODE_KEY, next); } catch { /* keep the in-memory choice */ }
  try { Appearance.setColorScheme(next); } catch { /* not supported everywhere */ }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useTheme() {
  const m = useSyncExternalStore(subscribe, getThemeMode, getThemeMode);
  return { c: m === 'dark' ? dark : light, dark: m === 'dark', mode: m };
}

/** Soft card shadow used across the app (light mode only; dark mode relies on surface contrast). */
export function cardShadow(c: Colors, dark: boolean) {
  return dark
    ? {}
    : { shadowColor: c.shadow, shadowOpacity: 0.07, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 2 };
}

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';

export function toneColors(c: Colors, tone: Tone) {
  switch (tone) {
    case 'accent':
      return { fg: c.accent, bg: c.accentSoft };
    case 'good':
      return { fg: c.good, bg: c.goodSoft };
    case 'warn':
      return { fg: c.warn, bg: c.warnSoft };
    case 'bad':
      return { fg: c.bad, bg: c.badSoft };
    default:
      return { fg: c.muted, bg: c.surface2 };
  }
}
