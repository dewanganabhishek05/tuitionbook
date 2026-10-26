import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { Pressable, View } from 'react-native';
import { chapterCoverage, getSubject, setAllChaptersForAll, setChapterForAll } from '../../../db/notes';
import { useDb, useLive } from '../../../db/live';
import { Button, Card, Empty, Loading, Screen, Text, confirm, notify, tap } from '../../../ui/kit';
import { font, useTheme } from '../../../ui/theme';

const COLS = 5;

/** Tick a chapter for every student at once. */
export default function MarkForAll() {
  const db = useDb();
  const { c } = useTheme();
  const subjectId = Number(useLocalSearchParams<{ subjectId: string }>().subjectId);
  const subject = useLive((d) => getSubject(d, subjectId), [subjectId]);
  const cover = useLive((d) => chapterCoverage(d, subjectId), [subjectId]);
  const busy = useRef(new Set<number>());

  if (subject.loading || !cover.data) return <Screen back><Loading /></Screen>;
  if (!subject.data) return <Screen back title="Not found"><Text tone="muted">This subject no longer exists.</Text></Screen>;
  const { students, counts } = cover.data;
  const full = counts.filter((n) => n === students && students > 0).length;

  const toggle = async (ch: number) => {
    if (busy.current.has(ch)) return;
    busy.current.add(ch);
    try {
      // fully ticked -> clear for everyone; otherwise tick for everyone
      await setChapterForAll(db, subjectId, ch, counts[ch - 1] !== students);
    } catch (e) {
      notify('Could not save', (e as Error).message);
    } finally {
      busy.current.delete(ch);
    }
  };

  return (
    <Screen back title="All students" subtitle={subject.data.name}>
      {students === 0 ? (
        <Card><Empty icon="people-outline" title="No students yet" body="Add students first, then tick chapters for all of them here." /></Card>
      ) : (
        <>
          <Card>
            <Text v="number">{full}<Text v="body" tone="muted"> / {counts.length} chapters done by everyone</Text></Text>
            <Text v="caption" tone="muted" style={{ marginTop: 4 }}>
              Tap a chapter to tick it for all {students} students. Tap again to untick it for everyone.
            </Text>
          </Card>

          <Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 }}>
              {counts.map((n, i) => {
                const ch = i + 1;
                const all = n === students;
                const some = n > 0 && !all;
                return (
                  <View key={ch} style={{ width: `${100 / COLS}%`, padding: 3 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Chapter ${ch} for all students`}
                      onPress={() => { tap(); toggle(ch); }}
                      style={({ pressed }) => ({
                        aspectRatio: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 1,
                        backgroundColor: all ? c.accent : some ? c.accentSoft : c.surface2, opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text v="label" style={{ color: all ? c.accentText : c.text, fontFamily: font.semibold, fontSize: 16 }}>{String(ch)}</Text>
                      {some ? <Text v="caption" style={{ fontSize: 10, lineHeight: 12, color: c.accent }}>{n}/{students}</Text> : null}
                      {all ? <Ionicons name="checkmark-circle" size={14} color={c.accentText} style={{ position: 'absolute', top: 5, right: 5 }} /> : null}
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </Card>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="Check all" icon="checkmark-done" variant="secondary" size="sm" style={{ flex: 1 }}
              onPress={() => setAllChaptersForAll(db, subjectId, true).catch((e) => notify('Could not save', e.message))} />
            <Button label="Clear all" icon="close" variant="danger" size="sm" style={{ flex: 1 }}
              onPress={async () => {
                if (counts.some((n) => n > 0) && await confirm('Clear all ticks?', `Remove every tick in ${subject.data!.name} for all students?`, 'Clear', true)) {
                  await setAllChaptersForAll(db, subjectId, false);
                }
              }} />
          </View>
        </>
      )}
    </Screen>
  );
}
