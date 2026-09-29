import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { activeStudentCount, daySummary, getSettings, monthSummary } from '../../db/repo';
import { seedDemo } from '../../db/seed';
import { useDb, useLive } from '../../db/live';
import type { DaySummary } from '../../db/types';
import { addDays, currentMonth, formatDay, formatLongDate, formatMonth, today } from '../../lib/dates';
import { pct, rupees } from '../../lib/format';
import { Badge, Button, Card, Empty, Loading, Progress, Screen, Stat, Text, tap } from '../../ui/kit';
import { useTheme } from '../../ui/theme';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function TodayScreen() {
  const db = useDb();
  const { c } = useTheme();
  const [date, setDate] = useState(today());
  const [seeding, setSeeding] = useState(false);
  const count = useLive(activeStudentCount);
  const day = useLive((d) => daySummary(d, date), [date]);
  const fees = useLive((d) => monthSummary(d, currentMonth()));
  const settings = useLive(getSettings);

  const name = settings.data?.tutor_name?.trim().split(' ')[0];

  return (
    <Screen subtitle={formatLongDate(today())} title={name ? `${greeting()}, ${name}` : greeting()}>
      {count.loading ? <Loading /> : count.data === 0 ? (
        <Card>
          <Empty
            icon="people-outline"
            title="Add your first student"
            body="Add students with their monthly fee. Then take attendance here every day and track who has paid."
            action={
              <View style={{ gap: 8, alignItems: 'center' }}>
                <Button label="Add student" icon="add" onPress={() => router.push('/student/form')} />
                <Button
                  label="Try with sample data"
                  variant="ghost"
                  loading={seeding}
                  onPress={async () => { setSeeding(true); try { await seedDemo(db); } finally { setSeeding(false); } }}
                />
              </View>
            }
          />
        </Card>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
            <Text v="title">Attendance</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 999, borderWidth: 1, borderColor: c.border }}>
              <Pressable accessibilityLabel="Previous day" hitSlop={6} onPress={() => { tap(); setDate(addDays(date, -1)); }} style={{ padding: 8 }}>
                <Ionicons name="chevron-back" size={18} color={c.text} />
              </Pressable>
              <Pressable onPress={() => setDate(today())}>
                <Text v="label" style={{ minWidth: 92, textAlign: 'center' }}>{formatDay(date)}</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Next day" hitSlop={6} disabled={date >= today()}
                onPress={() => { tap(); setDate(addDays(date, 1)); }} style={{ padding: 8, opacity: date >= today() ? 0.3 : 1 }}
              >
                <Ionicons name="chevron-forward" size={18} color={c.text} />
              </Pressable>
            </View>
          </View>

          {day.data ? <AttendanceCard day={day.data} /> : <Loading />}

          {fees.data && fees.data.expected > 0 && (
            <Card onPress={() => router.navigate('/fees')}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <Text v="label" tone="muted">{formatMonth(currentMonth())} fees</Text>
                <Badge label={`${fees.data.cleared}/${fees.data.students} paid`} tone="neutral" />
              </View>
              <View style={{ flexDirection: 'row', marginBottom: 14 }}>
                <Stat label="Collected" value={rupees(fees.data.collected)} tone="good" />
                <Stat label="Pending" value={rupees(fees.data.pending)} tone={fees.data.pending > 0 ? 'bad' : undefined} />
              </View>
              <Progress value={pct(fees.data.collected, fees.data.expected)} />
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

function AttendanceCard({ day }: { day: DaySummary }) {
  const { c } = useTheme();
  const open = () => router.push({ pathname: '/attendance', params: { date: day.date } });
  const done = day.marked > 0;

  if (day.holiday) {
    return (
      <Card onPress={() => router.push({ pathname: '/day/[date]', params: { date: day.date } })} style={{ backgroundColor: c.warnSoft, borderColor: c.warnSoft }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Ionicons name="sunny" size={22} color={c.warn} />
          <View style={{ flex: 1 }}>
            <Text v="heading">Holiday</Text>
            {day.holiday_name ? <Text v="caption" tone="muted">{day.holiday_name}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.muted} />
        </View>
      </Card>
    );
  }

  if (day.expected === 0 && !done) {
    return (
      <Card>
        <Text v="caption" tone="muted">No students had joined by {formatDay(day.date).toLowerCase()}.</Text>
      </Card>
    );
  }

  if (!done) {
    return (
      <Card onPress={open}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text v="heading">{day.expected} {day.expected === 1 ? 'student' : 'students'}</Text>
            <View style={{ flexDirection: 'row' }}><Badge label="Not marked" tone="warn" /></View>
          </View>
          <View style={{ height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: c.accent, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="checkmark-done" size={18} color={c.accentText} />
            <Text v="label" tone="onAccent">Take attendance</Text>
          </View>
        </View>
      </Card>
    );
  }

  const items: [string, number, string][] = [
    ['Present', day.present, c.good], ['Absent', day.absent, c.bad], ['Leave', day.leave, c.warn],
  ];
  return (
    <Card onPress={open}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Badge label={`${day.present}/${day.marked} present`} tone="good" icon="checkmark" />
        <Text v="label" tone="accent">Edit</Text>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {items.map(([label, n, color]) => (
          <View key={label} style={{ flex: 1 }}>
            <Text v="number" style={{ color }}>{String(n)}</Text>
            <Text v="caption" tone="muted">{label}</Text>
          </View>
        ))}
      </View>
      {day.marked < day.expected && (
        <Text v="caption" tone="warn" style={{ marginTop: 10 }}>
          {day.expected - day.marked} not marked yet — tap to finish
        </Text>
      )}
    </Card>
  );
}
