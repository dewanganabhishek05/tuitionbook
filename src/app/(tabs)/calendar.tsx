import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { monthCalendar, monthStudentStats } from '../../db/repo';
import { useLive } from '../../db/live';
import { addMonths, currentMonth, formatDay, formatMonth, today } from '../../lib/dates';
import { pct } from '../../lib/format';
import { CalendarGrid, Legend } from '../../ui/CalendarGrid';
import { Avatar, Badge, Card, Divider, IconButton, Loading, Row, Screen, Section, Stat, Text } from '../../ui/kit';
import { useTheme } from '../../ui/theme';

export default function CalendarScreen() {
  const { c } = useTheme();
  const [month, setMonth] = useState(currentMonth());
  const days = useLive((d) => monthCalendar(d, month), [month]);
  const students = useLive((d) => monthStudentStats(d, month), [month]);
  const t = today();
  const maxMonth = addMonths(currentMonth(), 12);

  const byDate = new Map((days.data ?? []).map((d) => [d.date, d]));
  const taken = (days.data ?? []).filter((d) => d.marked > 0 && d.date <= t);
  const holidays = (days.data ?? []).filter((d) => d.holiday);
  const present = taken.reduce((a, d) => a + d.present, 0);
  const absent = taken.reduce((a, d) => a + d.absent, 0);
  const leaves = (days.data ?? []).filter((d) => d.leave > 0 && d.date > t);

  return (
    <Screen
      title="Calendar"
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 999, borderWidth: 1, borderColor: c.border, marginBottom: 2 }}>
          <IconButton name="chevron-back" label="Previous month" onPress={() => setMonth(addMonths(month, -1))} />
          <Text v="label" style={{ minWidth: 64, textAlign: 'center' }}>{formatMonth(month, false)}</Text>
          <IconButton name="chevron-forward" label="Next month" onPress={() => month < maxMonth && setMonth(addMonths(month, 1))} />
        </View>
      }
    >
      {!days.data ? <Loading /> : (
        <>
          <Card>
            <CalendarGrid
              month={month}
              onPress={(date) => router.push({ pathname: '/day/[date]', params: { date } })}
              look={(date) => {
                const d = byDate.get(date);
                if (!d) return {};
                if (d.holiday) return { bg: c.warnSoft, icon: 'sunny', iconColor: c.warn };
                if (date > t) return { fg: c.muted, dot: d.leave ? c.accent : undefined };
                if (d.marked > 0) {
                  const full = d.marked >= d.expected;
                  return { sub: `${d.present}/${d.expected}`, subColor: full ? c.good : c.warn };
                }
                return { fg: d.expected ? c.text : c.faint };
              }}
            />
            <Legend items={[
              { color: c.good, label: 'Taken (present/total)' },
              { color: c.warn, label: 'Partly taken' },
              { color: c.warn, label: 'Holiday', icon: 'sunny' },
              { color: c.accent, label: 'Planned leave' },
            ]} />
            <Text v="caption" tone="faint" style={{ textAlign: 'center', marginTop: 10 }}>
              Tap a date to see each student, mark a holiday or add leave.
            </Text>
          </Card>

          <Card>
            <View style={{ flexDirection: 'row' }}>
              <Stat label="Days taken" value={String(taken.length)} />
              <Stat label="Holidays" value={String(holidays.length)} />
              <Stat label="Attendance" value={present + absent ? `${pct(present, present + absent)}%` : '—'} tone={present + absent && pct(present, present + absent) < 75 ? 'warn' : 'good'} />
            </View>
          </Card>

          {(holidays.length > 0 || leaves.length > 0) && (
            <Section title="Holidays & planned leave">
              <Card padded={false}>
                {[...holidays, ...leaves].sort((a, b) => a.date.localeCompare(b.date)).map((d, i) => (
                  <View key={d.date + (d.holiday ? 'h' : 'l')}>
                    {i > 0 && <Divider inset={16} />}
                    <Row
                      title={formatDay(d.date)}
                      subtitle={d.holiday ? (d.holiday.name || 'Holiday') : `${d.leave} on leave`}
                      right={d.holiday ? <Badge label="Holiday" tone="warn" icon="sunny" /> : <Badge label="Leave" tone="accent" />}
                      onPress={() => router.push({ pathname: '/day/[date]', params: { date: d.date } })}
                    />
                  </View>
                ))}
              </Card>
            </Section>
          )}

          <Section title={`Students · ${formatMonth(month)}`}>
            <Card padded={false}>
              {!students.data ? <Loading /> : students.data.length === 0 ? (
                <View style={{ padding: 16 }}><Text v="caption" tone="muted">No students yet.</Text></View>
              ) : students.data.map((s, i) => {
                const counted = s.present + s.absent;
                const p = pct(s.present, counted);
                return (
                  <View key={s.id}>
                    {i > 0 && <Divider inset={68} />}
                    <Row
                      left={<Avatar name={s.name} />}
                      title={s.name}
                      subtitle={counted || s.leave ? `${s.present} present · ${s.absent} absent${s.leave ? ` · ${s.leave} leave` : ''}` : 'No classes marked'}
                      right={counted ? <Badge label={`${p}%`} tone={p < 75 ? 'warn' : 'good'} /> : null}
                      onPress={() => router.push({ pathname: '/student/[id]', params: { id: String(s.id) } })}
                    />
                  </View>
                );
              })}
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
