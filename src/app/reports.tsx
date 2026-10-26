import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useDb, useLive } from '../db/live';
import { listStudents } from '../db/repo';
import { addMonths, currentMonth, formatMonth } from '../lib/dates';
import { attendanceReport, feesReport, notesReport, studentReport } from '../reports/data';
import { exportReport, type ReportFormat } from '../reports/export';
import type { Report } from '../reports/types';
import { Avatar, Button, Card, Divider, Field, IconButton, Row, Screen, Section, Sheet, Text, notify } from '../ui/kit';
import { useTheme } from '../ui/theme';

type Who = number | 'all' | null;

export default function Reports() {
  const db = useDb();
  const { c } = useTheme();
  const [month, setMonth] = useState(currentMonth());
  const [who, setWho] = useState<Who>(null);
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const students = useLive((d) => listStudents(d, { search }), [search]);
  const all = useLive((d) => listStudents(d, {}));
  const whoName = who === 'all' ? 'All students' : who ? all.data?.find((s) => s.id === who)?.name ?? 'Student' : null;

  const run = async (key: string, build: () => Promise<Report>, format: ReportFormat) => {
    const id = `${key}-${format}`;
    if (busy) return;
    setBusy(id);
    try {
      await exportReport(await build(), format);
    } catch (e) {
      notify('Could not create the report', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const buttons = (k: string, build: () => Promise<Report>, disabled?: boolean) => (
    <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
      <Button label="PDF" icon="document-text-outline" size="sm" style={{ flex: 1 }} disabled={disabled}
        loading={busy === `${k}-pdf`} onPress={() => run(k, build, 'pdf')} />
      <Button label="Excel" icon="grid-outline" size="sm" variant="secondary" style={{ flex: 1 }} disabled={disabled}
        loading={busy === `${k}-xlsx`} onPress={() => run(k, build, 'xlsx')} />
    </View>
  );

  const tile = (icon: React.ComponentProps<typeof Ionicons>['name'], title: string, body: string) => (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={21} color={c.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text v="heading">{title}</Text>
        <Text v="caption" tone="muted">{body}</Text>
      </View>
    </View>
  );

  return (
    <Screen back title="Reports" subtitle="Download as PDF or Excel">
      <Section title="Month (for attendance and fees)">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.surface, borderRadius: 999, paddingHorizontal: 4 }}>
          <IconButton name="chevron-back" label="Previous month" onPress={() => setMonth(addMonths(month, -1))} />
          <Text v="heading">{formatMonth(month)}</Text>
          <IconButton name="chevron-forward" label="Next month" onPress={() => month < currentMonth() && setMonth(addMonths(month, 1))} />
        </View>
      </Section>

      <Card>
        {tile('checkmark-done', 'Attendance report', "Each student's present, absent and leave for the month, plus a day-by-day grid.")}
        {buttons('attendance', () => attendanceReport(db, month))}
      </Card>

      <Card>
        {tile('book-outline', 'Notes Check report', 'Every subject, student by student and chapter by chapter.')}
        {buttons('notes', () => notesReport(db))}
      </Card>

      <Card>
        {tile('wallet-outline', 'Fees report', 'Who has paid and who is pending for the month, with the payments received.')}
        {buttons('fees', () => feesReport(db, month))}
      </Card>

      <Card>
        {tile('person-outline', 'Student-wise report', "One student's attendance, fees, payments and notes, or a summary of everyone.")}
        <Pressable
          accessibilityLabel="Choose student"
          onPress={() => setPicking(true)}
          style={{ marginTop: 14, height: 48, borderRadius: 16, backgroundColor: c.surface2, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          <Ionicons name="people-outline" size={18} color={c.muted} />
          <Text style={{ flex: 1 }} tone={whoName ? undefined : 'muted'}>{whoName ?? 'Choose a student'}</Text>
          <Ionicons name="chevron-down" size={18} color={c.muted} />
        </Pressable>
        {buttons('student', () => studentReport(db, who as number | 'all'), who === null)}
      </Card>

      <Sheet visible={picking} onClose={() => setPicking(false)} title="Choose a student">
        <Field label="" accessibilityLabel="Search students" value={search} onChangeText={setSearch} placeholder="Search name, phone or class" />
        <Card padded={false}>
          {!search && (
            <>
              <Row left={<Avatar name="All" tone="accent" />} title="All students" subtitle="One summary line per student"
                onPress={() => { setWho('all'); setSearch(''); setPicking(false); }} />
              <Divider inset={68} />
            </>
          )}
          {(students.data ?? []).map((s, i) => (
            <View key={s.id}>
              {i > 0 && <Divider inset={68} />}
              <Row left={<Avatar name={s.name} />} title={s.name} subtitle={s.class_name || s.parent_phone}
                onPress={() => { setWho(s.id); setSearch(''); setPicking(false); }} />
            </View>
          ))}
          {students.data && students.data.length === 0 && (
            <View style={{ padding: 16 }}><Text v="caption" tone="muted">No students match.</Text></View>
          )}
        </Card>
      </Sheet>
    </Screen>
  );
}
