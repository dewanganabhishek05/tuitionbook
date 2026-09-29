import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text as RNText,
  TextInput, View, useWindowDimensions, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { initials } from '../lib/format';
import { font, radius, toneColors, useTheme, type Tone } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Back if there is somewhere to go back to, otherwise home (e.g. after opening a deep link). */
export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export function tap() {
  if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
}

/* --------------------------------------------------------------------- text */

type TextVariant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'number';

export function Text({
  v = 'body', tone, style, children, numberOfLines,
}: {
  v?: TextVariant; tone?: 'muted' | 'faint' | 'accent' | 'good' | 'warn' | 'bad' | 'onAccent';
  style?: StyleProp<TextStyle>; children: ReactNode; numberOfLines?: number;
}) {
  const { c } = useTheme();
  const color = tone
    ? { muted: c.muted, faint: c.faint, accent: c.accent, good: c.good, warn: c.warn, bad: c.bad, onAccent: c.accentText }[tone]
    : c.text;
  return (
    <RNText numberOfLines={numberOfLines} style={[typo[v], { color }, style]}>
      {children}
    </RNText>
  );
}

const typo = StyleSheet.create({
  display: { fontFamily: font.bold, fontSize: 30, letterSpacing: -0.9, lineHeight: 36 },
  title: { fontFamily: font.semibold, fontSize: 20, letterSpacing: -0.4, lineHeight: 26 },
  heading: { fontFamily: font.semibold, fontSize: 16, letterSpacing: -0.2, lineHeight: 22 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 21 },
  label: { fontFamily: font.medium, fontSize: 13, letterSpacing: 0.1, lineHeight: 18 },
  caption: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  number: { fontFamily: font.semibold, fontSize: 24, letterSpacing: -0.6, lineHeight: 30 },
});

/* ------------------------------------------------------------------ layout */

export function Screen({
  title, subtitle, right, children, scroll = true, back, footer,
}: {
  title?: string; subtitle?: string; right?: ReactNode; children: ReactNode;
  scroll?: boolean; back?: boolean; footer?: ReactNode;
}) {
  const { c } = useTheme();
  const header = (title || back) && (
    <View style={{ paddingHorizontal: 20, paddingTop: back ? 4 : 12, paddingBottom: 12 }}>
      {back && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginLeft: -8 }}>
          <IconButton name="chevron-back" onPress={goBack} label="Back" />
          {right}
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          {subtitle ? <Text v="label" tone="muted" style={{ marginBottom: 2 }}>{subtitle}</Text> : null}
          {title ? <Text v="display" numberOfLines={2}>{title}</Text> : null}
        </View>
        {!back && right}
      </View>
    </View>
  );
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ paddingBottom: footer ? 24 : 120 }} keyboardShouldPersistTaps="handled">
          {header}
          <View style={{ paddingHorizontal: 20, gap: 16 }}>{children}</View>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          {header}
          {children}
        </View>
      )}
      {footer}
    </SafeAreaView>
  );
}

export function Footer({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{
      paddingHorizontal: 20, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 12) + 4,
      backgroundColor: c.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
      flexDirection: 'row', gap: 10,
    }}>
      {children}
    </View>
  );
}

export function Card({ children, style, onPress, padded = true }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padded?: boolean;
}) {
  const { c } = useTheme();
  const base: ViewStyle = {
    backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border, padding: padded ? 16 : 0, overflow: 'hidden',
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={({ pressed }) => [base, pressed && { opacity: 0.7 }, style]}>
      {children}
    </Pressable>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }}>
        <Text v="label" tone="muted">{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: inset }} />;
}

export function Row({
  title, subtitle, left, right, onPress, chevron = !!onPress,
}: {
  title: string; subtitle?: string | null; left?: ReactNode; right?: ReactNode; onPress?: () => void; chevron?: boolean;
}) {
  const { c } = useTheme();
  const body = (
    <>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text v="heading" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text v="caption" tone="muted" numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
      {chevron && <Ionicons name="chevron-forward" size={18} color={c.faint} />}
    </>
  );
  const style: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, minHeight: 60 };
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={({ pressed }) => [style, pressed && { backgroundColor: c.surface2 }]}>
      {body}
    </Pressable>
  );
}

/* -------------------------------------------------------------- small bits */

export function Avatar({ name, size = 40, tone = 'neutral' }: { name: string; size?: number; tone?: Tone }) {
  const { c } = useTheme();
  const t = toneColors(c, tone);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
      <RNText style={{ fontFamily: font.semibold, fontSize: size * 0.36, color: tone === 'neutral' ? c.text : t.fg }}>
        {initials(name)}
      </RNText>
    </View>
  );
}

export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const { c } = useTheme();
  const t = toneColors(c, tone);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.bg, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill }}>
      {icon && <Ionicons name={icon} size={12} color={t.fg} />}
      <RNText style={{ fontFamily: font.medium, fontSize: 12, color: t.fg }}>{label}</RNText>
    </View>
  );
}

export function Button({
  label, onPress, variant = 'primary', icon, loading, disabled, style, size = 'md',
}: {
  label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; size?: 'sm' | 'md';
}) {
  const { c } = useTheme();
  const palette = {
    primary: { bg: c.accent, fg: c.accentText, border: c.accent },
    secondary: { bg: c.surface, fg: c.text, border: c.border },
    ghost: { bg: 'transparent', fg: c.accent, border: 'transparent' },
    danger: { bg: c.badSoft, fg: c.bad, border: c.badSoft },
  }[variant];
  const h = size === 'sm' ? 38 : 50;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [{
        height: h, borderRadius: radius.pill, paddingHorizontal: size === 'sm' ? 14 : 20,
        backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      }, style]}
    >
      {loading ? <ActivityIndicator color={palette.fg} /> : icon ? <Ionicons name={icon} size={size === 'sm' ? 16 : 18} color={palette.fg} /> : null}
      <RNText style={{ fontFamily: font.semibold, fontSize: size === 'sm' ? 14 : 15, color: palette.fg }}>{label}</RNText>
    </Pressable>
  );
}

export function IconButton({ name, onPress, label, tone }: { name: IconName; onPress: () => void; label: string; tone?: 'accent' | 'good' }) {
  const { c } = useTheme();
  const color = tone === 'accent' ? c.accent : tone === 'good' ? c.good : c.text;
  return (
    <Pressable
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.surface2 : 'transparent' })}
    >
      <Ionicons name={name} size={22} color={color} />
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => { tap(); onPress(); }}
      style={{
        paddingHorizontal: 14, height: 34, borderRadius: radius.pill, justifyContent: 'center',
        backgroundColor: selected ? c.text : c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: selected ? c.text : c.border,
      }}
    >
      <RNText style={{ fontFamily: font.medium, fontSize: 13, color: selected ? c.bg : c.text }}>{label}</RNText>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}>
      {children}
    </ScrollView>
  );
}

export function Segmented<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.surface2, borderRadius: radius.pill, padding: 3 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => { tap(); onChange(o.value); }}
            style={{ flex: 1, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.surface : 'transparent' }}
          >
            <RNText style={{ fontFamily: on ? font.semibold : font.medium, fontSize: 13, color: on ? c.text : c.muted }}>{o.label}</RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ label, hint, error, style, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text v="label" tone="muted">{label}</Text> : null}
      <TextInput
        placeholderTextColor={c.faint}
        {...props}
        style={[{
          minHeight: 50, borderRadius: radius.md, backgroundColor: c.surface, paddingHorizontal: 14,
          borderWidth: 1, borderColor: error ? c.bad : c.border, color: c.text, fontFamily: font.regular, fontSize: 16,
        }, props.multiline && { minHeight: 90, paddingTop: 14, textAlignVertical: 'top' }, style]}
      />
      {error ? <Text v="caption" tone="bad">{error}</Text> : hint ? <Text v="caption" tone="faint">{hint}</Text> : null}
    </View>
  );
}

export function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'accent'; sub?: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text v="caption" tone="muted">{label}</Text>
      <Text v="number" tone={tone}>{value}</Text>
      {sub ? <Text v="caption" tone="faint">{sub}</Text> : null}
    </View>
  );
}

export function Progress({ value, tone = 'good' }: { value: number; tone?: Tone }) {
  const { c } = useTheme();
  const t = toneColors(c, tone);
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: c.surface2, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', borderRadius: 4, backgroundColor: t.fg }} />
    </View>
  );
}

export function Empty({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24, gap: 8 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
        <Ionicons name={icon} size={26} color={c.muted} />
      </View>
      <Text v="heading" style={{ textAlign: 'center' }}>{title}</Text>
      {body ? <Text v="caption" tone="muted" style={{ textAlign: 'center' }}>{body}</Text> : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  );
}

export function Fab({ icon = 'add', label, onPress }: { icon?: IconName; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => ({
        position: 'absolute', right: 20, bottom: 20, height: 54, paddingHorizontal: 20, borderRadius: 27,
        backgroundColor: c.accent, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.85 : 1,
        shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6,
      })}
    >
      <Ionicons name={icon} size={22} color={c.accentText} />
      <RNText style={{ fontFamily: font.semibold, fontSize: 15, color: c.accentText }}>{label}</RNText>
    </Pressable>
  );
}

/**
 * Bottom sheet. Tall content scrolls inside it (capped at ~85% of the screen), and `footer`
 * stays pinned at the bottom so its buttons are always reachable.
 */
export function Sheet({ visible, onClose, title, children, footer }: {
  visible: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: c.overlay }} onPress={onClose} />
      <View style={{
        maxHeight: height * 0.85, backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingTop: 20, paddingBottom: Math.max(insets.bottom, 16) + 8,
      }}>
        <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, marginTop: -8, marginBottom: 14 }} />
        <Text v="title" style={{ paddingHorizontal: 20, marginBottom: 14 }}>{title}</Text>
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={{ paddingHorizontal: 20, paddingTop: 14, gap: 10 }}>{footer}</View> : null}
      </View>
    </Modal>
  );
}

export function Loading() {
  const { c } = useTheme();
  return (
    <View style={{ paddingVertical: 48, alignItems: 'center' }}>
      <ActivityIndicator color={c.muted} />
    </View>
  );
}

/* ------------------------------------------------------------ dialogs */

export function confirm(title: string, message: string, okLabel = 'OK', destructive = false): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}
