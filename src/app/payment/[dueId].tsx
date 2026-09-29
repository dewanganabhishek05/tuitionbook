import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import { addPayment, deletePayment, feeStatus, getFeeRow, getSettings, listPayments, setDueAmount } from '../../db/repo';
import { useDb, useLive } from '../../db/live';
import type { PaymentMode } from '../../db/types';
import { addDays, formatDate, formatMonth, isValidISODate, today } from '../../lib/dates';
import { openWhatsApp, rupees } from '../../lib/format';
import { FEE_BADGE, MODE_LABEL } from '../../ui/fee';
import {
  Badge, Button, Card, Chip, Divider, Field, Footer, IconButton, Loading, Row, Screen, Section, Segmented, Sheet, Text, confirm, notify } from '../../ui/kit';
import { useTheme } from '../../ui/theme';

export default function PaymentScreen() {
  const db = useDb();
  const { c } = useTheme();
  const dueId = Number(useLocalSearchParams<{ dueId: string }>().dueId);
  const fee = useLive((d) => getFeeRow(d, dueId), [dueId]);
  const payments = useLive((d) => listPayments(d, dueId), [dueId]);
  const settings = useLive(getSettings);

  const [amountInput, setAmount] = useState<string | null>(null); // null = default to the balance
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState<PaymentMode>('upi');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<{ amount: number; date: string; mode: PaymentMode } | null>(null);
  const [editDue, setEditDue] = useState(false);
  const [dueText, setDueText] = useState('');

  const balance = fee.data ? Math.max(0, fee.data.amount_due - fee.data.paid) : 0;
  const amount = amountInput ?? (balance ? String(balance) : '');

  if (fee.loading || !payments.data || !settings.data) return <Screen back><Loading /></Screen>;
  if (!fee.data) return <Screen back title="Not found"><Text tone="muted">This fee no longer exists.</Text></Screen>;

  const f = fee.data;
  const st = feeStatus(f, settings.data.fee_due_day);
  const from = settings.data.center_name || settings.data.tutor_name || 'your tutor';

  const save = async () => {
    const n = Number(amount);
    if (!/^\d+$/.test(amount.trim()) || n <= 0) return setError('Enter the amount received');
    if (n > balance) return setError(`That’s more than the balance of ${rupees(balance)}`);
    if (!isValidISODate(date)) return setError('Date must be YYYY-MM-DD');
    if (date > today()) return setError('Payment date can’t be in the future');
    setError(null);
    setSaving(true);
    try {
      await addPayment(db, { fee_due_id: dueId, amount: n, paid_on: date, mode, note });
      setReceipt({ amount: n, date, mode });
      setAmount(null);
      setNote('');
    } catch (e) {
      notify('Could not save', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const sendReceipt = (r: { amount: number; date: string; mode: PaymentMode }) => {
    const left = Math.max(0, f.amount_due - f.paid);
    openWhatsApp(
      f.parent_phone,
      `Payment received ✅\n\nStudent: ${f.name}\nFor: ${formatMonth(f.month)}\nAmount: ${rupees(r.amount)} (${MODE_LABEL[r.mode]})\nDate: ${formatDate(r.date)}\n${left > 0 ? `Balance: ${rupees(left)}` : 'Fully paid for the month.'}\n\nThank you! — ${from}`,
      settings.data!.country_code,
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen
        back
        subtitle={formatMonth(f.month)}
        title={f.name}
        right={<IconButton name="person-outline" label="Open student" onPress={() => router.push({ pathname: '/student/[id]', params: { id: String(f.student_id) } })} />}
        footer={balance > 0 && (
          <Footer>
            <Button label={`Record ${amount && /^\d+$/.test(amount) ? rupees(Number(amount)) : 'payment'}`} icon="checkmark" onPress={save} loading={saving} style={{ flex: 1 }} />
          </Footer>
        )}
      >
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ gap: 2 }}>
              <Text v="caption" tone="muted">{balance > 0 ? 'Balance due' : 'Fee for the month'}</Text>
              <Text v="display" tone={balance > 0 ? (st === 'overdue' ? 'bad' : undefined) : 'good'}>{rupees(balance > 0 ? balance : f.amount_due)}</Text>
            </View>
            <Badge {...FEE_BADGE[st]} />
          </View>
          <Divider />
          <Text v="caption" tone="muted" style={{ marginTop: 12 }}>Amount due {rupees(f.amount_due)} · paid {rupees(f.paid)}</Text>
          <Button label="Change amount due" variant="ghost" size="sm" icon="pricetag-outline" style={{ alignSelf: 'flex-start', marginLeft: -12, marginTop: 4 }}
            onPress={() => { setDueText(String(f.amount_due)); setEditDue(true); }} />
        </Card>

        {balance > 0 && (
          <>
            <Field label="Amount received (₹)" value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="0" error={error} />
            <Section title="Paid via">
              <Segmented<PaymentMode>
                value={mode}
                onChange={setMode}
                options={(Object.keys(MODE_LABEL) as PaymentMode[]).map((k) => ({ value: k, label: MODE_LABEL[k] }))}
              />
            </Section>
            <Section title="Date">
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Chip label="Today" selected={date === today()} onPress={() => setDate(today())} />
                <Chip label="Yesterday" selected={date === addDays(today(), -1)} onPress={() => setDate(addDays(today(), -1))} />
                <View style={{ flex: 1, minWidth: 130 }}>
                  <Field label="" accessibilityLabel="Payment date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" style={{ minHeight: 40, height: 40, borderRadius: 999 }} />
                </View>
              </View>
            </Section>
            <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. UPI ref 1234" />
          </>
        )}

        {payments.data.length > 0 && (
          <Section title="Payments">
            <Card padded={false}>
              {payments.data.map((p, i) => (
                <View key={p.id}>
                  {i > 0 && <Divider inset={16} />}
                  <Row
                    title={rupees(p.amount)}
                    subtitle={`${formatDate(p.paid_on)} · ${MODE_LABEL[p.mode]}${p.note ? ` · ${p.note}` : ''}`}
                    chevron={false}
                    right={
                      <View style={{ flexDirection: 'row' }}>
                        {f.parent_phone ? <IconButton name="logo-whatsapp" label="Send receipt" tone="good" onPress={() => sendReceipt({ amount: p.amount, date: p.paid_on, mode: p.mode })} /> : null}
                        <IconButton
                          name="trash-outline"
                          label="Delete payment"
                          onPress={async () => {
                            if (await confirm('Delete payment?', `${rupees(p.amount)} on ${formatDate(p.paid_on)} will be removed.`, 'Delete', true)) {
                              await deletePayment(db, p.id);
                            }
                          }}
                        />
                      </View>
                    }
                  />
                </View>
              ))}
            </Card>
          </Section>
        )}
      </Screen>

      <Sheet visible={!!receipt} onClose={() => setReceipt(null)} title="Payment recorded">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.goodSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="checkmark" size={24} color={c.good} />
          </View>
          <Text v="caption" tone="muted" style={{ flex: 1 }}>
            {receipt ? `${rupees(receipt.amount)} from ${f.name} for ${formatMonth(f.month)}.` : ''}
            {balance > 0 ? ` ${rupees(balance)} still due.` : ' Fully paid.'}
          </Text>
        </View>
        {f.parent_phone ? (
          <Button label="Send receipt on WhatsApp" icon="logo-whatsapp" variant="secondary" onPress={() => receipt && sendReceipt(receipt)} />
        ) : null}
        <Button label="Done" onPress={() => { setReceipt(null); router.back(); }} />
      </Sheet>

      <Sheet visible={editDue} onClose={() => setEditDue(false)} title="Change amount due">
        <Text v="caption" tone="muted">For a discount or a one-off change for {formatMonth(f.month)} only. To change the fee for every month, edit the student.</Text>
        <Field label="Amount due (₹)" value={dueText} onChangeText={setDueText} keyboardType="number-pad" />
        <Button
          label="Save"
          onPress={async () => {
            if (!/^\d+$/.test(dueText.trim())) return notify('Enter a whole amount, 0 or more');
            if (Number(dueText) < f.paid) {
              const ok = await confirm('Less than already paid', `${rupees(f.paid)} has already been paid for this month. Set the amount due to ${rupees(Number(dueText))} anyway?`, 'Set');
              if (!ok) return;
            }
            await setDueAmount(db, dueId, Number(dueText));
            setAmount(null);
            setEditDue(false);
          }}
        />
      </Sheet>
    </KeyboardAvoidingView>
  );
}
