// Builds report data from the database. Pure data in, no formatting of files here.
import type { SQLiteDatabase } from 'expo-sqlite';
import { feeStatus, getSettings, listFeesForMonth, listFeesForStudent } from '../db/repo';
import { addMonths, currentMonth, daysInMonth, formatDate, formatMonth, isoWeekday, monthRange, monthOf, today } from '../lib/dates';
import { pct, rupees } from '../lib/format';
import type { Cell, Report, Table } from './types';

const STATUS_LABEL = { paid: 'Paid', partial: 'Partial', pending: 'Pending', overdue: 'Overdue' } as const;
const MODE = { cash: 'Cash', upi: 'UPI', bank: 'Bank', other: 'Other' } as Record<string, string>;
const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // Sunday first, to match Date#getDay

async function meta(db: SQLiteDatabase) {
  const s = await getSettings(db);
  return { owner: s.center_name || s.tutor_name || 'TuitionBook', dueDay: s.fee_due_day, generatedOn: formatDate(today()) };
}

const slug = (s: string) => s.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'report';

interface Stu { id: number; name: string; class_name: string; parent_phone: string; joining_date: string }

async function activeStudents(db: SQLiteDatabase, joinedBy?: string): Promise<Stu[]> {
  return db.getAllAsync<Stu>(
    `SELECT id, name, class_name, parent_phone, joining_date FROM students
     WHERE status = 'active' ${joinedBy ? 'AND joining_date <= ?' : ''} ORDER BY name COLLATE NOCASE`,
    ...(joinedBy ? [joinedBy] : []),
  );
}

/* --------------------------------------------------------------- attendance */

export async function attendanceReport(db: SQLiteDatabase, month: string): Promise<Report> {
  const m = await meta(db);
  const n = daysInMonth(month);
  const last = `${month}-${String(n).padStart(2, '0')}`;
  const students = await activeStudents(db, last);
  if (!students.length) throw new Error('There are no students to report on for this month.');
  const marks = await db.getAllAsync<{ student_id: number; date: string; status: string }>(
    'SELECT student_id, date, status FROM attendance WHERE date LIKE ?', `${month}-%`,
  );
  const holidays = await db.getAllAsync<{ date: string; name: string }>(
    'SELECT date, name FROM holidays WHERE date LIKE ? ORDER BY date', `${month}-%`,
  );
  const hol = new Set(holidays.map((h) => h.date));
  const byKey = new Map(marks.map((x) => [`${x.student_id}|${x.date}`, x.status]));
  const letter: Record<string, string> = { present: 'P', absent: 'A', leave: 'L' };

  let tp = 0; let ta = 0;
  const summaryRows: Cell[][] = students.map((s) => {
    let p = 0; let a = 0; let l = 0;
    for (const x of marks) {
      if (x.student_id !== s.id) continue;
      if (x.status === 'present') p++; else if (x.status === 'absent') a++; else if (x.status === 'leave') l++;
    }
    tp += p; ta += a;
    return [s.name, s.class_name, p, a, l, p + a ? pct(p, p + a) : null];
  });
  const days = Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const grid: Cell[][] = students.map((s) => [
    s.name,
    ...days.map((d) => {
      if (d < s.joining_date) return '';
      if (hol.has(d)) return 'H';
      return letter[byKey.get(`${s.id}|${d}`) ?? ''] ?? '';
    }),
  ]);
  const taken = new Set(marks.map((x) => x.date)).size;
  const tables: Table[] = [
    {
      name: 'Summary',
      columns: ['Student', 'Class', 'Present', 'Absent', 'Leave', 'Attendance %'],
      rows: summaryRows,
      fmt: ['text', 'text', 'int', 'int', 'int', 'pct'],
      totals: ['Total', '', summaryRows.reduce((a, r) => a + (r[2] as number), 0), ta, summaryRows.reduce((a, r) => a + (r[4] as number), 0), tp + ta ? pct(tp, tp + ta) : null],
    },
    {
      name: 'Daily',
      columns: ['Student', ...days.map((d) => String(Number(d.slice(8))))],
      subHeaders: ['P present · A absent · L leave · H holiday', ...days.map((d) => WEEK[isoWeekday(d) % 7])],
      rows: grid,
      fmt: ['text', ...days.map(() => 'center' as const)],
    },
  ];
  return {
    key: 'attendance', title: 'Attendance report', subtitle: formatMonth(month),
    fileBase: `TuitionBook-Attendance-${month}`, landscape: true,
    summary: [
      ['Month', formatMonth(month)], ['Students', String(students.length)], ['Days attendance taken', String(taken)],
      ['Holidays', holidays.length ? holidays.map((h) => `${formatDate(h.date)}${h.name ? ` (${h.name})` : ''}`).join(', ') : 'None'],
      ['Overall attendance', tp + ta ? `${pct(tp, tp + ta)}%` : '—'],
    ],
    tables, owner: m.owner, generatedOn: m.generatedOn,
  };
}

/* --------------------------------------------------------------------- fees */

export async function feesReport(db: SQLiteDatabase, month: string): Promise<Report> {
  const m = await meta(db);
  const rows = await listFeesForMonth(db, month);
  if (!rows.length) throw new Error(`There are no fees for ${formatMonth(month)}.`);
  const dueTotal = rows.reduce((a, r) => a + r.amount_due, 0);
  const paidTotal = rows.reduce((a, r) => a + Math.min(r.paid, r.amount_due), 0);
  const cleared = rows.filter((r) => r.paid >= r.amount_due).length;
  const payments = await db.getAllAsync<{ paid_on: string; name: string; month: string; amount: number; mode: string; note: string }>(
    `SELECT p.paid_on, s.name, d.month, p.amount, p.mode, p.note
     FROM payments p JOIN fee_dues d ON d.id = p.fee_due_id JOIN students s ON s.id = d.student_id
     WHERE p.paid_on LIKE ? ORDER BY p.paid_on, p.id`, `${month}-%`,
  );
  const tables: Table[] = [
    {
      name: 'Fees',
      columns: ['Student', 'Class', 'Parent phone', 'Due', 'Paid', 'Balance', 'Status', 'Last payment'],
      rows: rows.map((r) => [
        r.name, r.class_name, r.parent_phone, r.amount_due, r.paid, Math.max(0, r.amount_due - r.paid),
        STATUS_LABEL[feeStatus(r, m.dueDay)], r.last_paid_on ? formatDate(r.last_paid_on) : '—',
      ]),
      fmt: ['text', 'text', 'text', 'money', 'money', 'money', 'text', 'text'],
      totals: ['Total', '', '', dueTotal, rows.reduce((a, r) => a + r.paid, 0), rows.reduce((a, r) => a + Math.max(0, r.amount_due - r.paid), 0), '', ''],
    },
    {
      name: 'Payments received',
      columns: ['Date', 'Student', 'For month', 'Amount', 'Mode', 'Note'],
      rows: payments.map((p) => [formatDate(p.paid_on), p.name, formatMonth(p.month, false), p.amount, MODE[p.mode] ?? p.mode, p.note]),
      fmt: ['text', 'text', 'text', 'money', 'text', 'text'],
      totals: payments.length ? ['Total', '', '', payments.reduce((a, p) => a + p.amount, 0), '', ''] : undefined,
      emptyNote: `No payments were received in ${formatMonth(month)}.`,
    },
  ];
  return {
    key: 'fees', title: 'Fees report', subtitle: formatMonth(month),
    fileBase: `TuitionBook-Fees-${month}`, landscape: false,
    summary: [
      ['Month', formatMonth(month)], ['Students with a fee', String(rows.length)],
      ['Fee due', rupees(dueTotal)], ['Collected', rupees(paidTotal)], ['Pending', rupees(dueTotal - paidTotal)],
      ['Fully paid', `${cleared} of ${rows.length}`],
    ],
    tables, owner: m.owner, generatedOn: m.generatedOn,
  };
}

/* ------------------------------------------------------------------ student */

/** One student in detail, or `'all'` for a one-line-per-student summary. */
export async function studentReport(db: SQLiteDatabase, who: number | 'all'): Promise<Report> {
  const m = await meta(db);

  if (who === 'all') {
    const students = await activeStudents(db);
    if (!students.length) throw new Error('There are no students to report on.');
    const rows: Cell[][] = [];
    for (const s of students) {
      const a = await db.getFirstAsync<{ p: number; a: number; l: number }>(
        `SELECT COALESCE(SUM(status='present'),0) AS p, COALESCE(SUM(status='absent'),0) AS a, COALESCE(SUM(status='leave'),0) AS l FROM attendance WHERE student_id = ?`, s.id);
      const f = await db.getFirstAsync<{ due: number; paid: number }>(
        `SELECT COALESCE(SUM(d.amount_due),0) AS due,
           COALESCE(SUM(MIN(d.amount_due, (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.fee_due_id = d.id))),0) AS paid
         FROM fee_dues d WHERE d.student_id = ?`, s.id);
      rows.push([
        s.name, s.class_name, s.parent_phone, a!.p, a!.a, a!.l, a!.p + a!.a ? pct(a!.p, a!.p + a!.a) : null,
        f!.due, f!.paid, f!.due - f!.paid,
      ]);
    }
    return {
      key: 'student', title: 'Student-wise report', subtitle: `All students · as on ${formatDate(today())}`,
      fileBase: `TuitionBook-Students-${today()}`, landscape: true,
      summary: [['Students', String(students.length)], ['Fee pending (all months)', rupees(rows.reduce((a, r) => a + (r[9] as number), 0))]],
      tables: [{
        name: 'Students',
        columns: ['Student', 'Class', 'Parent phone', 'Present', 'Absent', 'Leave', 'Attendance %', 'Fee due', 'Paid', 'Pending'],
        rows, fmt: ['text', 'text', 'text', 'int', 'int', 'int', 'pct', 'money', 'money', 'money'],
      }],
      owner: m.owner, generatedOn: m.generatedOn,
    };
  }

  const s = await db.getFirstAsync<Stu & { monthly_fee: number; status: string; notes: string }>(
    'SELECT id, name, class_name, parent_phone, joining_date, monthly_fee, status, notes FROM students WHERE id = ?', who);
  if (!s) throw new Error('This student no longer exists.');
  const fees = (await listFeesForStudent(db, who)).reverse(); // oldest first
  const marks = await db.getAllAsync<{ date: string; status: string }>('SELECT date, status FROM attendance WHERE student_id = ?', who);
  const from = monthOf(s.joining_date);
  const months = monthRange(from > addMonths(currentMonth(), -23) ? from : addMonths(currentMonth(), -23), currentMonth());
  const attRows: Cell[][] = months.map((mo) => {
    const mm = marks.filter((x) => x.date.startsWith(mo));
    const p = mm.filter((x) => x.status === 'present').length;
    const a = mm.filter((x) => x.status === 'absent').length;
    const l = mm.filter((x) => x.status === 'leave').length;
    return [formatMonth(mo, false), p, a, l, p + a ? pct(p, p + a) : null];
  });
  const tp = marks.filter((x) => x.status === 'present').length;
  const ta = marks.filter((x) => x.status === 'absent').length;
  const pays = await db.getAllAsync<{ paid_on: string; month: string; amount: number; mode: string; note: string }>(
    `SELECT p.paid_on, d.month, p.amount, p.mode, p.note FROM payments p JOIN fee_dues d ON d.id = p.fee_due_id
     WHERE d.student_id = ? ORDER BY p.paid_on, p.id`, who);
  const outstanding = fees.reduce((a, f) => a + Math.max(0, f.amount_due - f.paid), 0);

  const tables: Table[] = [
    {
      name: 'Attendance', columns: ['Month', 'Present', 'Absent', 'Leave', 'Attendance %'], rows: attRows,
      fmt: ['text', 'int', 'int', 'int', 'pct'],
      totals: ['Total', tp, ta, marks.filter((x) => x.status === 'leave').length, tp + ta ? pct(tp, tp + ta) : null],
    },
    {
      name: 'Fees', columns: ['Month', 'Due', 'Paid', 'Balance', 'Status'],
      rows: fees.map((f) => [formatMonth(f.month, false), f.amount_due, f.paid, Math.max(0, f.amount_due - f.paid), STATUS_LABEL[feeStatus(f, m.dueDay)]]),
      fmt: ['text', 'money', 'money', 'money', 'text'],
      totals: fees.length ? ['Total', fees.reduce((a, f) => a + f.amount_due, 0), fees.reduce((a, f) => a + f.paid, 0), outstanding, ''] : undefined,
      emptyNote: 'No fees yet.',
    },
    {
      name: 'Payments', columns: ['Date', 'For month', 'Amount', 'Mode', 'Note'],
      rows: pays.map((p) => [formatDate(p.paid_on), formatMonth(p.month, false), p.amount, MODE[p.mode] ?? p.mode, p.note]),
      fmt: ['text', 'text', 'money', 'text', 'text'], emptyNote: 'No payments yet.',
    },
  ];
  return {
    key: 'student', title: s.name, subtitle: 'Student report',
    fileBase: `TuitionBook-Student-${slug(s.name)}-${today()}`, landscape: false,
    summary: [
      ['Class', s.class_name || '—'], ['Parent phone', s.parent_phone || '—'], ['Joined', formatDate(s.joining_date)],
      ['Monthly fee', rupees(s.monthly_fee)], ['Fee pending', rupees(outstanding)],
      ['Attendance (all time)', tp + ta ? `${pct(tp, tp + ta)}%` : '—'],
      ...(s.status === 'archived' ? [['Status', 'Archived'] as [string, string]] : []),
    ],
    tables, owner: m.owner, generatedOn: m.generatedOn,
  };
}
