import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Pressable, View } from 'react-native';
import { batchDays, getBatch, saveBatch } from '../../db/repo';
import { useDb } from '../../db/live';
import { WEEKDAYS } from '../../lib/dates';
import { Button, Field, Footer, Loading, Screen, Section, Text, tap, notify } from '../../ui/kit';
import { font, useTheme } from '../../ui/theme';

export default function BatchForm() {
  const db = useDb();
  const { c } = useTheme();
  const editId = Number(useLocalSearchParams<{ id?: string }>().id) || undefined;
  const [name, setName] = useState('');
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [time, setTime] = useState('17:00');
  const [fee, setFee] = useState('');
  const [loaded, setLoaded] = useState(!editId);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!editId) return;
    getBatch(db, editId).then((b) => {
      if (!b) return;
      setName(b.name); setDays(batchDays(b)); setTime(b.start_time); setFee(b.default_fee ? String(b.default_fee) : '');
      setLoaded(true);
    });
  }, [db, editId]);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Give the batch a name';
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) e.time = 'Use 24-hour HH:MM, e.g. 17:30';
    if (fee && !/^\d+$/.test(fee)) e.fee = 'Whole rupees only';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      await saveBatch(db, { id: editId, name, days, start_time: time, default_fee: Number(fee || 0) });
      router.back();
    } catch (e) {
      notify('Could not save', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <Screen back><Loading /></Screen>;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen
        back
        title={editId ? 'Edit batch' : 'New batch'}
        footer={<Footer><Button label={editId ? 'Save changes' : 'Create batch'} icon="checkmark" onPress={submit} loading={saving} style={{ flex: 1 }} /></Footer>}
      >
        <Field label="Batch name" value={name} onChangeText={setName} placeholder="e.g. Class 10 · Maths" error={errors.name} autoFocus={!editId} />
        <Section title="Class days">
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => {
              const on = days.includes(d);
              return (
                <Pressable
                  key={d}
                  accessibilityLabel={WEEKDAYS[d]}
                  onPress={() => { tap(); setDays((xs) => (on ? xs.filter((x) => x !== d) : [...xs, d])); }}
                  style={{
                    flex: 1, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: on ? c.text : c.surface, borderWidth: 1, borderColor: on ? c.text : c.border,
                  }}
                >
                  <Text v="label" style={{ color: on ? c.bg : c.muted, fontFamily: on ? font.semibold : font.medium }}>{WEEKDAYS[d].slice(0, 2)}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text v="caption" tone="faint">Batches show up on the Today screen on these days.</Text>
        </Section>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="Start time" value={time} onChangeText={setTime} placeholder="17:00" error={errors.time} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Default fee (₹/month)" value={fee} onChangeText={setFee} keyboardType="number-pad" placeholder="0" error={errors.fee} />
          </View>
        </View>
        <Text v="caption" tone="faint" style={{ marginTop: -8 }}>The default fee pre-fills for new students in this batch.</Text>
      </Screen>
    </KeyboardAvoidingView>
  );
}
