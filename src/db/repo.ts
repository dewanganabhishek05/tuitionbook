// All reads and writes go through here. Every mutation calls notifyChange() so live queries refresh.
import type { SQLiteDatabase } from 'expo-sqlite';
import { transaction } from './tx';
import { currentMonth, daysBetween, isoWeekday, monthOf, monthRange, today } from '../lib/dates';
import { notifyChange } from './live';
import type {
  AttendanceStatus, Batch, BatchDay, BatchWithCount, FeeRow, FeeStatus, Payment, PaymentMode,
  RollEntry, Settings, Student, StudentListItem,
} from './types';

const now = () => new Date().toISOString();

/* ------------------------------------------------------------------ settings */

export const DEFAULT_SETTINGS: Settings = {
  tutor_name: '',
  center_name: '',
  fee_due_day: 10,
  country_code: '91',
  last_backup_at: '',
  last_backup_where: '',
};

export async function getSettings(db: SQLiteDatabase): Promise<Settings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key === 'fee_due_day') s.fee_due_day = Number(r.value) || DEFAULT_SETTINGS.fee_due_day;
    else if (r.key in s) (s as unknown as Record<string, string>)[r.key] = r.value ?? '';
  }
  return s;
}

export async function setSettings(db: SQLiteDatabase, patch: Partial<Settings>) {
  for (const [key, value] of Object.entries(patch)) {
    await db.runAsync(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key, String(value),
    );
  }
  notifyChange();
}

/* ------------------------------------------------------------------- batches */

export async function listBatches(db: SQLiteDatabase, includeArchived = false): Promise<BatchWithCount[]> {
  return db.getAllAsync<BatchWithCount>(
    `SELECT b.*, (SELECT COUNT(*) FROM enrollments e JOIN students s ON s.id = e.student_id
                  WHERE e.batch_id = b.id AND s.status = 'active') AS student_count
     FROM batches b ${includeArchived ? '' : 'WHERE b.archived = 0'}
     ORDER BY b.archived, b.start_time, b.name`,
  );
}

export async function getBatch(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<Batch>('SELECT * FROM batches WHERE id = ?', id);
}

export async function saveBatch(
  db: SQLiteDatabase,
  b: { id?: number; name: string; days: number[]; start_time: string; default_fee: number },
): Promise<number> {
  const days = [...new Set(b.days)].sort().join(',');
  if (b.id) {
    await db.runAsync(
      'UPDATE batches SET name = ?, days = ?, start_time = ?, default_fee = ? WHERE id = ?',
      b.name.trim(), days, b.start_time, b.default_fee, b.id,
    );
    notifyChange();
    return b.id;
  }
  const r = await db.runAsync(
    'INSERT INTO batches (name, days, start_time, default_fee, created_at) VALUES (?, ?, ?, ?, ?)',
    b.name.trim(), days, b.start_time, b.default_fee, now(),
  );
  notifyChange();
  return r.lastInsertRowId;
}

export async function setBatchArchived(db: SQLiteDatabase, id: number, archived: boolean) {
  await db.runAsync('UPDATE batches SET archived = ? WHERE id = ?', archived ? 1 : 0, id);
  notifyChange();
}

export async function deleteBatch(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM batches WHERE id = ?', id);
  notifyChange();
}

export function batchDays(b: Pick<Batch, 'days'>): number[] {
  return b.days ? b.days.split(',').map(Number).filter(Boolean) : [];
}

/* ------------------------------------------------------------------ students */

export async function listStudents(
  db: SQLiteDatabase,
  opts: { status?: 'active' | 'archived'; batchId?: number | null; search?: string } = {},
): Promise<StudentListItem[]> {
  const where: string[] = ['s.status = ?'];
  const params: (string | number)[] = [opts.status ?? 'active'];
  if (opts.batchId) {
    where.push('EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id AND e.batch_id = ?)');
    params.push(opts.batchId);
  }
  if (opts.search?.trim()) {
    where.push("(s.name LIKE ? ESCAPE '\\' OR s.parent_phone LIKE ? ESCAPE '\\')");
    const q = `%${opts.search.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    params.push(q, q);
  }
  return db.getAllAsync<StudentListItem>(
    `SELECT s.*,
       (SELECT group_concat(b.name, ' · ') FROM enrollments e JOIN batches b ON b.id = e.batch_id
         WHERE e.student_id = s.id) AS batch_names,
       (SELECT COALESCE(SUM(MAX(0, d.amount_due - COALESCE(
           (SELECT SUM(p.amount) FROM payments p WHERE p.fee_due_id = d.id), 0))), 0)
         FROM fee_dues d WHERE d.student_id = s.id) AS outstanding
     FROM students s WHERE ${where.join(' AND ')}
     ORDER BY s.name COLLATE NOCASE`,
    params,
  );
}

export async function getStudent(db: SQLiteDatabase, id: number) {
  const student = await db.getFirstAsync<Student>('SELECT * FROM students WHERE id = ?', id);
  if (!student) return null;
  const batches = await db.getAllAsync<Batch>(
    `SELECT b.* FROM batches b JOIN enrollments e ON e.batch_id = b.id WHERE e.student_id = ? ORDER BY b.start_time`,
    id,
  );
  return { student, batches };
}

export interface StudentInput {
  id?: number;
  name: string;
  parent_phone: string;
  class_name: string;
  joining_date: string;
  monthly_fee: number;
  notes: string;
  batchIds: number[];
}

export async function saveStudent(db: SQLiteDatabase, s: StudentInput): Promise<number> {
  let id = s.id ?? 0;
  const cm = currentMonth();
  await transaction(db, async (tx) => {
    if (id) {
      const prev = await tx.getFirstAsync<{ monthly_fee: number; fees_resume: string | null }>(
        'SELECT monthly_fee, fees_resume FROM students WHERE id = ?', id,
      );
      // Going from no fee to a fee starts charging this month, not retroactively.
      const resume = prev && prev.monthly_fee === 0 && s.monthly_fee > 0 && monthOf(s.joining_date) < cm
        ? (prev.fees_resume && prev.fees_resume > cm ? prev.fees_resume : cm)
        : prev?.fees_resume ?? null;
      await tx.runAsync(
        `UPDATE students SET name = ?, parent_phone = ?, class_name = ?, joining_date = ?, monthly_fee = ?, notes = ?,
           fees_resume = ? WHERE id = ?`,
        s.name.trim(), s.parent_phone.trim(), s.class_name.trim(), s.joining_date, s.monthly_fee, s.notes.trim(), resume, id,
      );
      // A fee change applies from this month on; earlier months keep what was charged.
      await tx.runAsync(
        `UPDATE fee_dues SET amount_due = ? WHERE student_id = ? AND month >= ?
           AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.fee_due_id = fee_dues.id)`,
        s.monthly_fee, id, cm,
      );
      // Joining date moved later, or fee set to 0 from now on: drop unpaid dues that no longer apply.
      // (Past arrears stay when the fee becomes 0: that money is still owed.)
      await tx.runAsync(
        `DELETE FROM fee_dues WHERE student_id = ? AND (month < ? OR (? = 0 AND month >= ?))
           AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.fee_due_id = fee_dues.id)`,
        id, monthOf(s.joining_date), s.monthly_fee, cm,
      );
      await tx.runAsync('DELETE FROM enrollments WHERE student_id = ?', id);
    } else {
      const r = await tx.runAsync(
        `INSERT INTO students (name, parent_phone, class_name, joining_date, monthly_fee, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        s.name.trim(), s.parent_phone.trim(), s.class_name.trim(), s.joining_date, s.monthly_fee, s.notes.trim(), now(),
      );
      id = r.lastInsertRowId;
    }
    for (const b of new Set(s.batchIds)) {
      await tx.runAsync('INSERT OR IGNORE INTO enrollments (student_id, batch_id) VALUES (?, ?)', id, b);
    }
  });
  await ensureDues(db, id, true); // full fill, so an earlier joining date gets its missing months
  notifyChange();
  return id;
}

export async function setStudentArchived(db: SQLiteDatabase, id: number, archived: boolean) {
  if (archived) {
    await db.runAsync("UPDATE students SET status = 'archived' WHERE id = ?", id);
  } else {
    // Restored: fees start again this month; the months they were away are not charged.
    await db.runAsync("UPDATE students SET status = 'active', fees_resume = ? WHERE id = ?", currentMonth(), id);
    await ensureDues(db, id);
  }
  notifyChange();
}

export async function deleteStudent(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM students WHERE id = ?', id);
  notifyChange();
}

/* ---------------------------------------------------------------- attendance */

export async function getRoll(db: SQLiteDatabase, batchId: number, date: string): Promise<RollEntry[]> {
  // Active students in the batch, plus anyone who already has a record that day (e.g. archived since).
  return db.getAllAsync<RollEntry>(
    `SELECT s.id AS student_id, s.name, s.parent_phone, a.status
     FROM students s
     LEFT JOIN attendance a ON a.student_id = s.id AND a.batch_id = ? AND a.date = ?
     WHERE (s.status = 'active' AND s.joining_date <= ?
            AND EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id AND e.batch_id = ?))
        OR a.id IS NOT NULL
     ORDER BY s.name COLLATE NOCASE`,
    batchId, date, date, batchId,
  );
}

export async function saveRoll(
  db: SQLiteDatabase, batchId: number, date: string,
  entries: { student_id: number; status: AttendanceStatus }[],
) {
  await transaction(db, async (tx) => {
    for (const e of entries) {
      await tx.runAsync(
        `INSERT INTO attendance (batch_id, student_id, date, status) VALUES (?, ?, ?, ?)
         ON CONFLICT(batch_id, student_id, date) DO UPDATE SET status = excluded.status`,
        batchId, e.student_id, date, e.status,
      );
    }
  });
  notifyChange();
}

export async function clearRoll(db: SQLiteDatabase, batchId: number, date: string) {
  await db.runAsync('DELETE FROM attendance WHERE batch_id = ? AND date = ?', batchId, date);
  notifyChange();
}

export async function getBatchDays(db: SQLiteDatabase, date: string): Promise<BatchDay[]> {
  const batches = await listBatches(db);
  const counts = await db.getAllAsync<{ batch_id: number; status: AttendanceStatus; n: number }>(
    'SELECT batch_id, status, COUNT(*) AS n FROM attendance WHERE date = ? GROUP BY batch_id, status',
    date,
  );
  const wd = isoWeekday(date);
  return batches.map((batch) => {
    const c = counts.filter((x) => x.batch_id === batch.id);
    const get = (s: AttendanceStatus) => c.find((x) => x.status === s)?.n ?? 0;
    const marked = c.reduce((a, x) => a + x.n, 0);
    return {
      batch,
      scheduled: batchDays(batch).includes(wd),
      marked,
      present: get('present'),
      absent: get('absent'),
      holiday: marked > 0 && get('holiday') === marked,
    };
  });
}

export interface AttendanceStats { present: number; absent: number; leave: number; percent: number }

function stats(rows: { status: AttendanceStatus; n: number }[]): AttendanceStats {
  const get = (s: AttendanceStatus) => rows.find((r) => r.status === s)?.n ?? 0;
  const present = get('present');
  const absent = get('absent');
  const counted = present + absent; // leave and holidays don't count against the student
  return { present, absent, leave: get('leave'), percent: counted ? Math.round((present / counted) * 100) : 0 };
}

export async function studentMonthAttendance(db: SQLiteDatabase, studentId: number, month: string) {
  const days = await db.getAllAsync<{ date: string; status: AttendanceStatus; batch_name: string }>(
    `SELECT a.date, a.status, b.name AS batch_name FROM attendance a JOIN batches b ON b.id = a.batch_id
     WHERE a.student_id = ? AND a.date LIKE ? ORDER BY a.date`,
    studentId, `${month}-%`,
  );
  const grouped = await db.getAllAsync<{ status: AttendanceStatus; n: number }>(
    'SELECT status, COUNT(*) AS n FROM attendance WHERE student_id = ? AND date LIKE ? GROUP BY status',
    studentId, `${month}-%`,
  );
  return { days, stats: stats(grouped) };
}

export async function batchMonthAttendance(db: SQLiteDatabase, batchId: number, month: string) {
  const dates = await db.getAllAsync<{ date: string; present: number; absent: number; holiday: number; total: number }>(
    `SELECT date,
       SUM(status = 'present') AS present, SUM(status = 'absent') AS absent,
       SUM(status = 'holiday') AS holiday, COUNT(*) AS total
     FROM attendance WHERE batch_id = ? AND date LIKE ? GROUP BY date ORDER BY date DESC`,
    batchId, `${month}-%`,
  );
  const students = await db.getAllAsync<{ id: number; name: string; present: number; absent: number }>(
    `SELECT s.id, s.name,
       COALESCE(SUM(a.status = 'present'), 0) AS present, COALESCE(SUM(a.status = 'absent'), 0) AS absent
     FROM students s JOIN enrollments e ON e.student_id = s.id AND e.batch_id = ?
     LEFT JOIN attendance a ON a.student_id = s.id AND a.batch_id = e.batch_id AND a.date LIKE ?
     WHERE s.status = 'active' GROUP BY s.id ORDER BY s.name COLLATE NOCASE`,
    batchId, `${month}-%`,
  );
  return { dates, students };
}

/* ---------------------------------------------------------------------- fees */

/**
 * Creates the monthly due for every active student, from their joining month (or the month
 * fees resumed after an archive) up to this month. Safe to call often: it only fills months
 * that are missing. `full` also fills gaps before the latest due (used after editing a student).
 */
export async function ensureDues(db: SQLiteDatabase, studentId?: number, full = false) {
  const cm = currentMonth();
  const rows = await db.getAllAsync<{
    id: number; joining_date: string; fees_resume: string | null; monthly_fee: number; last: string | null;
  }>(
    `SELECT s.id, s.joining_date, s.fees_resume, s.monthly_fee,
       (SELECT MAX(month) FROM fee_dues d WHERE d.student_id = s.id) AS last
     FROM students s WHERE s.status = 'active' AND s.monthly_fee > 0 ${studentId ? 'AND s.id = ?' : ''}`,
    studentId ? [studentId] : [],
  );
  let created = 0;
  await transaction(db, async (tx) => {
    for (const s of rows) {
      const joined = monthOf(s.joining_date);
      const from = s.fees_resume && s.fees_resume > joined ? s.fees_resume : joined;
      if (from > cm) continue;
      for (const m of monthRange(from, cm)) {
        if (!full && s.last && m <= s.last) continue;
        const r = await tx.runAsync(
          'INSERT OR IGNORE INTO fee_dues (student_id, month, amount_due) VALUES (?, ?, ?)', s.id, m, s.monthly_fee,
        );
        created += r.changes;
      }
    }
  });
  if (created) notifyChange();
  return created;
}

const FEE_ROW_SELECT = `
  SELECT d.id, d.student_id, d.month, d.amount_due, s.name, s.parent_phone,
    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.fee_due_id = d.id), 0) AS paid,
    (SELECT MAX(p.paid_on) FROM payments p WHERE p.fee_due_id = d.id) AS last_paid_on,
    (SELECT group_concat(b.name, ' · ') FROM enrollments e JOIN batches b ON b.id = e.batch_id
      WHERE e.student_id = s.id) AS batch_names
  FROM fee_dues d JOIN students s ON s.id = d.student_id`;

export async function listFeesForMonth(db: SQLiteDatabase, month: string): Promise<FeeRow[]> {
  return db.getAllAsync<FeeRow>(`${FEE_ROW_SELECT} WHERE d.month = ? ORDER BY s.name COLLATE NOCASE`, month);
}

export async function listFeesForStudent(db: SQLiteDatabase, studentId: number): Promise<FeeRow[]> {
  return db.getAllAsync<FeeRow>(`${FEE_ROW_SELECT} WHERE d.student_id = ? ORDER BY d.month DESC`, studentId);
}

export async function getFeeRow(db: SQLiteDatabase, dueId: number) {
  return db.getFirstAsync<FeeRow>(`${FEE_ROW_SELECT} WHERE d.id = ?`, dueId);
}

export function feeStatus(row: Pick<FeeRow, 'amount_due' | 'paid' | 'month'>, dueDay: number): FeeStatus {
  if (row.paid >= row.amount_due) return 'paid';
  const cm = currentMonth();
  const late = row.month < cm || (row.month === cm && Number(today().slice(8)) > dueDay);
  if (late) return 'overdue';
  return row.paid > 0 ? 'partial' : 'pending';
}

/** Days past the due date (0 when not yet late). */
export function daysOverdue(month: string, dueDay: number): number {
  const due = `${month}-${String(Math.min(dueDay, 28)).padStart(2, '0')}`;
  return Math.max(0, daysBetween(due, today()));
}

export async function listPayments(db: SQLiteDatabase, dueId: number) {
  return db.getAllAsync<Payment>('SELECT * FROM payments WHERE fee_due_id = ? ORDER BY paid_on DESC, id DESC', dueId);
}

export async function addPayment(
  db: SQLiteDatabase, p: { fee_due_id: number; amount: number; paid_on: string; mode: PaymentMode; note: string },
) {
  if (!Number.isInteger(p.amount) || p.amount <= 0) throw new Error('Amount must be a whole number above 0.');
  if (p.paid_on > today()) throw new Error('Payment date can’t be in the future.');
  const due = await getFeeRow(db, p.fee_due_id);
  if (!due) throw new Error('This fee no longer exists.');
  if (p.amount > due.amount_due - due.paid) {
    throw new Error(`That’s more than the balance of ₹${Math.max(0, due.amount_due - due.paid).toLocaleString('en-IN')}.`);
  }
  const r = await db.runAsync(
    'INSERT INTO payments (fee_due_id, amount, paid_on, mode, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    p.fee_due_id, p.amount, p.paid_on, p.mode, p.note.trim(), now(),
  );
  notifyChange();
  return r.lastInsertRowId;
}

export async function deletePayment(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM payments WHERE id = ?', id);
  notifyChange();
}

export async function setDueAmount(db: SQLiteDatabase, dueId: number, amount: number) {
  if (!Number.isInteger(amount) || amount < 0) throw new Error('Amount must be a whole number, 0 or more.');
  await db.runAsync('UPDATE fee_dues SET amount_due = ? WHERE id = ?', amount, dueId);
  notifyChange();
}

export async function monthSummary(db: SQLiteDatabase, month: string) {
  const r = await db.getFirstAsync<{ expected: number; collected: number; students: number; cleared: number }>(
    `SELECT COALESCE(SUM(amount_due), 0) AS expected, COALESCE(SUM(MIN(paid, amount_due)), 0) AS collected,
            COUNT(*) AS students, COALESCE(SUM(paid >= amount_due), 0) AS cleared
     FROM (SELECT d.amount_due, COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.fee_due_id = d.id), 0) AS paid
           FROM fee_dues d WHERE d.month = ?)`,
    month,
  );
  const expected = r?.expected ?? 0;
  const collected = r?.collected ?? 0;
  return { expected, collected, pending: expected - collected, students: r?.students ?? 0, cleared: r?.cleared ?? 0 };
}

/** Outstanding from months before `month` (arrears). */
export async function arrearsBefore(db: SQLiteDatabase, month: string) {
  const r = await db.getFirstAsync<{ total: number; students: number }>(
    `SELECT COALESCE(SUM(bal), 0) AS total, COUNT(DISTINCT student_id) AS students FROM (
       SELECT d.student_id, d.amount_due - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.fee_due_id = d.id), 0) AS bal
       FROM fee_dues d WHERE d.month < ?) WHERE bal > 0`,
    month,
  );
  return { total: r?.total ?? 0, students: r?.students ?? 0 };
}
