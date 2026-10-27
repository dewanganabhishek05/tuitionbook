import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useDb, useLive } from '../db/live';
import { getSettings, listStudents, saveStudent } from '../db/repo';
import { ImportError, readStudents, type Picked } from '../importer/read';
import { isDuplicate, type ParsedStudent } from '../importer/parse';
import { isValidISODate, today } from '../lib/dates';
import { rupees } from '../lib/format';
import { Badge, Button, Card, Divider, Empty, Field, Footer, IconButton, Loading, Row, Screen, Section, Sheet, Text, confirm, goBack, notify } from '../ui/kit';
import { useTheme } from '../ui/theme';

interface Item extends ParsedStudent { key: number; selected: boolean; dup: boolean }
type Stage = 'pick' | 'reading' | 'review' | 'adding' | 'done';

export default function ImportStudents() {
  const db = useDb();
  const { c } = useTheme();
  const settings = useLive(getSettings);
  const existing = useLive((d) => listStudents(d, {}));
  const [stage, setStage] = useState<Stage>('pick');
  const [items, setItems] = useState<Item[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [showSkipped, setShowSkipped] = useState(false);
  const [fee, setFee] = useState('');
  const [joining, setJoining] = useState(today());
  const [editing, setEditing] = useState<Item | null>(null);
  const [added, setAdded] = useState(0);

  const defaultFee = settings.data?.default_fee ?? 0;
  const feeText = fee || (defaultFee ? String(defaultFee) : '');

  const load = async (files: Picked[]) => {
    if (!files.length) return;
    setStage('reading');
    try {
      const res = await readStudents(files);
      const ex = existing.data ?? [];
      setItems(res.students.map((s, i) => {
        const dup = isDuplicate(s, ex);
        return { ...s, key: i, dup, selected: !dup };
      }));
      setSkipped(res.skipped);
      setShowSkipped(false);
      setStage('review');
    } catch (e) {
      setStage('pick');
      notify('Could not read the file', e instanceof ImportError ? e.message : (e as Error).message);
    }
  };

  const fromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { notify('Camera access is off', 'Allow the camera in Settings, or choose a photo from your gallery.'); return; }
    const r = await ImagePicker.launchCameraAsync({ quality: 1 });
    if (!r.canceled) await load(r.assets.map((a) => ({ uri: a.uri, name: a.fileName ?? 'photo.jpg', mimeType: a.mimeType ?? 'image/jpeg' })));
  };
  const fromGallery = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1 });
    if (!r.canceled) await load(r.assets.map((a) => ({ uri: a.uri, name: a.fileName ?? 'photo.jpg', mimeType: a.mimeType ?? 'image/jpeg' })));
  };
  const fromFiles = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
    if (!r.canceled) await load(r.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType })));
  };

  const chosen = items.filter((i) => i.selected);
  const toggle = (key: number) => setItems((l) => l.map((i) => (i.key === key ? { ...i, selected: !i.selected } : i)));
  const setAll = (on: boolean) => setItems((l) => l.map((i) => ({ ...i, selected: on })));

  const add = async () => {
    if (!isValidISODate(joining)) { notify('Check the joining date', 'Use the format YYYY-MM-DD.'); return; }
    if (feeText && !/^\d+$/.test(feeText.trim())) { notify('Check the fee', 'Whole rupees only.'); return; }
    setStage('adding');
    let n = 0;
    try {
      for (const s of chosen) {
        await saveStudent(db, {
          name: s.name, parent_phone: s.phone, class_name: s.class_name, joining_date: s.joining ?? joining,
          monthly_fee: s.fee ?? Number(feeText || 0), notes: s.notes,
        });
        n++;
      }
      setAdded(n);
      setStage('done');
    } catch (e) {
      notify('Stopped after ' + n + ' students', (e as Error).message);
      // what was already saved is now a duplicate of the list: drop it from the selection
      setItems((l) => l.map((i) => (chosen.indexOf(i) >= 0 && chosen.indexOf(i) < n ? { ...i, selected: false, dup: true } : i)));
      setStage('review');
    }
  };

  const leave = async () => {
    if (stage === 'review' && chosen.length && !(await confirm('Discard this list?', 'Nothing has been added yet.', 'Discard', true))) return;
    goBack();
  };

  /* ------------------------------------------------------------------ pick */
  if (stage === 'pick' || stage === 'reading') {
    const reading = stage === 'reading';
    return (
      <Screen back title="Upload student data" subtitle="Add many students at once">
        {reading ? (
          <Card>
            <Loading />
            <Text style={{ textAlign: 'center' }}>Reading your list…</Text>
            <Text v="caption" tone="muted" style={{ textAlign: 'center' }}>Photos and scanned PDFs can take a few seconds.</Text>
          </Card>
        ) : (
          <>
            <Card>
              <Text v="heading">Choose where your list is</Text>
              <Text v="caption" tone="muted" style={{ marginBottom: 12, marginTop: 2 }}>
                You will see every student before anything is added.
              </Text>
              <View style={{ gap: 10 }}>
                {Platform.OS !== 'web' && <Button label="Take a photo of the list" icon="camera-outline" onPress={fromCamera} />}
                <Button label="Choose photos" icon="image-outline" variant="secondary" onPress={fromGallery} />
                <Button label="Choose a file (PDF, Excel, Word…)" icon="document-attach-outline" variant="secondary" onPress={fromFiles} />
              </View>
            </Card>
            <Section title="What works best">
              <Card>
                <View style={{ gap: 10 }}>
                  {[
                    ['grid-outline', 'Excel, CSV, Word tables', 'Columns like Name, Phone, Class, Fee are picked up automatically.'],
                    ['camera-outline', 'Photos and scanned PDFs', 'Read on this phone, no internet needed. Use good light and keep the page flat.'],
                    ['text-outline', 'Plain lists', 'One student per line, like “Aarav Sharma 9876543210 Class 8”.'],
                  ].map(([icon, title, body]) => (
                    <View key={title} style={{ flexDirection: 'row', gap: 12 }}>
                      <Ionicons name={icon as 'grid-outline'} size={20} color={c.accent} style={{ marginTop: 2 }} />
                      <View style={{ flex: 1 }}>
                        <Text v="heading">{title}</Text>
                        <Text v="caption" tone="muted">{body}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </Card>
            </Section>
          </>
        )}
      </Screen>
    );
  }

  /* ------------------------------------------------------------------ done */
  if (stage === 'done') {
    return (
      <Screen back title="Done">
        <Empty icon="checkmark-circle-outline" title={`${added} student${added === 1 ? '' : 's'} added`}
          body="They are in your Students list now. Fees start from each joining month."
          action={<View style={{ gap: 10, alignSelf: 'stretch' }}>
            <Button label="View students" icon="people-outline" onPress={() => router.replace('/students')} />
            <Button label="Upload another list" variant="secondary" onPress={() => { setItems([]); setStage('pick'); }} />
          </View>} />
      </Screen>
    );
  }

  /* ------------------------------------------------------------------ review */
  const adding = stage === 'adding';
  const dups = items.filter((i) => i.dup).length;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen
        back
        title="Review students"
        subtitle={items.length ? `${items.length} found · ${chosen.length} selected` : 'Nothing found'}
        right={<Button label="Start over" size="sm" variant="ghost" onPress={leave} />}
        footer={items.length ? (
          <Footer>
            <Button label={chosen.length ? `Add ${chosen.length} student${chosen.length === 1 ? '' : 's'}` : 'Select students to add'} icon="checkmark"
              disabled={!chosen.length} loading={adding} onPress={add} style={{ flex: 1 }} />
          </Footer>
        ) : undefined}
      >
        {!items.length ? (
          <Empty icon="search-outline" title="No students found"
            body="Check that names are visible and try again. For photos, use good light and fill the frame with the list."
            action={<Button label="Try another file" onPress={() => setStage('pick')} />} />
        ) : (
          <>
            <Text v="caption" tone="muted">
              Tap a student to include or skip them, and the pencil to fix a name or number.
              {dups ? ` ${dups} already in your list ${dups === 1 ? 'is' : 'are'} unticked.` : ''}
            </Text>

            <Card>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Field label="Monthly fee (₹)" accessibilityLabel="Default monthly fee" value={feeText} onChangeText={setFee} keyboardType="number-pad" placeholder="0" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Joining date" accessibilityLabel="Default joining date" value={joining} onChangeText={setJoining} placeholder="YYYY-MM-DD" />
                </View>
              </View>
              <Text v="caption" tone="faint" style={{ marginTop: 6 }}>Used for students whose fee or joining date is not in the file.</Text>
            </Card>

            <Section
              title="Students"
              action={
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <Button label="All" size="sm" variant="ghost" onPress={() => setAll(true)} />
                  <Button label="None" size="sm" variant="ghost" onPress={() => setAll(false)} />
                </View>
              }
            >
              <Card padded={false}>
                {items.map((s, i) => (
                  <View key={s.key}>
                    {i > 0 && <Divider inset={68} />}
                    <Row
                      chevron={false}
                      onPress={() => toggle(s.key)}
                      left={
                        <View accessibilityLabel={`${s.selected ? 'Included' : 'Skipped'}: ${s.name}`}>
                          <Ionicons name={s.selected ? 'checkbox' : 'square-outline'} size={24} color={s.selected ? c.accent : c.faint} />
                        </View>
                      }
                      title={s.name}
                      subtitle={[s.phone || 'No phone', s.class_name, s.fee !== null ? rupees(s.fee) : ''].filter(Boolean).join(' · ')}
                      right={
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          {s.dup ? <Badge label="In your list" tone="warn" /> : null}
                          <IconButton name="create-outline" label={`Edit ${s.name}`} onPress={() => setEditing(s)} />
                        </View>
                      }
                    />
                  </View>
                ))}
              </Card>
            </Section>

            {skipped.length ? (
              <Section title="Lines that were not added">
                <Card>
                  <Button label={showSkipped ? 'Hide lines' : `Show ${skipped.length} line${skipped.length === 1 ? '' : 's'}`} size="sm" variant="secondary" onPress={() => setShowSkipped(!showSkipped)} />
                  {showSkipped ? (
                    <View style={{ gap: 6, marginTop: 10 }}>
                      {skipped.map((l, i) => <Text key={i} v="caption" tone="muted">• {l}</Text>)}
                      <Text v="caption" tone="faint">These looked like titles, headings or totals. Add any real student by hand from Students.</Text>
                    </View>
                  ) : null}
                </Card>
              </Section>
            ) : null}
          </>
        )}
      </Screen>

      <EditSheet
        item={editing}
        onClose={() => setEditing(null)}
        onSave={(next) => { setItems((l) => l.map((i) => (i.key === next.key ? next : i))); setEditing(null); }}
        onRemove={(key) => { setItems((l) => l.filter((i) => i.key !== key)); setEditing(null); }}
      />
    </KeyboardAvoidingView>
  );
}

function EditSheet({ item, onClose, onSave, onRemove }: {
  item: Item | null; onClose: () => void; onSave: (i: Item) => void; onRemove: (key: number) => void;
}) {
  // Remounted per student (key), so the fields start from that student's values.
  return (
    <Sheet visible={!!item} onClose={onClose} title="Edit student">
      {item ? <EditForm key={item.key} item={item} onSave={onSave} onRemove={onRemove} /> : null}
    </Sheet>
  );
}

function EditForm({ item, onSave, onRemove }: { item: Item; onSave: (i: Item) => void; onRemove: (key: number) => void }) {
  const [name, setName] = useState(item.name);
  const [phone, setPhone] = useState(item.phone);
  const [cls, setCls] = useState(item.class_name);
  const [fee, setFee] = useState(item.fee === null ? '' : String(item.fee));
  const [joining, setJoining] = useState(item.joining ?? '');
  const [err, setErr] = useState<Record<string, string>>({});

  const save = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Enter a name';
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (phone.trim() && digits.length !== 10) e.phone = 'Enter a 10-digit number, or leave it empty';
    if (fee.trim() && !/^\d+$/.test(fee.trim())) e.fee = 'Whole rupees only';
    if (joining.trim() && !isValidISODate(joining.trim())) e.joining = 'Use YYYY-MM-DD, or leave it empty';
    setErr(e);
    if (Object.keys(e).length) return;
    onSave({ ...item, name: name.trim(), phone: phone.trim() ? digits : '', class_name: cls.trim(), fee: fee.trim() ? Number(fee) : null, joining: joining.trim() || null });
  };

  return (
    <View style={{ gap: 14 }}>
      <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" error={err.name} />
      <Field label="Parent phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" error={err.phone} />
      <Field label="Class / school" value={cls} onChangeText={setCls} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Field label="Monthly fee (₹)" value={fee} onChangeText={setFee} keyboardType="number-pad" placeholder="Default" error={err.fee} /></View>
        <View style={{ flex: 1 }}><Field label="Joining date" value={joining} onChangeText={setJoining} placeholder="Default" error={err.joining} /></View>
      </View>
      {item.source ? <Text v="caption" tone="faint">Read from: {item.source}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
        <Button label="Remove" variant="danger" onPress={() => onRemove(item.key)} style={{ flex: 1 }} />
        <Button label="Save" icon="checkmark" onPress={save} style={{ flex: 2 }} />
      </View>
    </View>
  );
}
