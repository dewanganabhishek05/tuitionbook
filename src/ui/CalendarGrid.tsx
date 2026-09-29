import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { daysInMonth, isoWeekday, today } from '../lib/dates';
import { Text, tap, type IconName } from './kit';
import { font, useTheme } from './theme';

export interface DayLook {
  bg?: string;
  fg?: string;
  /** Small line under the number, e.g. "12/14". */
  sub?: string;
  subColor?: string;
  icon?: IconName;
  iconColor?: string;
  dot?: string;
}

/** Monday-first month grid. `look` styles each day; `onPress` makes days tappable. */
export function CalendarGrid({
  month, look, onPress, selected,
}: { month: string; look: (date: string) => DayLook; onPress?: (date: string) => void; selected?: string }) {
  const { c } = useTheme();
  const n = daysInMonth(month);
  const lead = isoWeekday(`${month}-01`) - 1;
  const cells: (string | null)[] = [
    ...Array(lead).fill(null),
    ...Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
  const t = today();

  return (
    <View>
      <View style={{ flexDirection: 'row' }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={i} v="caption" tone="faint" style={{ flex: 1, textAlign: 'center', marginBottom: 6 }}>{d}</Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((date, i) => {
          if (!date) return <View key={i} style={{ width: `${100 / 7}%`, aspectRatio: 0.9 }} />;
          const l = look(date);
          const isToday = date === t;
          const isSel = date === selected;
          return (
            <View key={date} style={{ width: `${100 / 7}%`, aspectRatio: 0.9, padding: 2.5 }}>
              <Pressable
                accessibilityLabel={`Day ${date}`}
                disabled={!onPress}
                onPress={() => { tap(); onPress?.(date); }}
                style={({ pressed }) => ({
                  flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 1,
                  backgroundColor: l.bg ?? 'transparent',
                  borderWidth: isToday || isSel ? 1.5 : 0,
                  borderColor: isSel ? c.text : c.accent,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text v="label" style={{ color: l.fg ?? c.text, fontFamily: isToday ? font.bold : font.medium }}>
                  {String(Number(date.slice(8)))}
                </Text>
                {l.icon ? <Ionicons name={l.icon} size={11} color={l.iconColor ?? c.muted} /> : null}
                {l.sub ? (
                  <Text v="caption" style={{ fontSize: 9.5, lineHeight: 11, color: l.subColor ?? c.muted }}>{l.sub}</Text>
                ) : null}
                {l.dot ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: l.dot }} /> : null}
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function Legend({ items }: { items: { color: string; label: string; icon?: IconName }[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'center', marginTop: 12 }}>
      {items.map((it) => (
        <View key={it.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {it.icon
            ? <Ionicons name={it.icon} size={12} color={it.color} />
            : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: it.color }} />}
          <Text v="caption" tone="muted">{it.label}</Text>
        </View>
      ))}
    </View>
  );
}
