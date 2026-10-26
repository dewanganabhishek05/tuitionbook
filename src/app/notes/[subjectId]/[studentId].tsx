import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { Pressable, View } from 'react-native';
import { getChecks, getSubject, setAllChecks, toggleCheck } from '../../../db/notes';
import { getStudent } from '../../../db/repo';
import { useDb, useLive } from '../../../db/live';
import { pct } from '../../../lib/format';
import { Avatar, Button, Card, Loading, Progress, Screen, Text, confirm, notify, tap } from '../../../ui/kit';
import { font, useTheme } from '../../../ui/theme';

const COLS = 5;

export default function StudentChapters() {
  const db = useDb();
  const { c } = useTheme();
  const params = useLocalSearchParams<{ subjectId: string; studentId: string }>();
  const subjectId = Number(params.subjectId);
  const studentId = Number(params.studentId);
  const subject = useLive((d) => getSubject(d, subjectId), [subjectId]);
  const student = useLive((d) => getStudent(d, studentId), [studentId]);
  const checks = useLive((d) => getChecks(d, subjectId, studentId), [subjectId, studentId]);
  const busy = useRef(new Set<number>());

  if (subject.loading || student.loading || !checks.data) return <Screen back><Loading /></Screen>;
  if (!subject.data || !student.data) return <Screen back title="Not found"><Text tone="muted">This subject or student no longer exists.</Text></Screen>;

  const { chapters, name: subjectName } = subject.data;
  const done = new Set(checks.data);
  const p = pct(done.size, chapters);

  const toggle = async (ch: number) => {
    if (busy.current.has(ch)) return;
    busy.current.add(ch);
    try {
      await toggleCheck(db, subjectId, studentId, ch);
    } catch (e) {
      notify('Could not save', (e as Error).message);
    } finally {
      busy.current.delete(ch);
    }
  };

  return (
    <Screen back title={student.data.name} subtitle={subjectName}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <Avatar name={student.data.name} size={48} />
          <View style={{ flex: 1 }}>
            <Text v="number">{done.size}<Text v="body" tone="muted"> / {chapters} chapters</Text></Text>
            <Text v="caption" tone="muted">{done.size === chapters ? 'All chapters checked' : `${chapters - done.size} left`}</Text>
          </View>
          <Text v="title" tone={done.size === chapters ? 'good' : 'accent'}>{p}%</Text>
        </View>
        <Progress value={p} tone={done.size === chapters ? 'good' : 'accent'} />
      </Card>

      <Card>
        <Text v="label" tone="muted" style={{ marginBottom: 10 }}>Tap a chapter to tick it</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 }}>
          {Array.from({ length: chapters }, (_, i) => i + 1).map((ch) => {
            const on = done.has(ch);
            return (
              <View key={ch} style={{ width: `${100 / COLS}%`, padding: 3 }}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={`Chapter ${ch}`}
                  accessibilityState={{ checked: on }}
                  onPress={() => { tap(); toggle(ch); }}
                  style={({ pressed }) => ({
                    aspectRatio: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: on ? c.accent : c.surface2, opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text v="label" style={{ color: on ? c.accentText : c.text, fontFamily: font.semibold, fontSize: 16 }}>{String(ch)}</Text>
                  {on ? <Ionicons name="checkmark-circle" size={14} color={c.accentText} style={{ position: 'absolute', top: 5, right: 5 }} /> : null}
                </Pressable>
              </View>
            );
          })}
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button label="Check all" icon="checkmark-done" variant="secondary" size="sm" style={{ flex: 1 }}
          onPress={() => setAllChecks(db, subjectId, studentId, true).catch((e) => notify('Could not save', e.message))} />
        <Button label="Clear all" icon="close" variant="danger" size="sm" style={{ flex: 1 }}
          onPress={async () => {
            if (done.size && await confirm('Clear all ticks?', `Remove every ticked chapter for ${student.data!.name} in ${subjectName}?`, 'Clear', true)) {
              await setAllChecks(db, subjectId, studentId, false);
            }
          }} />
      </View>
    </Screen>
  );
}
