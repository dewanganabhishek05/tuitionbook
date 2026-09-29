import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Share, View } from 'react-native';
import { arrearsBefore, daysOverdue, feeStatus, getSettings, listFeesForMonth, monthSummary } from '../../db/repo';
import { useLive } from '../../db/live';
import type { FeeRow, Settings } from '../../db/types';
import { addMonths, currentMonth, formatDate, formatMonth } from '../../lib/dates';
import { openWhatsApp, pct, rupees } from '../../lib/format';
import { FEE_BADGE } from '../../ui/fee';
import {
  Avatar, Badge, Button, Card, Divider, Empty, IconButton, Loading, Progress, Row, Screen, Segmented, Stat, Text,
} from '../../ui/kit';
import { useTheme } from '../../ui/theme';

export default function FeesScreen() {
  const { c } = useTheme();
  const [month, setMonth] = useState(currentMonth());
  const [tab, setTab] = useState<'pending' | 'paid'>('pending');
  const rows = useLive((d) => listFeesForMonth(d, month), [month]);
  const sum = useLive((d) => monthSummary(d, month), [month]);
  const arrears = useLive((d) => arrearsBefore(d, month), [month]);
  const settings = useLive(getSettings);

  const pending = (rows.data ?? []).filter((r) => r.paid < r.amount_due);
  const paid = (rows.data ?? []).filter((r) => r.paid >= r.amount_due);
  const list = tab === 'pending' ? pending : paid;

  const sharePending = () => {
    const lines = pending.map((r, i) => `${i + 1}. ${r.name} — ${rupees(r.amount_due - r.paid)}`);
    Share.share({
      message: `Pending fees · ${formatMonth(month)}\n\n${lines.join('\n')}\n\nTotal: ${rupees(sum.data?.pending ?? 0)}`,
    });
  };

  return (
    <Screen
      title="Fees"
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 999, borderWidth: 1, borderColor: c.border, marginBottom: 2 }}>
          <IconButton name="chevron-back" label="Previous month" onPress={() => setMonth(addMonths(month, -1))} />
          <Text v="label" style={{ minWidth: 64, textAlign: 'center' }}>{formatMonth(month, false)}</Text>
          <IconButton name="chevron-forward" label="Next month" onPress={() => month < currentMonth() && setMonth(addMonths(month, 1))} />
        </View>
      }
    >
      {!sum.data || !rows.data || !settings.data ? <Loading /> : sum.data.students === 0 ? (
        <Card>
          <Empty
            icon="wallet-outline"
            title={`No fees for ${formatMonth(month)}`}
            body="Each student’s monthly fee is added automatically from their joining month."
          />
        </Card>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: 'row', marginBottom: 14 }}>
              <Stat label="Collected" value={rupees(sum.data.collected)} tone="good" sub={`of ${rupees(sum.data.expected)}`} />
              <Stat label="Pending" value={rupees(sum.data.pending)} tone={sum.data.pending ? 'bad' : undefined} sub={`${pending.length} students`} />
            </View>
            <Progress value={pct(sum.data.collected, sum.data.expected)} />
            {arrears.data && arrears.data.total > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
                <Ionicons name="alert-circle-outline" size={16} color={c.warn} />
                <Text v="caption" tone="muted">
                  Plus {rupees(arrears.data.total)} unpaid from earlier months ({arrears.data.students} {arrears.data.students === 1 ? 'student' : 'students'})
                </Text>
              </View>
            )}
          </Card>

          <Segmented
            value={tab}
            onChange={setTab}
            options={[{ value: 'pending', label: `Pending · ${pending.length}` }, { value: 'paid', label: `Paid · ${paid.length}` }]}
          />

          <Card padded={false}>
            {list.length === 0 ? (
              <Empty
                icon={tab === 'pending' ? 'checkmark-done-circle-outline' : 'hourglass-outline'}
                title={tab === 'pending' ? 'All clear' : 'No payments yet'}
                body={tab === 'pending' ? `Everyone has paid for ${formatMonth(month)}.` : 'Tap a pending student to record a payment.'}
              />
            ) : list.map((r, i) => (
              <View key={r.id}>
                {i > 0 && <Divider inset={68} />}
                <FeeItem row={r} settings={settings.data!} />
              </View>
            ))}
          </Card>

          {tab === 'pending' && pending.length > 0 && (
            <Button label="Share pending list" icon="share-outline" variant="ghost" onPress={sharePending} />
          )}
        </>
      )}
    </Screen>
  );
}

function FeeItem({ row: r, settings }: { row: FeeRow; settings: Settings }) {
  const st = feeStatus(r, settings.fee_due_day);
  const balance = r.amount_due - r.paid;
  const late = st === 'overdue' ? daysOverdue(r.month, settings.fee_due_day) : 0;
  const from = settings.center_name || settings.tutor_name || 'your tutor';
  const subtitle = st === 'paid'
    ? `${rupees(r.amount_due)}${r.last_paid_on ? ` · paid ${formatDate(r.last_paid_on)}` : ''}`
    : `${r.paid > 0 ? `${rupees(r.paid)} paid · ` : ''}${late ? `${late} days overdue` : r.batch_names ?? ''}`;

  return (
    <Row
      left={<Avatar name={r.name} tone={st === 'paid' ? 'good' : st === 'overdue' ? 'bad' : 'neutral'} />}
      title={r.name}
      subtitle={subtitle}
      chevron={false}
      onPress={() => router.push({ pathname: '/payment/[dueId]', params: { dueId: String(r.id) } })}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {st === 'paid'
            ? <Badge {...FEE_BADGE.paid} icon="checkmark" />
            : <Text v="heading" tone={st === 'overdue' ? 'bad' : undefined}>{rupees(balance)}</Text>}
          {st !== 'paid' && r.parent_phone ? (
            <IconButton
              name="logo-whatsapp"
              label={`Remind ${r.name}`}
              tone="good"
              onPress={() => openWhatsApp(
                r.parent_phone,
                `Hello, a gentle reminder that ${r.name}'s tuition fee for ${formatMonth(r.month)} (${rupees(balance)}) is pending. Please pay at your convenience. Thank you! — ${from}`,
                settings.country_code,
              )}
            />
          ) : null}
        </View>
      }
    />
  );
}
