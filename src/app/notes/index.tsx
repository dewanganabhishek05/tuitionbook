import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { listSubjects } from '../../db/notes';
import { useLive } from '../../db/live';
import { pct } from '../../lib/format';
import { Button, Card, Empty, Fab, Loading, Progress, Row, Screen, Text } from '../../ui/kit';
import { SubjectSheet } from '../../ui/SubjectSheet';
import { useTheme } from '../../ui/theme';

export default function NotesCheck() {
  const { c } = useTheme();
  const subjects = useLive(listSubjects);
  const [adding, setAdding] = useState(false);

  return (
    <View style={{ flex: 1 }}>
      <Screen back title="Notes Check" subtitle="For school students">
        {!subjects.data ? <Loading /> : subjects.data.length === 0 ? (
          <Card>
            <Empty
              icon="book-outline"
              title="No subjects yet"
              body="Add a subject, then tick off each chapter's notes for every student."
              action={<Button label="Add subject" icon="add" onPress={() => setAdding(true)} />}
            />
          </Card>
        ) : (
          <View style={{ gap: 10 }}>
            {subjects.data.map((s) => {
              const total = s.students * s.chapters;
              const p = pct(s.checked, total);
              return (
                <Card key={s.id} padded={false}>
                  <Row
                    left={
                      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="book" size={20} color={c.accent} />
                      </View>
                    }
                    title={s.name}
                    subtitle={`${s.chapters} chapters · ${s.students} ${s.students === 1 ? 'student' : 'students'}`}
                    right={<Text v="label" tone="accent">{total ? `${p}%` : '—'}</Text>}
                    onPress={() => router.push({ pathname: '/notes/[subjectId]', params: { subjectId: String(s.id) } })}
                  />
                  {total > 0 ? <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}><Progress value={p} tone="accent" /></View> : null}
                </Card>
              );
            })}
          </View>
        )}
      </Screen>
      {subjects.data && subjects.data.length > 0 ? <Fab label="Subject" onPress={() => setAdding(true)} /> : null}
      <SubjectSheet visible={adding} onClose={() => setAdding(false)} />
    </View>
  );
}
