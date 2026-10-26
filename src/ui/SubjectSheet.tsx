import { useState } from 'react';
import { saveSubject } from '../db/notes';
import { useDb } from '../db/live';
import { DEFAULT_CHAPTERS, MAX_CHAPTERS, type Subject } from '../db/types';
import { Button, Field, Sheet } from './kit';

/** Add a subject (no `subject`) or edit one. Calls `onSaved` with the subject id. */
type Props = { visible: boolean; subject?: Subject | null; onClose: () => void; onSaved?: (id: number) => void };

export function SubjectSheet(props: Props) {
  // Re-mounted each time it opens so the fields start from the subject being edited.
  return <SubjectForm key={`${props.visible}-${props.subject?.id ?? 'new'}-${props.subject?.chapters ?? ''}`} {...props} />;
}

function SubjectForm({ visible, subject, onClose, onSaved }: Props) {
  const db = useDb();
  const [name, setName] = useState(subject?.name ?? '');
  const [chapters, setChapters] = useState(String(subject?.chapters ?? DEFAULT_CHAPTERS));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!/^\d+$/.test(chapters.trim())) return setError(`Chapters must be a whole number from 1 to ${MAX_CHAPTERS}`);
    setSaving(true);
    try {
      const id = await saveSubject(db, { id: subject?.id, name, chapters: Number(chapters) });
      onClose();
      onSaved?.(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={subject ? 'Edit subject' : 'Add subject'}
      footer={<Button label={subject ? 'Save' : 'Add subject'} icon="checkmark" onPress={save} loading={saving} />}
    >
      <Field label="Subject" value={name} onChangeText={setName} placeholder="e.g. Maths" autoCapitalize="words" autoFocus />
      <Field
        label="Number of chapters"
        value={chapters}
        onChangeText={setChapters}
        keyboardType="number-pad"
        error={error}
        hint={subject ? 'Lowering this removes ticks on the chapters that are cut' : '30 by default — change it if this subject has fewer or more'}
      />
    </Sheet>
  );
}
