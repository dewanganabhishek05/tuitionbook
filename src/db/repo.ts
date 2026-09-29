// All reads and writes go through here. Every mutation calls notifyChange() so live queries refresh.
import type { SQLiteDatabase } from 'expo-sqlite';
import { transaction } from './tx';
import { currentMonth, daysBetween, daysInMonth, monthOf, monthRange, today } from '../lib/dates';
import { notifyChange } from './live';
import type {
  AttendanceStatus, CalendarDay, DaySummary, FeeRow, FeeStatus, Holiday, Payment, PaymentMode, RollEntry,
  Settings, Student, StudentListItem,
} from './types';

const now = () => new Date().toISOString();

/* ------------------------------------------------------------------ settings */

export const DEFAULT_SETTINGS: Settings = {
  tutor_name: '',
  center_name: '',
  fee_due_day: 10,
  default_fee: 0,
  country_code: '91',
  last_backup_at: '',
  last_backup_where: '',
};

export async function getSettings(db: SQLiteDatabase): Promise<Settings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key === 'fee_due_day') s.fee_due_day = Number(r.value) || DEFAULT_SETTINGS.fee_due_day;
    else if (r.key === 'default_fee') s.default_fee = Math.max(0, Math.floor(Number(r.value) || 0));
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

/* ------------------------------------------------------------------ students */

export async function listStudents(
  db: SQLiteDatabase,
  opts: { status?: 'active' | 'archived'; search?: string } = {},
): Promise<StudentListItem[]> {
  const where: string[] = ['s.status = ?'];
  const params: (string | number)[] = [opts.status ?? 'active'];
  if (opts.search?.trim()) {
    where.push("(s.name LIKE ? ESCAPE '\\' OR s.parent_phone LIKE ? ESCAPE '\\' OR s.class_name LIKE ? ESCAPE '\\')");
    const q = `%${opts.search.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    params.push(q, q, q);
  }
  return db.getAllAsync<StudentListItem>(
    `SELECT s.*,
       (SELECT COALESCE(SUM(MAX(0, d.amount_due - COALESCE(
           (SELECT SUM(p.amount) FROM payments p WHERE p.fee_due_id = d.id), 0))), 0)
         FROM fee_dues d WHERE d.student_id = s.id) AS outstanding
     FROM students s WHERE ${where.join(' AND ')}
     ORDER BY s.name COLLATE NOCASE`,
    params,
  );
}

export async function activeStudentCount(db: SQLiteDatabase): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM students WHERE status = 'active'");
  return r?.n ?? 0;
}

export async function getStudent(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<Student>('SELECT * FROM students WHERE id = ?', id);
}

export interface StudentInput {
  id?: number;
  name: string;
  parent_phone: string;
  class_name: string;
  joining_date: string;
  monthly_fee: number;
  notes: string;
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
    } else {
      const r = await tx.runAsync(
        `INSERT INTO students (name, parent_phone, class_name, joining_date, monthly_fee, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        s.name.trim(), s.parent_phone.trim(), s.class_name.trim(), s.joining_date, s.monthly_fee, s.notes.trim(), now(),
      );
      id = r.lastInsertRowId;
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

/** Everyone who had joined by `date` and is active, plus anyone already marked that day. */
export async function getRoll(db: SQLiteDatabase, date: string): Promise<RollEntry[]> {
  return db.getAllAsync<RollEntry>(
    `SELECT s.id AS student_id, s.name, s.parent_phone, s.class_name, s.joining_date, a.status, a.note
     FROM students s
     LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ?
     WHERE (s.status = 'active' AND s.joining_date <= ?) OR a.id IS NOT NULL
     ORDER BY s.name COLLATE NOCASE`,
    date, date,
  );
}

/** Saves the day's roll (a normal class day: removes any holiday on that date). */
export async function saveRoll(
  db: SQLiteDatabase, date: string, entries: { student_id: number; status: AttendanceStatus }[],
) {
  await transaction(db, async (tx) => {
    await tx.runAsync('DELETE FROM holidays WHERE date = ?', date);
    for (const e of entries) {
      await tx.runAsync(
        `INSERT INTO attendance (student_id, date, status) VALUES (?, ?, ?)
         ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status`,
        e.student_id, date, e.status,
      );
    }
  });
  notifyChange();
}

/** Sets (or clears, with status null) one student's mark for a day, e.g. leave with a reason. */
export async function setMark(
  db: SQLiteDatabase, date: string, studentId: number, status: AttendanceStatus | null, note = '',
) {
  if (status && status !== 'leave' && date > today()) throw new Error('Only leave can be added for a future date.');
  if (status === null) {
    await db.runAsync('DELETE FROM attendance WHERE student_id = ? AND date = ?', studentId, date);
  } else {
    await db.runAsync(
      `INSERT INTO attendance (student_id, date, status, note) VALUES (?, ?, ?, ?)
       ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, note = excluded.note`,
      studentId, date, status, note.trim(),
    );
  }
  notifyChange();
}

/** Clears the day completely: marks and holiday. */
export async function clearRoll(db: SQLiteDatabase, date: string) {
  await transaction(db, async (tx) => {
    await tx.runAsync('DELETE FROM attendance WHERE date = ?', date);
    await tx.runAsync('DELETE FROM holidays WHERE date = ?', date);
  });
  notifyChange();
}

/** Marks a day as a holiday (any date, including future ones). Marks for that day are removed. */
export async function setHoliday(db: SQLiteDatabase, date: string, name = '') {
  await transaction(db, async (tx) => {
    await tx.runAsync('DELETE FROM attendance WHERE date = ?', date);
    await tx.runAsync(
      'INSERT INTO holidays (date, name) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET name = excluded.name',
      date, name.trim(),
    );
  });
  notifyChange();
}

export async function removeHoliday(db: SQLiteDatabase, date: string) {
  await db.runAsync('DELETE FROM holidays WHERE date = ?', date);
  notifyChange();
}

export async function getHoliday(db: SQLiteDatabase, date: string) {
  return db.getFirstAsync<Holiday>('SELECT date, name FROM holidays WHERE date = ?', date);
}

export async function listHolidays(db: SQLiteDatabase, from: string, to: string) {
  return db.getAllAsync<Holiday>('SELECT date, name FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date', from, to);
}

export async function daySummary(db: SQLiteDatabase, date: string): Promise<DaySummary> {
  const c = await db.getFirstAsync<{ marked: number; present: number; absent: number; leave: number }>(
    `SELECT COUNT(*) AS marked, COALESCE(SUM(status = 'present'), 0) AS present,
       COALESCE(SUM(status = 'absent'), 0) AS absent, COALESCE(SUM(status = 'leave'), 0) AS leave
     FROM attendance WHERE date = ?`,
    date,
  );
  const e = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM students WHERE status = 'active' AND joining_date <= ?", date,
  );
  const h = await getHoliday(db, date);
  return {
    date,
    expected: e?.n ?? 0,
    marked: c?.marked ?? 0,
    present: c?.present ?? 0,
    absent: c?.absent ?? 0,
    leave: c?.leave ?? 0,
    holiday: !!h,
    holiday_name: h?.name ?? '',
  };
}

/** One entry per day of the month, for the calendar grid. */
export async function monthCalendar(db: SQLiteDatabase, month: string): Promise<CalendarDay[]> {
  const counts = await db.getAllAsync<{ date: string; marked: number; present: number; absent: number; leave: number }>(
    `SELECT date, COUNT(*) AS marked, SUM(status = 'present') AS present, SUM(status = 'absent') AS absent,
       SUM(status = 'leave') AS leave
     FROM attendance WHERE date LIKE ? GROUP BY date`,
    `${month}-%`,
  );
  const holidays = await listHolidays(db, `${month}-01`, `${month}-31`);
  const joins = await db.getAllAsync<{ joining_date: string }>(
    "SELECT joining_date FROM students WHERE status = 'active' ORDER BY joining_date",
  );
  const byDate = new Map(counts.map((r) => [r.date, r]));
  const hol = new Map(holidays.map((h) => [h.date, h]));
  const days: CalendarDay[] = [];
  for (let d = 1; d <= daysInMonth(month); d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const c = byDate.get(date);
    days.push({
      date,
      expected: joins.filter((j) => j.joining_date <= date).length,
      marked: c?.marked ?? 0,
      present: c?.present ?? 0,
      absent: c?.absent ?? 0,
      leave: c?.leave ?? 0,
      holiday: hol.get(date) ?? null,
    });
  }
  return days;
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
  const days = await db.getAllAsync<{ date: string; status: AttendanceStatus; note: string }>(
    'SELECT date, status, note FROM attendance WHERE student_id = ? AND date LIKE ? ORDER BY date',
    studentId, `${month}-%`,
  );
  const grouped = await db.getAllAsync<{ status: AttendanceStatus; n: number }>(
    'SELECT status, COUNT(*) AS n FROM attendance WHERE student_id = ? AND date LIKE ? GROUP BY status',
    studentId, `${month}-%`,
  );
  const holidays = await listHolidays(db, `${month}-01`, `${month}-31`);
  return { days, holidays, stats: stats(grouped) };
}

/** Each active student's totals for a month. */
export async function monthStudentStats(db: SQLiteDatabase, month: string) {
  return db.getAllAsync<{ id: number; name: string; present: number; absent: number; leave: number }>(
    `SELECT s.id, s.name,
       COALESCE(SUM(a.status = 'present'), 0) AS present, COALESCE(SUM(a.status = 'absent'), 0) AS absent,
       COALESCE(SUM(a.status = 'leave'), 0) AS leave
     FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.date LIKE ?
     WHERE s.status = 'active' GROUP BY s.id ORDER BY s.name COLLATE NOCASE`,
    `${month}-%`,
  );
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
    (SELECT MAX(p.paid_on) FROM payments p WHERE p.fee_due_id = d.id) AS last_paid_on, s.class_name
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
