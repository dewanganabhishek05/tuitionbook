import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { batchDays, batchMonthAttendance, deleteBatch, getBatch, setBatchArchived } from '../../db/repo';
import { useDb, useLive } from '../../db/live';
import { addMonths, currentMonth, formatDay, formatMonth, formatTime, WEEKDAYS } from '../../lib/dates';
import { pct, rupees } from '../../lib/format';
import { Avatar, Badge, Button, Card, Divider, IconButton, Loading, Row, Screen, Section, Text, confirm } from '../../ui/kit';

export default function BatchDetail() {
  const db = useDb();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [month, setMonth] = useState(currentMonth());
  const batch = useLive((d) => getBatch(d, id), [id]);
  const att = useLive((d) => batchMonthAttendance(d, id, month), [id, month]);

  if (batch.loading || !att.data) return <Screen back><Loading /></Screen>;
  if (!batch.data) return <Screen back title="Batch not found"><Text tone="muted">It may have been deleted.</Text></Screen>;
  const b = batch.data;

  return (
    <Screen
      back
      title={b.name}
      subtitle={[batchDays(b).map((d) => WEEKDAYS[d]).join(', '), formatTime(b.start_time), b.default_fee ? `${rupees(b.default_fee)}/mo` : ''].filter(Boolean).join(' · ')}
      right={<IconButton name="create-outline" label="Edit batch" onPress={() => router.push({ pathname: '/batch/form', params: { id: String(id) } })} />}
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button label="Take attendance" icon="checkmark-done" onPress={() => router.push({ pathname: '/attendance/[batchId]', params: { batchId: String(id) } })} style={{ flex: 1 }} />
        <Button label="Student" icon="add" variant="secondary" onPress={() => router.push({ pathname: '/student/form', params: { batchId: String(id) } })} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <IconButton name="chevron-back" label="Previous month" onPress={() => setMonth(addMonths(month, -1))} />
        <Text v="heading" style={{ minWidth: 140, textAlign: 'center' }}>{formatMonth(month)}</Text>
        <IconButton name="chevron-forward" label="Next month" onPress={() => month < currentMonth() && setMonth(addMonths(month, 1))} />
      </View>

      <Section title={`Students · ${att.data.students.length}`}>
        <Card padded={false}>
          {att.data.students.length === 0 && <View style={{ padding: 16 }}><Text v="caption" tone="muted">No students yet.</Text></View>}
          {att.data.students.map((s, i) => {
            const counted = s.present + s.absent;
            const p = pct(s.present, counted);
            return (
              <View key={s.id}>
                {i > 0 && <Divider inset={68} />}
                <Row
                  left={<Avatar name={s.name} />}
                  title={s.name}
                  subtitle={counted ? `${s.present} present · ${s.absent} absent` : 'No classes marked'}
                  right={counted ? <Badge label={`${p}%`} tone={p < 75 ? 'warn' : 'good'} /> : null}
                  onPress={() => router.push({ pathname: '/student/[id]', params: { id: String(s.id) } })}
                />
              </View>
            );
          })}
        </Card>
      </Section>

      <Section title={`Classes marked · ${att.data.dates.length}`}>
        <Card padded={false}>
          {att.data.dates.length === 0 && <View style={{ padding: 16 }}><Text v="caption" tone="muted">Nothing marked this month.</Text></View>}
          {att.data.dates.map((d, i) => (
            <View key={d.date}>
              {i > 0 && <Divider inset={16} />}
              <Row
                title={formatDay(d.date)}
                subtitle={d.holiday === d.total ? 'Holiday' : `${d.present} present · ${d.absent} absent`}
                onPress={() => router.push({ pathname: '/attendance/[batchId]', params: { batchId: String(id), date: d.date } })}
              />
            </View>
          ))}
        </Card>
      </Section>

      <View style={{ gap: 10 }}>
        <Button
          label={b.archived ? 'Restore batch' : 'Archive batch'}
          variant="secondary"
          icon="archive-outline"
          onPress={async () => {
            if (b.archived || await confirm('Archive batch?', 'It will be hidden from Today and lists. Students and history are kept.', 'Archive')) {
              await setBatchArchived(db, id, !b.archived);
              if (!b.archived) router.back();
            }
          }}
        />
        <Button
          label="Delete batch"
          variant="danger"
          icon="trash-outline"
          onPress={async () => {
            if (await confirm('Delete batch?', 'This deletes its attendance history. Students stay, but are removed from this batch.', 'Delete', true)) {
              await deleteBatch(db, id);
              router.back();
            }
          }}
        />
      </View>
    </Screen>
  );
}
