import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { clearRoll, getHoliday, getRoll, getSettings, saveRoll, setHoliday as saveHoliday } from '../db/repo';
import { useDb, useLive } from '../db/live';
import type { AttendanceStatus, RollEntry } from '../db/types';
import { formatDate, formatDay, today } from '../lib/dates';
import { openWhatsApp } from '../lib/format';
import { goBack,
  Avatar, Button, Card, Chip, Divider, Empty, Footer, IconButton, Loading, Screen, Sheet, Text, confirm, tap, notify } from '../ui/kit';
import { font, useTheme } from '../ui/theme';

type Mark = AttendanceStatus;
const MARKS: { key: Mark; short: string; label: string }[] = [
  { key: 'present', short: 'P', label: 'Present' },
  { key: 'absent', short: 'A', label: 'Absent' },
  { key: 'leave', short: 'L', label: 'Leave' },
];

export default function RollCall() {
  const db = useDb();
  const { date: dateParam } = useLocalSearchParams<{ date?: string }>();
  const date = dateParam && dateParam <= today() ? dateParam : today();

  const roll = useLive((d) => getRoll(d, date), [date]);
  const hol = useLive(async (d) => (await getHoliday(d, date)) ?? false, [date]);
  const settings = useLive(getSettings);

  // What's saved (everyone Present by default), plus the tutor's unsaved taps on top.
  const [overrides, setOverrides] = useState<Record<number, Mark>>({});
  const [holidayOverride, setHoliday] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [absentees, setAbsentees] = useState<RollEntry[] | null>(null);

  const alreadyMarked = !!roll.data?.some((r) => r.status) || !!hol.data;
  const marks = useMemo(() => {
    const m: Record<number, Mark> = {};
    for (const r of roll.data ?? []) m[r.student_id] = r.status ?? 'present';
    return { ...m, ...overrides };
  }, [roll.data, overrides]);
  const holiday = holidayOverride ?? !!hol.data;
  const setMarks = (fn: (m: Record<number, Mark>) => Record<number, Mark>) => setOverrides(fn);

  const counts = useMemo(() => {
    const out = { present: 0, absent: 0, leave: 0 };
    Object.values(marks).forEach((m) => (out[m] += 1));
    return out;
  }, [marks]);

  const setAll = (m: Mark) => {
    setHoliday(false);
    setOverrides(Object.fromEntries((roll.data ?? []).map((r) => [r.student_id, m])));
  };

  const save = async () => {
    if (!roll.data) return;
    setSaving(true);
    try {
      if (holiday) await saveHoliday(db, date, hol.data ? hol.data.name : '');
      else await saveRoll(db, date, roll.data.map((r) => ({ student_id: r.student_id, status: marks[r.student_id] ?? 'present' })));
      const absent = holiday ? [] : roll.data.filter((r) => marks[r.student_id] === 'absent' && r.parent_phone);
      if (absent.length) setAbsentees(absent);
      else goBack();
    } catch (e) {
      notify('Could not save', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (await confirm('Clear attendance?', `Remove all marks for ${formatDate(date)}?`, 'Clear', true)) {
      await clearRoll(db, date);
      goBack();
    }
  };

  if (!roll.data || hol.data === undefined) return <Screen back><Loading /></Screen>;

  const tutor = settings.data?.center_name || settings.data?.tutor_name || 'your tutor';

  return (
    <Screen
      back
      subtitle={formatDay(date) === 'Today' ? `Today · ${formatDate(date)}` : formatDate(date)}
      title="Attendance"
      right={alreadyMarked ? <IconButton name="trash-outline" label="Clear attendance" onPress={clear} /> : undefined}
      scroll={false}
      footer={roll.data.length > 0 && (
        <Footer>
          <Button
            label={holiday ? 'Save as holiday' : alreadyMarked ? 'Update attendance' : 'Save attendance'}
            icon="checkmark"
            onPress={save}
            loading={saving}
            style={{ flex: 1 }}
          />
        </Footer>
      )}
    >
      {roll.data.length === 0 ? (
        <View style={{ paddingHorizontal: 20 }}>
          <Card>
            <Empty
              icon="people-outline"
              title={date < today() ? 'No students on this date' : 'No students yet'}
              body={date < today()
                ? 'Only students who had joined by this date are listed. Check joining dates if someone is missing.'
                : 'Add your students first, then take attendance here every day.'}
              action={<Button label="Add student" icon="add" onPress={() => router.push('/student/form')} />}
            />
          </Card>
        </View>
      ) : (
        <>
          <Summary counts={counts} holiday={holiday} total={roll.data.length} />
          <View style={{ paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, flexWrap: 'wrap' }}>
              <Chip label="All present" onPress={() => setAll('present')} />
              <Chip label="All absent" onPress={() => setAll('absent')} />
              <Chip label="Holiday" selected={holiday} onPress={() => setHoliday(!holiday)} />
            </View>
          </View>
          <RollList roll={roll.data} marks={marks} disabled={holiday} onMark={(sid, m) => setMarks((x) => ({ ...x, [sid]: m }))} />
        </>
      )}

      <Sheet visible={!!absentees} onClose={() => { setAbsentees(null); goBack(); }} title="Tell parents?" footer={<><Button label="Done" onPress={() => { setAbsentees(null); goBack(); }} /></>}>
        <Text v="caption" tone="muted">
          Saved. Send a quick WhatsApp note to the parents of students who were absent.
        </Text>
        <Card padded={false}>
          {absentees?.map((s, i) => (
            <View key={s.student_id}>
              {i > 0 && <Divider inset={16} />}
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 }}>
                <Avatar name={s.name} size={36} tone="bad" />
                <Text v="heading" style={{ flex: 1 }} numberOfLines={1}>{s.name}</Text>
                <Button
                  size="sm" variant="secondary" icon="logo-whatsapp" label="Send"
                  onPress={() => openWhatsApp(
                    s.parent_phone,
                    `Hello, this is to inform you that ${s.name} was absent from tuition on ${formatDate(date)}. — ${tutor}`,
                    settings.data?.country_code,
                  )}
                />
              </View>
            </View>
          ))}
        </Card>
      </Sheet>
    </Screen>
  );
}

function Summary({ counts, holiday, total }: { counts: Record<Mark, number>; holiday: boolean; total: number }) {
  const { c } = useTheme();
  if (holiday) {
    return (
      <View style={{ marginHorizontal: 20, padding: 14, borderRadius: 16, backgroundColor: c.surface2, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <Ionicons name="sunny-outline" size={20} color={c.muted} />
        <Text v="label" tone="muted">Marked as holiday — won’t count towards attendance %</Text>
      </View>
    );
  }
  const items: [string, number, string][] = [
    ['Present', counts.present, c.good], ['Absent', counts.absent, c.bad], ['Leave', counts.leave, c.warn],
  ];
  return (
    <View style={{ flexDirection: 'row', marginHorizontal: 20, backgroundColor: c.surface, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
      {items.map(([label, n, color], i) => (
        <View key={label} style={{ flex: 1, paddingVertical: 12, alignItems: 'center', borderLeftWidth: i ? StyleSheet.hairlineWidth : 0, borderLeftColor: c.border }}>
          <Text v="number" style={{ color }}>{String(n)}</Text>
          <Text v="caption" tone="muted">{label}{i === 0 ? ` of ${total}` : ''}</Text>
        </View>
      ))}
    </View>
  );
}

function RollList({ roll, marks, disabled, onMark }: {
  roll: RollEntry[]; marks: Record<number, Mark>; disabled: boolean; onMark: (id: number, m: Mark) => void;
}) {
  const { c } = useTheme();
  const tones: Record<Mark, { fg: string; bg: string }> = {
    present: { fg: c.good, bg: c.goodSoft }, absent: { fg: c.bad, bg: c.badSoft }, leave: { fg: c.warn, bg: c.warnSoft },
  };
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }} style={{ opacity: disabled ? 0.4 : 1 }}>
      <Card padded={false}>
        {roll.map((r, i) => {
          const m = marks[r.student_id] ?? 'present';
          return (
            <View key={r.student_id}>
              {i > 0 && <Divider inset={64} />}
              <Pressable
                disabled={disabled}
                onPress={() => { tap(); onMark(r.student_id, m === 'present' ? 'absent' : 'present'); }}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 }}
              >
                <Avatar name={r.name} size={38} tone={m === 'absent' ? 'bad' : m === 'leave' ? 'warn' : 'neutral'} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text v="heading" numberOfLines={1}>{r.name}</Text>
                  {r.status === 'leave' && r.note
                    ? <Text v="caption" tone="warn" numberOfLines={1}>Leave: {r.note}</Text>
                    : r.class_name ? <Text v="caption" tone="muted" numberOfLines={1}>{r.class_name}</Text> : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {MARKS.map((opt) => {
                    const on = m === opt.key;
                    return (
                      <Pressable
                        key={opt.key}
                        accessibilityLabel={`${r.name} ${opt.label}`}
                        disabled={disabled}
                        hitSlop={4}
                        onPress={() => { tap(); onMark(r.student_id, opt.key); }}
                        style={{
                          width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
                          backgroundColor: on ? tones[opt.key].bg : 'transparent',
                          borderWidth: 1, borderColor: on ? tones[opt.key].fg : c.border,
                        }}
                      >
                        <Text v="label" style={{ color: on ? tones[opt.key].fg : c.faint, fontFamily: on ? font.bold : font.medium }}>{opt.short}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Pressable>
            </View>
          );
        })}
      </Card>
      <Text v="caption" tone="faint" style={{ textAlign: 'center', marginTop: 12 }}>
        Tap a name to switch Present ↔ Absent
      </Text>
    </ScrollView>
  );
}
