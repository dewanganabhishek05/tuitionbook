import { useColorScheme } from 'react-native';

const light = {
  bg: '#F6F6F3',
  surface: '#FFFFFF',
  surface2: '#EFEFEA',
  text: '#15151A',
  muted: '#6E6E73',
  faint: '#A1A1A6',
  border: '#E7E7E1',
  accent: '#4338CA',
  accentText: '#FFFFFF',
  accentSoft: '#ECEBFF',
  good: '#15803D',
  goodSoft: '#E3F5E8',
  warn: '#B45309',
  warnSoft: '#FDF0DC',
  bad: '#D92D20',
  badSoft: '#FDE9E7',
  overlay: 'rgba(15,15,20,0.35)',
};

const dark: typeof light = {
  bg: '#0D0D10',
  surface: '#17171B',
  surface2: '#212127',
  text: '#F3F3F5',
  muted: '#9C9CA3',
  faint: '#65656C',
  border: '#27272E',
  accent: '#A5A1FF',
  accentText: '#131230',
  accentSoft: '#23224A',
  good: '#6BD48F',
  goodSoft: '#16301F',
  warn: '#F2B35E',
  warnSoft: '#35270F',
  bad: '#FF7B72',
  badSoft: '#3A1716',
  overlay: 'rgba(0,0,0,0.55)',
};

export type Colors = typeof light;

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

export const radius = { sm: 10, md: 14, lg: 20, pill: 999 };
export const space = (n: number) => n * 4;

export function useTheme() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? dark : light;
  return { c, dark: scheme === 'dark' };
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
