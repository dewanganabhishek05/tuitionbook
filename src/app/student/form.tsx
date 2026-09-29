import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import { getSettings, getStudent, saveStudent } from '../../db/repo';
import { useDb, useLive } from '../../db/live';
import { isValidISODate, today } from '../../lib/dates';
import { goBack, Button, Field, Footer, Loading, Screen, Text, notify } from '../../ui/kit';

export default function StudentForm() {
  const db = useDb();
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = params.id ? Number(params.id) : undefined;
  const settings = useLive(getSettings);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cls, setCls] = useState('');
  const [joining, setJoining] = useState(today());
  const [fee, setFee] = useState('');
  const [notes, setNotes] = useState('');
  const [feeTouched, setFeeTouched] = useState(false);
  const [loaded, setLoaded] = useState(!editId);
  const [saving, setSaving] = useState<'open' | 'another' | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!editId) return;
    getStudent(db, editId).then((s) => {
      if (!s) return;
      setName(s.name); setPhone(s.parent_phone); setCls(s.class_name); setJoining(s.joining_date);
      setFee(String(s.monthly_fee)); setNotes(s.notes);
      setFeeTouched(true); setLoaded(true);
    });
  }, [db, editId]);

  // New student: the fee starts from the default in Settings until typed over.
  const defaultFee = settings.data?.default_fee ?? 0;
  const feeValue = feeTouched ? fee : defaultFee ? String(defaultFee) : '';

  const submit = async (then: 'open' | 'another') => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Enter the student’s name';
    if (phone.replace(/\D/g, '').length < 10) e.phone = 'Enter a 10-digit phone number';
    if (!isValidISODate(joining)) e.joining = 'Use the format YYYY-MM-DD';
    if (feeValue && !/^\d+$/.test(feeValue.trim())) e.fee = 'Whole rupees only';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(then);
    try {
      const id = await saveStudent(db, {
        id: editId, name, parent_phone: phone, class_name: cls, joining_date: joining,
        monthly_fee: Number(feeValue || 0), notes,
      });
      if (editId) goBack();
      else if (then === 'another') {
        // Keep class, fee and joining date: tutors usually add several students from the same class.
        setAdded(name.trim());
        setName(''); setPhone(''); setNotes('');
      } else router.replace({ pathname: '/student/[id]', params: { id: String(id) } });
    } catch (err) {
      notify('Could not save', (err as Error).message);
    } finally {
      setSaving(null);
    }
  };

  if (!loaded || !settings.data) return <Screen back><Loading /></Screen>;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen
        back
        title={editId ? 'Edit student' : 'New student'}
        footer={
          <Footer>
            {!editId && (
              <Button label="Save & add another" variant="secondary" onPress={() => submit('another')} loading={saving === 'another'} style={{ flex: 1 }} />
            )}
            <Button label={editId ? 'Save changes' : 'Add student'} icon="checkmark" onPress={() => submit('open')} loading={saving === 'open'} style={{ flex: 1 }} />
          </Footer>
        }
      >
        {added ? <Text v="caption" tone="good">✓ {added} added. Enter the next student.</Text> : null}
        <Field label="Student name" value={name} onChangeText={setName} placeholder="e.g. Aarav Sharma" autoCapitalize="words" error={errors.name} autoFocus={!editId} />
        <Field label="Parent phone" value={phone} onChangeText={setPhone} placeholder="10-digit mobile" keyboardType="phone-pad" error={errors.phone} hint="Used for Call and WhatsApp buttons" />

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

        <Field label="Class / school (optional)" value={cls} onChangeText={setCls} placeholder="e.g. Class 10, DPS" hint="Shown under the name and searchable" />
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Anything to remember" multiline />
      </Screen>
    </KeyboardAvoidingView>
  );
}
