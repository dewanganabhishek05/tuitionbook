// Sample data so a new user (and the web preview) can try the app before entering real students.
import type { SQLiteDatabase } from 'expo-sqlite';
import { addDays, addMonths, currentMonth, isoWeekday, today } from '../lib/dates';
import { notifyChange, quietly } from './live';
import { ensureDues, saveRoll, saveStudent, setHoliday, setMark } from './repo';
import type { AttendanceStatus, PaymentMode } from './types';

const NAMES = [
  'Aarav Sharma', 'Ananya Verma', 'Ishaan Gupta', 'Diya Patel', 'Kabir Singh', 'Meera Nair',
  'Vihaan Reddy', 'Saanvi Iyer', 'Arjun Mehta', 'Myra Joshi', 'Reyansh Das', 'Aadhya Kulkarni',
  'Vivaan Rao', 'Kiara Menon', 'Advait Chauhan', 'Anika Bose', 'Rudra Pillai', 'Navya Saxena',
];

export async function seedDemo(db: SQLiteDatabase) {
  return quietly(() => seed(db));
}

async function seed(db: SQLiteDatabase) {
  const classes = ['Class 10', 'Class 9', 'Class 12'];
  const schools = ['DPS', 'St. Mary’s', 'Kendriya Vidyalaya'];
  const fees = [1500, 1200, 2500];
  const joinMonth = addMonths(currentMonth(), -2);

  const ids: number[] = [];
  for (let i = 0; i < NAMES.length; i++) {
    const ci = i % 3;
    const id = await saveStudent(db, {
      name: NAMES[i],
      parent_phone: `98${String(76543210 + i * 1379).slice(0, 8)}`,
      class_name: `${classes[ci]} · ${schools[(i >> 1) % 3]}`,
      joining_date: `${joinMonth}-0${1 + (i % 5)}`,
      monthly_fee: fees[ci],
      notes: '',
    });
    ids.push(id);
  }
  await ensureDues(db);

  // Attendance for the last 3 weeks, Monday to Saturday (skip today so it can be marked live),
  // with one past holiday and one planned leave coming up.
  const pastHoliday = addDays(today(), -10);
  await setHoliday(db, pastHoliday, 'Festival holiday');
  for (let back = 21; back >= 1; back--) {
    const date = addDays(today(), -back);
    if (isoWeekday(date) === 7 || date === pastHoliday) continue;
    const entries = ids.map((id, k) => {
      const r = (id * 7 + back * 3 + k) % 11;
      const status: AttendanceStatus = r === 0 ? 'absent' : r === 5 && back % 2 ? 'leave' : 'present';
      return { student_id: id, status };
    });
    await saveRoll(db, date, entries);
  }
  await setMark(db, addDays(today(), 3), ids[0], 'leave', 'Family function');

  // Payments: earlier months mostly paid, this month about half paid.
  const dues = await db.getAllAsync<{ id: number; month: string; amount_due: number; student_id: number }>(
    'SELECT id, month, amount_due, student_id FROM fee_dues ORDER BY month',
  );
  const modes: PaymentMode[] = ['upi', 'cash', 'upi', 'bank'];
  for (const d of dues) {
    const k = d.student_id % 6;
    const isCurrent = d.month === currentMonth();
    if (isCurrent && k >= 3) continue; // pending this month
    if (!isCurrent && k === 5 && d.month === addMonths(currentMonth(), -1)) continue; // one month of arrears
    const amount = isCurrent && k === 2 ? Math.round(d.amount_due / 2) : d.amount_due; // a partial payment
    const day = String(3 + (d.student_id % 6)).padStart(2, '0');
    const paidOn = `${d.month}-${day}` > today() ? today() : `${d.month}-${day}`;
    await db.runAsync(
      'INSERT INTO payments (fee_due_id, amount, paid_on, mode, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      d.id, amount, paidOn, modes[d.student_id % 4], '', new Date().toISOString(),
    );
  }
  notifyChange();
}

export async function wipeAll(db: SQLiteDatabase) {
  await db.execAsync(`
    DELETE FROM payments; DELETE FROM fee_dues; DELETE FROM attendance; DELETE FROM holidays; DELETE FROM students;
    DELETE FROM sqlite_sequence;`);
  notifyChange();
}
