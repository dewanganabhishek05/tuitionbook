// Sample data so a new user (and the web preview) can try the app before entering real students.
import type { SQLiteDatabase } from 'expo-sqlite';
import { addDays, addMonths, currentMonth, isoWeekday, today } from '../lib/dates';
import { notifyChange, quietly } from './live';
import { batchDays, ensureDues, saveBatch, saveRoll, saveStudent } from './repo';
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
  const b1 = await saveBatch(db, { name: 'Class 10 · Maths', days: [1, 3, 5], start_time: '17:00', default_fee: 1500 });
  const b2 = await saveBatch(db, { name: 'Class 9 · Science', days: [2, 4, 6], start_time: '16:00', default_fee: 1200 });
  const b3 = await saveBatch(db, { name: 'Class 12 · Physics', days: [1, 2, 3, 4, 5, 6], start_time: '07:00', default_fee: 2500 });
  const batches = [b1, b2, b3];
  const fees = [1500, 1200, 2500];
  const joinMonth = addMonths(currentMonth(), -2);

  const ids: { id: number; batch: number }[] = [];
  for (let i = 0; i < NAMES.length; i++) {
    const bi = i % 3;
    const id = await saveStudent(db, {
      name: NAMES[i],
      parent_phone: `98${String(76543210 + i * 1379).slice(0, 8)}`,
      class_name: ['DPS', 'St. Mary’s', 'Kendriya Vidyalaya'][(i >> 1) % 3],
      joining_date: `${joinMonth}-0${1 + (i % 5)}`,
      monthly_fee: fees[bi],
      notes: '',
      batchIds: [batches[bi]],
    });
    ids.push({ id, batch: batches[bi] });
  }
  await ensureDues(db);

  // Attendance for the last 3 weeks on each batch's scheduled days (skip today so it can be marked live).
  const all = await db.getAllAsync<{ id: number; days: string }>('SELECT id, days FROM batches');
  for (let back = 21; back >= 1; back--) {
    const date = addDays(today(), -back);
    for (const b of all) {
      if (!batchDays(b).includes(isoWeekday(date))) continue;
      const entries = ids
        .filter((s) => s.batch === b.id)
        .map((s, k) => {
          const r = (s.id * 7 + back * 3 + k) % 11;
          const status: AttendanceStatus = r === 0 ? 'absent' : r === 5 && back % 2 ? 'leave' : 'present';
          return { student_id: s.id, status };
        });
      await saveRoll(db, b.id, date, entries);
    }
  }

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
    DELETE FROM payments; DELETE FROM fee_dues; DELETE FROM attendance;
    DELETE FROM enrollments; DELETE FROM students; DELETE FROM batches;
    DELETE FROM sqlite_sequence;`);
  notifyChange();
}
