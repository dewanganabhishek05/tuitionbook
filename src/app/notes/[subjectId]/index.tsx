import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { deleteSubject, getSubject, listSubjectStudents } from '../../../db/notes';
import { useDb, useLive } from '../../../db/live';
import { pct } from '../../../lib/format';
import { Avatar, Button, Card, Empty, IconButton, Loading, Progress, Row, Screen, Text, confirm, goBack } from '../../../ui/kit';
import { SubjectSheet } from '../../../ui/SubjectSheet';

export default function SubjectStudents() {
  const db = useDb();
  const subjectId = Number(useLocalSearchParams<{ subjectId: string }>().subjectId);
  const subject = useLive((d) => getSubject(d, subjectId), [subjectId]);
  const students = useLive((d) => listSubjectStudents(d, subjectId), [subjectId]);
  const [editing, setEditing] = useState(false);

  if (subject.loading || !students.data) return <Screen back><Loading /></Screen>;
  if (!subject.data) return <Screen back title="Not found"><Text tone="muted">This subject no longer exists.</Text></Screen>;
  const sub = subject.data;

  const remove = async () => {
    if (await confirm('Delete subject?', `“${sub.name}” and every student's ticks in it will be removed.`, 'Delete', true)) {
      await deleteSubject(db, subjectId);
      goBack();
    }
  };

  return (
    <>
      <Screen
        back
        title={sub.name}
        subtitle={`${sub.chapters} chapters`}
        right={
          <View style={{ flexDirection: 'row' }}>
            <IconButton name="create-outline" label="Edit subject" onPress={() => setEditing(true)} />
            <IconButton name="trash-outline" label="Delete subject" onPress={remove} />
          </View>
        }
      >
        {students.data.length === 0 ? (
          <Card>
            <Empty icon="people-outline" title="No students yet" body="Add students first, then check their notes here."
              action={<Button label="Add student" icon="add" onPress={() => router.push('/student/form')} />} />
          </Card>
        ) : (
          <View style={{ gap: 10 }}>
            <Button
              label="Mark chapters for all students"
              icon="checkmark-done"
              onPress={() => router.push({ pathname: '/notes/[subjectId]/all', params: { subjectId: String(subjectId) } })}
            />
            {students.data.map((s) => (
              <Card key={s.student_id} padded={false}>
                <Row
                  left={<Avatar name={s.name} />}
                  title={s.name}
                  subtitle={s.class_name || null}
                  right={<Text v="label" tone={s.checked === sub.chapters ? 'good' : 'muted'}>{s.checked}/{sub.chapters}</Text>}
                  onPress={() => router.push({ pathname: '/notes/[subjectId]/[studentId]', params: { subjectId: String(subjectId), studentId: String(s.student_id) } })}
                />
                <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
                  <Progress value={pct(s.checked, sub.chapters)} tone={s.checked === sub.chapters ? 'good' : 'accent'} />
                </View>
              </Card>
            ))}
          </View>
        )}
      </Screen>
      <SubjectSheet visible={editing} subject={sub} onClose={() => setEditing(false)} />
    </>
  );
}
