import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { addDays, daysInMonth, isoWeekday, today } from '../lib/dates';
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

/**
 * Normal Sunday-first month grid with whole weeks (neighbouring months' dates shown faded).
 * Sundays are shown but disabled (no class), as are the neighbouring-month dates.
 * `look` styles each day; `onPress` makes the other days tappable.
 */
export function CalendarGrid({
  month, look, onPress, selected,
}: { month: string; look: (date: string) => DayLook; onPress?: (date: string) => void; selected?: string }) {
  const { c } = useTheme();
  const n = daysInMonth(month);
  const first = `${month}-01`;
  const lead = isoWeekday(first) % 7; // Sunday = 0
  const total = Math.ceil((lead + n) / 7) * 7;
  const cells = Array.from({ length: total }, (_, i) => addDays(first, i - lead));
  const t = today();

  return (
    <View>
      <View style={{ flexDirection: 'row' }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
          <Text key={d} v="caption" tone="faint" style={{ flex: 1, textAlign: 'center', marginBottom: 8, opacity: i === 0 ? 0.7 : 1 }}>{d}</Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((date) => {
          const inMonth = date.startsWith(month);
          const sunday = isoWeekday(date) === 7;
          const off = !inMonth || sunday; // disabled cells
          const l = inMonth && !sunday ? look(date) : {};
          const isToday = date === t;
          const isSel = date === selected;
          return (
            <View key={date} style={{ width: `${100 / 7}%`, aspectRatio: 0.9, padding: 2.5 }}>
              <Pressable
                accessibilityLabel={`Day ${date}`}
                accessibilityState={{ disabled: off || !onPress }}
                disabled={off || !onPress}
                onPress={() => { tap(); onPress?.(date); }}
                style={({ pressed }) => ({
                  flex: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 1,
                  backgroundColor: isToday && !off ? c.accentSoft : l.bg ?? 'transparent',
                  borderWidth: (isToday || isSel) && !off ? 1.5 : 0,
                  borderColor: isSel ? c.text : c.accent,
                  opacity: off ? 0.38 : pressed ? 0.6 : 1,
                })}
              >
                <Text v="label" style={{ color: off ? c.muted : l.fg ?? (isToday ? c.accent : c.text), fontFamily: isToday && !off ? font.bold : font.medium }}>
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
