import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import { clearRoll, daySummary, getHoliday, getRoll, removeHoliday, setHoliday, setMark } from '../../db/repo';
import { useDb, useLive } from '../../db/live';
import type { AttendanceStatus, RollEntry } from '../../db/types';
import { daysBetween, formatDay, formatLongDate, isValidISODate, today } from '../../lib/dates';
import {
  Avatar, Badge, Button, Card, Chip, Divider, Empty, Field, IconButton, Loading, Row, Screen, Section, Sheet, Text,
  confirm, notify,
} from '../../ui/kit';
import { useTheme, type Tone } from '../../ui/theme';

const STATUS: Record<AttendanceStatus, { label: string; tone: Tone }> = {
  present: { label: 'Present', tone: 'good' },
  absent: { label: 'Absent', tone: 'bad' },
  leave: { label: 'Leave', tone: 'warn' },
};

function relative(date: string) {
  const n = daysBetween(today(), date);
  if (Math.abs(n) <= 1) return formatDay(date);
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

export default function DayScreen() {
  const db = useDb();
  const { c } = useTheme();
  const raw = useLocalSearchParams<{ date: string }>().date;
  const date = isValidISODate(raw ?? '') ? raw : today();
  const future = date > today();

  const roll = useLive((d) => getRoll(d, date), [date]);
  const sum = useLive((d) => daySummary(d, date), [date]);
  const hol = useLive(async (d) => (await getHoliday(d, date)) ?? false, [date]);

  const [holidaySheet, setHolidaySheet] = useState(false);
  const [holidayName, setHolidayName] = useState('');
  const [editing, setEditing] = useState<RollEntry | null>(null);

  if (!roll.data || !sum.data || hol.data === undefined) return <Screen back><Loading /></Screen>;

  const holiday = hol.data || null;
  const s = sum.data;
  const notMarked = Math.max(0, s.expected - s.marked);

  const openHolidaySheet = () => {
    setHolidayName(holiday ? holiday.name : '');
    setHolidaySheet(true);
  };

  const saveHoliday = async () => {
    if (!holiday && s.marked > 0) {
      const ok = await confirm('Mark as holiday?', `This removes the ${s.marked} attendance ${s.marked === 1 ? 'mark' : 'marks'} saved for this day.`, 'Mark holiday', true);
      if (!ok) return;
    }
    await setHoliday(db, date, holidayName);
    setHolidaySheet(false);
  };

  return (
    <Screen back subtitle={relative(date)} title={formatLongDate(date)}>
      {holiday ? (
        <Card style={{ backgroundColor: c.warnSoft, borderColor: c.warnSoft }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Ionicons name="sunny" size={26} color={c.warn} />
            <View style={{ flex: 1 }}>
              <Text v="heading">Holiday</Text>
              <Text v="caption" tone="muted">{holiday.name || 'No class this day'}</Text>
            </View>
            <IconButton name="create-outline" label="Rename holiday" onPress={openHolidaySheet} />
          </View>
          <Button
            label="Remove holiday"
            variant="secondary"
            size="sm"
            style={{ marginTop: 12, alignSelf: 'flex-start' }}
            onPress={async () => {
              if (await confirm('Remove holiday?', 'This day will be a normal class day again.', 'Remove')) await removeHoliday(db, date);
            }}
          />
        </Card>
      ) : future ? (
        <Card>
          <Text v="heading">Upcoming day</Text>
          <Text v="caption" tone="muted" style={{ marginTop: 4 }}>
            Plan ahead: mark it as a holiday, or tap a student below to add leave.
            {s.leave ? ` ${s.leave} on leave so far.` : ''}
          </Text>
        </Card>
      ) : (
        <Card>
          <View style={{ flexDirection: 'row' }}>
            {([
              ['Present', s.present, c.good], ['Absent', s.absent, c.bad], ['Leave', s.leave, c.warn], ['Not marked', notMarked, c.muted],
            ] as [string, number, string][]).map(([label, n, color]) => (
              <View key={label} style={{ flex: 1 }}>
                <Text v="number" style={{ color }}>{String(n)}</Text>
                <Text v="caption" tone="muted">{label}</Text>
              </View>
            ))}
          </View>
        </Card>
      )}

      {!future && !holiday && (
        <Button
          label={s.marked ? 'Edit attendance' : 'Take attendance'}
          icon="checkmark-done"
          onPress={() => router.push({ pathname: '/attendance', params: { date } })}
        />
      )}
      {(!holiday || (!future && s.marked > 0)) && (
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          {!holiday && (
            <Button label="Mark holiday" icon="sunny-outline" variant="secondary" onPress={openHolidaySheet} style={{ flex: 1 }} />
          )}
          {!future && s.marked > 0 && (
            <IconButton
              name="trash-outline"
              label="Clear day"
              onPress={async () => {
                if (await confirm('Clear this day?', 'Removes all attendance marks for this date.', 'Clear', true)) await clearRoll(db, date);
              }}
            />
          )}
        </View>
      )}

      <Section title={`Students · ${roll.data.length}`}>
        {roll.data.length === 0 ? (
          <Card>
            <Empty icon="people-outline" title="No students on this date" body="Only students who had joined by this date are listed." />
          </Card>
        ) : (
          <Card padded={false}>
            {roll.data.map((r, i) => (
              <View key={r.student_id}>
                {i > 0 && <Divider inset={68} />}
                <Row
                  left={<Avatar name={r.name} tone={r.status === 'absent' ? 'bad' : r.status === 'leave' ? 'warn' : 'neutral'} />}
                  title={r.name}
                  subtitle={r.status === 'leave' && r.note ? `Leave: ${r.note}` : r.class_name || null}
                  chevron={false}
                  onPress={holiday ? undefined : () => setEditing(r)}
                  right={
                    holiday ? <Badge label="Holiday" tone="warn" icon="sunny" />
                      : r.status ? <Badge {...STATUS[r.status]} />
                        : <Badge label={future ? '—' : 'Not marked'} tone="neutral" />
                  }
                />
              </View>
            ))}
          </Card>
        )}
        {!holiday && roll.data.length > 0 && (
          <Text v="caption" tone="faint" style={{ textAlign: 'center' }}>
            {future ? 'Tap a student to add planned leave.' : 'Tap a student to change their mark or add leave with a reason.'}
          </Text>
        )}
      </Section>

      <Sheet visible={holidaySheet} onClose={() => setHolidaySheet(false)} title={holiday ? 'Rename holiday' : 'Mark as holiday'} footer={<><Button label={holiday ? 'Save' : 'Mark as holiday'} icon="sunny" onPress={saveHoliday} /></>}>
        <KeyboardAvoidingView behavior="padding">
          <Field label="Name (optional)" value={holidayName} onChangeText={setHolidayName} placeholder="e.g. Diwali, Exam break" autoFocus />
        </KeyboardAvoidingView>
      </Sheet>

      <MarkSheet entry={editing} date={date} future={future} onClose={() => setEditing(null)}
        onSave={async (status, note) => {
          try {
            await setMark(db, date, editing!.student_id, status, note);
            setEditing(null);
          } catch (e) {
            notify('Could not save', (e as Error).message);
          }
        }}
      />
    </Screen>
  );
}

function MarkSheet({ entry, date, future, onClose, onSave }: {
  entry: RollEntry | null; date: string; future: boolean; onClose: () => void;
  onSave: (status: AttendanceStatus | null, note: string) => void;
}) {
  const [status, setStatus] = useState<AttendanceStatus | null>(null);
  const [note, setNote] = useState('');
  const [forId, setForId] = useState<number | null>(null);
  if (entry && forId !== entry.student_id) {
    setForId(entry.student_id);
    setStatus(entry.status ?? (future ? 'leave' : null));
    setNote(entry.note ?? '');
  }
  if (!entry && forId !== null) setForId(null);

  return (
    <Sheet visible={!!entry} onClose={onClose} title={entry ? entry.name : ''} footer={
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {entry?.status ? (
          <Button label="Clear mark" variant="secondary" onPress={() => onSave(null, '')} style={{ flex: 1 }} />
        ) : null}
        <Button label="Save" icon="checkmark" disabled={!status} onPress={() => status && onSave(status, status === 'leave' ? note : '')} style={{ flex: 1 }} />
      </View>
    }>
      <Text v="caption" tone="muted">{formatLongDate(date)}</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {!future && <Chip label="Present" selected={status === 'present'} onPress={() => setStatus('present')} />}
        {!future && <Chip label="Absent" selected={status === 'absent'} onPress={() => setStatus('absent')} />}
        <Chip label="Leave" selected={status === 'leave'} onPress={() => setStatus('leave')} />
      </View>
      {status === 'leave' && (
        <KeyboardAvoidingView behavior="padding">
          <Field label="Reason (optional)" value={note} onChangeText={setNote} placeholder="e.g. Sick, Family function" />
        </KeyboardAvoidingView>
      )}
    </Sheet>
  );
}
