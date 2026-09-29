import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { getBatchDays, getSettings, monthSummary } from '../../db/repo';
import { seedDemo } from '../../db/seed';
import { useDb, useLive } from '../../db/live';
import type { BatchDay } from '../../db/types';
import { addDays, currentMonth, formatDay, formatLongDate, formatMonth, formatTime, isoWeekday, parseISODate, today, WEEKDAYS } from '../../lib/dates';
import { pct, rupees } from '../../lib/format';
import { Badge, Button, Card, Empty, Loading, Progress, Screen, Section, Stat, Text, tap } from '../../ui/kit';
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
  const days = useLive((d) => getBatchDays(d, date), [date]);
  const fees = useLive((d) => monthSummary(d, currentMonth()));
  const settings = useLive(getSettings);

  const name = settings.data?.tutor_name?.trim().split(' ')[0];
  const d = parseISODate(date);
  const scheduled = days.data?.filter((x) => x.scheduled) ?? [];
  const others = days.data?.filter((x) => !x.scheduled) ?? [];

  return (
    <Screen
      subtitle={formatLongDate(today())}
      title={name ? `${greeting()}, ${name}` : greeting()}
    >
      {days.loading ? <Loading /> : days.data!.length === 0 ? (
        <Card>
          <Empty
            icon="school-outline"
            title="Set up your first batch"
            body="A batch is a class group, like “Class 10 · Maths · 5 PM”. Add one, then add students to it."
            action={
              <View style={{ gap: 8, alignItems: 'center' }}>
                <Button label="Create a batch" icon="add" onPress={() => router.push('/batch/form')} />
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

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 4 }}>
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

          <Section title={scheduled.length ? `Scheduled · ${WEEKDAYS[isoWeekday(date)]} ${d.getDate()}` : 'No classes scheduled this day'}>
            {scheduled.map((b) => <BatchCard key={b.batch.id} day={b} date={date} />)}
          </Section>

          {others.length > 0 && (
            <Section title="Other batches">
              {others.map((b) => <BatchCard key={b.batch.id} day={b} date={date} compact />)}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}

function BatchCard({ day, date, compact }: { day: BatchDay; date: string; compact?: boolean }) {
  const { c } = useTheme();
  const { batch } = day;
  const done = day.marked > 0;
  const open = () => router.push({ pathname: '/attendance/[batchId]', params: { batchId: String(batch.id), date } });

  const status = day.holiday
    ? <Badge label="Holiday" tone="neutral" icon="sunny-outline" />
    : done
      ? <Badge label={`${day.present}/${day.marked} present`} tone="good" icon="checkmark" />
      : <Badge label="Not marked" tone={compact ? 'neutral' : 'warn'} />;

  return (
    <Card onPress={open} style={compact ? { paddingVertical: 12 } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        {!compact && (
          <View style={{ width: 56, alignItems: 'flex-start' }}>
            <Text v="heading">{formatTime(batch.start_time).split(' ')[0] || '—'}</Text>
            <Text v="caption" tone="muted">{formatTime(batch.start_time).split(' ')[1] ?? ''}</Text>
          </View>
        )}
        <View style={{ flex: 1, gap: 6 }}>
          <Text v="heading" numberOfLines={1}>{batch.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text v="caption" tone="muted">{batch.student_count} students</Text>
            {status}
          </View>
        </View>
        <View style={{
          width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
          backgroundColor: done ? c.surface2 : c.accent,
        }}>
          <Ionicons name={done ? 'create-outline' : 'checkmark-done'} size={20} color={done ? c.text : c.accentText} />
        </View>
      </View>
    </Card>
  );
}
