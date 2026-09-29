import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  deleteStudent, feeStatus, getSettings, getStudent, listFeesForStudent, setStudentArchived, studentMonthAttendance,
} from '../../db/repo';
import { useDb, useLive } from '../../db/live';
import type { AttendanceStatus } from '../../db/types';
import { FEE_BADGE } from '../../ui/fee';
import { addMonths, currentMonth, daysInMonth, formatDate, formatMonth, isoWeekday } from '../../lib/dates';
import { callPhone, openWhatsApp, rupees } from '../../lib/format';
import {
  Avatar, Badge, Button, Card, Divider, IconButton, Loading, Row, Screen, Section, Stat, Text, confirm, tap,
} from '../../ui/kit';
import { useTheme } from '../../ui/theme';

export default function StudentDetail() {
  const db = useDb();
  const { c } = useTheme();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [month, setMonth] = useState(currentMonth());
  const data = useLive((d) => getStudent(d, id), [id]);
  const fees = useLive((d) => listFeesForStudent(d, id), [id]);
  const att = useLive((d) => studentMonthAttendance(d, id, month), [id, month]);
  const settings = useLive(getSettings);

  if (data.loading || !fees.data || !settings.data) return <Screen back><Loading /></Screen>;
  if (!data.data) return <Screen back title="Student not found"><Text tone="muted">It may have been deleted.</Text></Screen>;

  const { student: s, batches } = data.data;
  const dueDay = settings.data.fee_due_day;
  const outstanding = fees.data.reduce((a, f) => a + Math.max(0, f.amount_due - f.paid), 0);
  const archived = s.status === 'archived';

  const remind = () => {
    const unpaid = fees.data!.filter((f) => f.paid < f.amount_due);
    const months = unpaid.map((f) => formatMonth(f.month, false)).join(', ');
    const from = settings.data!.center_name || settings.data!.tutor_name || 'your tutor';
    openWhatsApp(
      s.parent_phone,
      `Hello, a gentle reminder that ${s.name}'s tuition fee of ${rupees(outstanding)} is pending (${months}). Please pay at your convenience. Thank you! — ${from}`,
      settings.data!.country_code,
    );
  };

  return (
    <Screen back right={<IconButton name="create-outline" label="Edit student" onPress={() => router.push({ pathname: '/student/form', params: { id: String(id) } })} />}>
      <View style={{ alignItems: 'center', gap: 8, paddingTop: 4 }}>
        <Avatar name={s.name} size={72} tone="accent" />
        <Text v="title" style={{ textAlign: 'center' }}>{s.name}</Text>
        <Text v="caption" tone="muted" style={{ textAlign: 'center' }}>
          {[batches.map((b) => b.name).join(' · ') || 'No batch', s.class_name].filter(Boolean).join('  ·  ')}
        </Text>
        {archived && <Badge label="Archived" tone="neutral" />}
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button label="Call" icon="call-outline" variant="secondary" onPress={() => callPhone(s.parent_phone)} style={{ flex: 1 }} />
        <Button label="WhatsApp" icon="logo-whatsapp" variant="secondary" onPress={() => openWhatsApp(s.parent_phone, '', settings.data!.country_code)} style={{ flex: 1 }} />
      </View>

      <Card>
        <View style={{ flexDirection: 'row' }}>
          <Stat
            label={`Attendance · ${formatMonth(month, false)}`}
            value={att.data && att.data.stats.present + att.data.stats.absent > 0 ? `${att.data.stats.percent}%` : '—'}
            tone={att.data && att.data.stats.percent < 75 && att.data.stats.present + att.data.stats.absent > 0 ? 'warn' : undefined}
            sub={att.data ? `${att.data.stats.present} present · ${att.data.stats.absent} absent` : undefined}
          />
          <Stat label="Fee outstanding" value={rupees(outstanding)} tone={outstanding > 0 ? 'bad' : 'good'} sub={`${rupees(s.monthly_fee)} / month`} />
        </View>
        {outstanding > 0 && (
          <Button label="Send fee reminder" icon="logo-whatsapp" variant="secondary" size="sm" onPress={remind} style={{ marginTop: 14 }} />
        )}
      </Card>

      <Section
        title="Attendance"
        action={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <IconButton name="chevron-back" label="Previous month" onPress={() => setMonth(addMonths(month, -1))} />
            <Text v="label" style={{ minWidth: 70, textAlign: 'center' }}>{formatMonth(month, false)}</Text>
            <IconButton name="chevron-forward" label="Next month" onPress={() => month < currentMonth() && setMonth(addMonths(month, 1))} />
          </View>
        }
      >
        <Card>
          <MonthGrid month={month} marks={att.data?.days ?? []} />
          <View style={{ flexDirection: 'row', gap: 14, marginTop: 14, justifyContent: 'center' }}>
            <Legend color={c.good} label="Present" />
            <Legend color={c.bad} label="Absent" />
            <Legend color={c.warn} label="Leave" />
          </View>
        </Card>
      </Section>

      <Section title="Fees">
        <Card padded={false}>
          {fees.data.length === 0 ? (
            <View style={{ padding: 16 }}><Text v="caption" tone="muted">No fees yet. Dues are added on the 1st of each month.</Text></View>
          ) : fees.data.map((f, i) => {
            const st = feeStatus(f, dueDay);
            return (
              <View key={f.id}>
                {i > 0 && <Divider inset={16} />}
                <Row
                  title={formatMonth(f.month)}
                  subtitle={f.paid > 0 ? `${rupees(f.paid)} of ${rupees(f.amount_due)}${f.last_paid_on ? ` · ${formatDate(f.last_paid_on)}` : ''}` : rupees(f.amount_due)}
                  right={<Badge {...FEE_BADGE[st]} />}
                  onPress={() => router.push({ pathname: '/payment/[dueId]', params: { dueId: String(f.id) } })}
                />
              </View>
            );
          })}
        </Card>
      </Section>

      {s.notes ? (
        <Section title="Notes"><Card><Text>{s.notes}</Text></Card></Section>
      ) : null}

      <View style={{ gap: 10, marginTop: 8 }}>
        <Button
          label={archived ? 'Restore student' : 'Archive student'}
          icon={archived ? 'arrow-undo-outline' : 'archive-outline'}
          variant="secondary"
          onPress={async () => {
            if (archived || await confirm('Archive student?', 'They’ll be hidden from lists and no new monthly fees will be added. History is kept.', 'Archive')) {
              await setStudentArchived(db, id, !archived);
            }
          }}
        />
        {archived && (
          <Button
            label="Delete permanently"
            icon="trash-outline"
            variant="danger"
            onPress={async () => {
              if (await confirm('Delete student?', 'This removes their attendance and fee history too. It cannot be undone.', 'Delete', true)) {
                await deleteStudent(db, id);
                router.back();
              }
            }}
          />
        )}
        <Text v="caption" tone="faint" style={{ textAlign: 'center' }}>Joined {formatDate(s.joining_date)}</Text>
      </View>
    </Screen>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text v="caption" tone="muted">{label}</Text>
    </View>
  );
}

function MonthGrid({ month, marks }: { month: string; marks: { date: string; status: AttendanceStatus }[] }) {
  const { c } = useTheme();
  const n = daysInMonth(month);
  const lead = isoWeekday(`${month}-01`) - 1; // Monday-first
  const byDay = new Map<number, AttendanceStatus>();
  // If a student is in two batches on one day, show the "worst" mark.
  const rank: Record<AttendanceStatus, number> = { absent: 3, leave: 2, present: 1, holiday: 0 };
  for (const m of marks) {
    const d = Number(m.date.slice(8));
    const prev = byDay.get(d);
    if (!prev || rank[m.status] > rank[prev]) byDay.set(d, m.status);
  }
  const color = (s?: AttendanceStatus) =>
    s === 'present' ? c.goodSoft : s === 'absent' ? c.badSoft : s === 'leave' ? c.warnSoft : 'transparent';
  const fg = (s?: AttendanceStatus) =>
    s === 'present' ? c.good : s === 'absent' ? c.bad : s === 'leave' ? c.warn : s === 'holiday' ? c.faint : c.muted;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)];

  return (
    <View>
      <View style={{ flexDirection: 'row' }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={i} v="caption" tone="faint" style={{ flex: 1, textAlign: 'center', marginBottom: 6 }}>{d}</Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((d, i) => {
          const st = d ? byDay.get(d) : undefined;
          return (
            <View key={i} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 3 }}>
              {d ? (
                <Pressable onPress={tap} style={{ flex: 1, borderRadius: 10, backgroundColor: color(st), alignItems: 'center', justifyContent: 'center' }}>
                  <Text v="label" style={{ color: fg(st) }}>{String(d)}</Text>
                  {st === 'holiday' && <Ionicons name="sunny-outline" size={9} color={c.faint} />}
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
