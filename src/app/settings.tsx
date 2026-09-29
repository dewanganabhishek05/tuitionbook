import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import { getSettings, setSettings } from '../db/repo';
import { seedDemo, wipeAll } from '../db/seed';
import { useDb } from '../db/live';
import { goBack, Button, Field, Footer, Loading, Screen, Section, Text, confirm, notify } from '../ui/kit';

export default function SettingsScreen() {
  const db = useDb();
  const [tutor, setTutor] = useState('');
  const [center, setCenter] = useState('');
  const [dueDay, setDueDay] = useState('10');
  const [cc, setCc] = useState('91');
  const [defFee, setDefFee] = useState('');
  const [feeError, setFeeError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettings(db).then((s) => {
      setTutor(s.tutor_name); setCenter(s.center_name); setDueDay(String(s.fee_due_day)); setCc(s.country_code); setDefFee(s.default_fee ? String(s.default_fee) : '');
      setLoaded(true);
    });
  }, [db]);

  const save = async () => {
    const d = Number(dueDay);
    if (!Number.isInteger(d) || d < 1 || d > 28) return setError('Pick a day from 1 to 28');
    setError(null);
    if (defFee.trim() && !/^\d+$/.test(defFee.trim())) return setFeeError('Whole rupees only');
    setFeeError(null);
    await setSettings(db, {
      tutor_name: tutor.trim(), center_name: center.trim(), fee_due_day: d, country_code: cc.replace(/\D/g, '') || '91',
      default_fee: Number(defFee.trim() || 0),
    });
    goBack();
  };

  if (!loaded) return <Screen back><Loading /></Screen>;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen back title="Settings" footer={<Footer><Button label="Save" icon="checkmark" onPress={save} style={{ flex: 1 }} /></Footer>}>
        <Field label="Your name" value={tutor} onChangeText={setTutor} placeholder="e.g. Priya" autoCapitalize="words" hint="Shown in the greeting" />
        <Field label="Tuition / centre name (optional)" value={center} onChangeText={setCenter} placeholder="e.g. Bright Minds Tuition" hint="Used to sign WhatsApp reminders and receipts" />
        <Field label="Default monthly fee (₹)" value={defFee} onChangeText={setDefFee} keyboardType="number-pad" placeholder="0" error={feeError} hint="Pre-filled when you add a new student" />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="Fee due by (day)" value={dueDay} onChangeText={setDueDay} keyboardType="number-pad" error={error} hint="After this day, unpaid = overdue" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Country code" value={cc} onChangeText={setCc} keyboardType="number-pad" hint="For WhatsApp links" />
          </View>
        </View>

        <Section title="Sample data">
          <Text v="caption" tone="muted">Load 18 sample students with 3 weeks of attendance and fees to try the app. You can clear it afterwards.</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              label="Load sample"
              variant="secondary"
              size="sm"
              loading={busy === 'seed'}
              onPress={async () => { setBusy('seed'); try { await seedDemo(db); notify('Sample data loaded'); } finally { setBusy(null); } }}
            />
            <Button
              label="Erase all data"
              variant="danger"
              size="sm"
              loading={busy === 'wipe'}
              onPress={async () => {
                if (!(await confirm('Erase everything?', 'All students, attendance and payments on this phone will be deleted. Back up first if you need them.', 'Erase', true))) return;
                setBusy('wipe');
                try { await wipeAll(db); } finally { setBusy(null); }
              }}
            />
          </View>
        </Section>
      </Screen>
    </KeyboardAvoidingView>
  );
}
