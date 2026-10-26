// Notes Check: per subject, which chapters' notes each student has completed.
import type { SQLiteDatabase } from 'expo-sqlite';
import { transaction } from './tx';
import { notifyChange } from './live';
import { DEFAULT_CHAPTERS, MAX_CHAPTERS, type Subject, type SubjectListItem, type SubjectStudent } from './types';

const now = () => new Date().toISOString();

export function validateSubject(name: string, chapters: number) {
  if (!name.trim()) throw new Error('Enter a subject name');
  if (name.trim().length > 60) throw new Error('Subject name is too long');
  if (!Number.isInteger(chapters) || chapters < 1 || chapters > MAX_CHAPTERS) {
    throw new Error(`Chapters must be a whole number from 1 to ${MAX_CHAPTERS}`);
  }
}

export async function listSubjects(db: SQLiteDatabase): Promise<SubjectListItem[]> {
  return db.getAllAsync<SubjectListItem>(
    `SELECT s.id, s.name, s.chapters, s.created_at,
       (SELECT COUNT(*) FROM students WHERE status = 'active') AS students,
       (SELECT COUNT(*) FROM note_checks nc JOIN students st ON st.id = nc.student_id
          WHERE nc.subject_id = s.id AND st.status = 'active') AS checked
     FROM subjects s ORDER BY s.name COLLATE NOCASE`,
  );
}

export async function getSubject(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<Subject>('SELECT id, name, chapters, created_at FROM subjects WHERE id = ?', id);
}

/** Creates (no id) or updates a subject. Lowering the chapter count drops checks beyond it. */
export async function saveSubject(db: SQLiteDatabase, input: { id?: number; name: string; chapters?: number }) {
  const chapters = input.chapters ?? DEFAULT_CHAPTERS;
  validateSubject(input.name, chapters);
  const name = input.name.trim();
  const dupe = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM subjects WHERE name = ? COLLATE NOCASE AND id <> ?', name, input.id ?? -1,
  );
  if (dupe) throw new Error(`You already have a subject called “${name}”`);
  let id = input.id ?? 0;
  await transaction(db, async (tx) => {
    if (input.id) {
      await tx.runAsync('UPDATE subjects SET name = ?, chapters = ? WHERE id = ?', name, chapters, input.id);
      await tx.runAsync('DELETE FROM note_checks WHERE subject_id = ? AND chapter > ?', input.id, chapters);
    } else {
      const r = await tx.runAsync('INSERT INTO subjects (name, chapters, created_at) VALUES (?, ?, ?)', name, chapters, now());
      id = r.lastInsertRowId;
    }
  });
  notifyChange();
  return id;
}

export async function deleteSubject(db: SQLiteDatabase, id: number) {
  await transaction(db, async (tx) => {
    await tx.runAsync('DELETE FROM note_checks WHERE subject_id = ?', id);
    await tx.runAsync('DELETE FROM subjects WHERE id = ?', id);
  });
  notifyChange();
}

/** Every active student with how many chapters are checked for the subject. */
export async function listSubjectStudents(db: SQLiteDatabase, subjectId: number): Promise<SubjectStudent[]> {
  return db.getAllAsync<SubjectStudent>(
    `SELECT s.id AS student_id, s.name, s.class_name,
       (SELECT COUNT(*) FROM note_checks nc WHERE nc.subject_id = ? AND nc.student_id = s.id) AS checked
     FROM students s WHERE s.status = 'active' ORDER BY s.name COLLATE NOCASE`,
    subjectId,
  );
}

export async function getChecks(db: SQLiteDatabase, subjectId: number, studentId: number): Promise<number[]> {
  const rows = await db.getAllAsync<{ chapter: number }>(
    'SELECT chapter FROM note_checks WHERE subject_id = ? AND student_id = ? ORDER BY chapter', subjectId, studentId,
  );
  return rows.map((r) => r.chapter);
}

/** Ticks the chapter if it was clear, clears it if it was ticked. Returns the new state. */
export async function toggleCheck(db: SQLiteDatabase, subjectId: number, studentId: number, chapter: number) {
  const subject = await getSubject(db, subjectId);
  if (!subject) throw new Error('This subject no longer exists');
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > subject.chapters) throw new Error('No such chapter');
  const del = await db.runAsync(
    'DELETE FROM note_checks WHERE subject_id = ? AND student_id = ? AND chapter = ?', subjectId, studentId, chapter,
  );
  let on = false;
  if (del.changes === 0) {
    await db.runAsync(
      'INSERT OR IGNORE INTO note_checks (subject_id, student_id, chapter, checked_at) VALUES (?, ?, ?, ?)',
      subjectId, studentId, chapter, now(),
    );
    on = true;
  }
  notifyChange();
  return on;
}

/** Ticks every chapter, or clears them all. */
export async function setAllChecks(db: SQLiteDatabase, subjectId: number, studentId: number, on: boolean) {
  const subject = await getSubject(db, subjectId);
  if (!subject) throw new Error('This subject no longer exists');
  await transaction(db, async (tx) => {
    await tx.runAsync('DELETE FROM note_checks WHERE subject_id = ? AND student_id = ?', subjectId, studentId);
    if (on) {
      const stamp = now();
      for (let ch = 1; ch <= subject.chapters; ch++) {
        await tx.runAsync(
          'INSERT INTO note_checks (subject_id, student_id, chapter, checked_at) VALUES (?, ?, ?, ?)',
          subjectId, studentId, ch, stamp,
        );
      }
    }
  });
  notifyChange();
}

/** For each chapter (index 0 = chapter 1): how many active students have it ticked. */
export async function chapterCoverage(db: SQLiteDatabase, subjectId: number) {
  const subject = await getSubject(db, subjectId);
  const total = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM students WHERE status = 'active'");
  const rows = await db.getAllAsync<{ chapter: number; n: number }>(
    `SELECT nc.chapter, COUNT(*) AS n FROM note_checks nc JOIN students s ON s.id = nc.student_id
     WHERE nc.subject_id = ? AND s.status = 'active' GROUP BY nc.chapter`, subjectId,
  );
  const counts = Array.from({ length: subject?.chapters ?? 0 }, () => 0);
  for (const r of rows) if (r.chapter >= 1 && r.chapter <= counts.length) counts[r.chapter - 1] = r.n;
  return { students: total?.n ?? 0, counts };
}

/** Ticks (or clears) one chapter for every active student at once. */
export async function setChapterForAll(db: SQLiteDatabase, subjectId: number, chapter: number, on: boolean) {
  const subject = await getSubject(db, subjectId);
  if (!subject) throw new Error('This subject no longer exists');
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > subject.chapters) throw new Error('No such chapter');
  if (on) {
    await db.runAsync(
      `INSERT OR IGNORE INTO note_checks (subject_id, student_id, chapter, checked_at)
       SELECT ?, id, ?, ? FROM students WHERE status = 'active'`, subjectId, chapter, now(),
    );
  } else {
    await db.runAsync(
      `DELETE FROM note_checks WHERE subject_id = ? AND chapter = ?
       AND student_id IN (SELECT id FROM students WHERE status = 'active')`, subjectId, chapter,
    );
  }
  notifyChange();
}

/** Ticks every chapter for every active student, or clears them all. */
export async function setAllChaptersForAll(db: SQLiteDatabase, subjectId: number, on: boolean) {
  const subject = await getSubject(db, subjectId);
  if (!subject) throw new Error('This subject no longer exists');
  await transaction(db, async (tx) => {
    await tx.runAsync(
      `DELETE FROM note_checks WHERE subject_id = ? AND student_id IN (SELECT id FROM students WHERE status = 'active')`, subjectId,
    );
    if (on) {
      const stamp = now();
      for (let ch = 1; ch <= subject.chapters; ch++) {
        await tx.runAsync(
          `INSERT OR IGNORE INTO note_checks (subject_id, student_id, chapter, checked_at)
           SELECT ?, id, ?, ? FROM students WHERE status = 'active'`, subjectId, ch, stamp,
        );
      }
    }
  });
  notifyChange();
}
