import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import { getStudent, listBatches, saveStudent } from '../../db/repo';
import { useDb, useLive } from '../../db/live';
import { isValidISODate, today } from '../../lib/dates';
import { Button, Chip, Field, Footer, Loading, Screen, Section, Text, notify } from '../../ui/kit';

export default function StudentForm() {
  const db = useDb();
  const params = useLocalSearchParams<{ id?: string; batchId?: string }>();
  const editId = params.id ? Number(params.id) : undefined;
  const batches = useLive((d) => listBatches(d));

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cls, setCls] = useState('');
  const [joining, setJoining] = useState(today());
  const [fee, setFee] = useState('');
  const [notes, setNotes] = useState('');
  const [batchIds, setBatchIds] = useState<number[]>(params.batchId ? [Number(params.batchId)] : []);
  const [feeTouched, setFeeTouched] = useState(false);
  const [loaded, setLoaded] = useState(!editId);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!editId) return;
    getStudent(db, editId).then((r) => {
      if (!r) return;
      const s = r.student;
      setName(s.name); setPhone(s.parent_phone); setCls(s.class_name); setJoining(s.joining_date);
      setFee(String(s.monthly_fee)); setNotes(s.notes); setBatchIds(r.batches.map((b) => b.id));
      setFeeTouched(true); setLoaded(true);
    });
  }, [db, editId]);

  // New student: the fee follows the first chosen batch's default until typed over.
  const firstBatch = batches.data?.find((x) => x.id === batchIds[0]);
  const feeValue = feeTouched ? fee : firstBatch?.default_fee ? String(firstBatch.default_fee) : '';

  const toggleBatch = (id: number) =>
    setBatchIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Enter the student’s name';
    if (phone.replace(/\D/g, '').length < 10) e.phone = 'Enter a 10-digit phone number';
    if (!isValidISODate(joining)) e.joining = 'Use the format YYYY-MM-DD';
    if (feeValue && !/^\d+$/.test(feeValue.trim())) e.fee = 'Whole rupees only';
    if (batchIds.length === 0) e.batch = 'Pick at least one batch';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const id = await saveStudent(db, {
        id: editId, name, parent_phone: phone, class_name: cls, joining_date: joining,
        monthly_fee: Number(feeValue || 0), notes, batchIds,
      });
      if (editId) router.back();
      else router.replace({ pathname: '/student/[id]', params: { id: String(id) } });
    } catch (e) {
      notify('Could not save', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded || !batches.data) return <Screen back><Loading /></Screen>;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen
        back
        title={editId ? 'Edit student' : 'New student'}
        footer={<Footer><Button label={editId ? 'Save changes' : 'Add student'} icon="checkmark" onPress={submit} loading={saving} style={{ flex: 1 }} /></Footer>}
      >
        <Field label="Student name" value={name} onChangeText={setName} placeholder="e.g. Aarav Sharma" autoCapitalize="words" error={errors.name} autoFocus={!editId} />
        <Field label="Parent phone" value={phone} onChangeText={setPhone} placeholder="10-digit mobile" keyboardType="phone-pad" error={errors.phone} hint="Used for Call and WhatsApp buttons" />

        <Section title="Batch">
          {batches.data.length === 0 ? (
            <View style={{ gap: 8 }}>
              <Text v="caption" tone="muted">You don’t have any batches yet.</Text>
              <Button label="Create a batch" variant="secondary" icon="add" onPress={() => router.push('/batch/form')} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {batches.data.map((b) => (
                <Chip key={b.id} label={b.name} selected={batchIds.includes(b.id)} onPress={() => toggleBatch(b.id)} />
              ))}
            </View>
          )}
          {errors.batch ? <Text v="caption" tone="bad">{errors.batch}</Text> : null}
        </Section>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="Monthly fee (₹)" value={feeValue} onChangeText={(t) => { setFee(t); setFeeTouched(true); }} placeholder="0" keyboardType="number-pad" error={errors.fee} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Joining date" value={joining} onChangeText={setJoining} placeholder="YYYY-MM-DD" error={errors.joining} />
          </View>
        </View>
        <Text v="caption" tone="faint" style={{ marginTop: -8 }}>
          {editId ? 'A new fee applies from this month; earlier months stay as they were.' : 'Fees are due from the joining month onward.'}
        </Text>

        <Field label="Class / school (optional)" value={cls} onChangeText={setCls} placeholder="e.g. 10th, DPS" />
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Anything to remember" multiline />
      </Screen>
    </KeyboardAvoidingView>
  );
}
