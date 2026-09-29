// Data-layer tests: run with `npm test`. Uses real SQLite and a fake clock.
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createSnapshot, describeSnapshot, parseSnapshot, restoreSnapshot } from '../src/backup/snapshot';
import * as repo from '../src/db/repo';
import { MIGRATIONS, SCHEMA_VERSION, migrate } from '../src/db/schema';
import { seedDemo, wipeAll } from '../src/db/seed';
import {
  addDays, addMonths, daysInMonth, formatDate, formatDay, formatTime, isValidISODate, isoWeekday, monthRange, today,
} from '../src/lib/dates';
import { normalizePhone, openWhatsApp, pct, rupees } from '../src/lib/format';
import { opened } from './stubs/react-native';
import { adapter, freshDb, resetNow, setNow, type TestDb } from './harness';

afterEach(() => resetNow());

async function student(db: TestDb, over: Partial<repo.StudentInput> = {}) {
  return repo.saveStudent(db, {
    name: 'Ravi Kumar', parent_phone: '9876543210', class_name: '', joining_date: today(),
    monthly_fee: 1000, notes: '', ...over,
  });
}
async function dues(db: TestDb, sid: number) {
  const rows = await repo.listFeesForStudent(db, sid);
  return rows.map((r) => `${r.month}:${r.amount_due}:${r.paid}`).sort();
}
const months = async (db: TestDb, sid: number) => (await dues(db, sid)).map((d) => d.slice(0, 7));

/* ============================================================== helpers */

describe('date helpers', () => {
  it('month arithmetic crosses year boundaries', () => {
    assert.equal(addMonths('2025-12', 1), '2026-01');
    assert.equal(addMonths('2026-01', -1), '2025-12');
    assert.equal(addMonths('2026-03', -14), '2025-01');
    assert.deepEqual(monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
    assert.deepEqual(monthRange('2026-05', '2026-04'), []);
  });
  it('knows month lengths and leap years', () => {
    assert.equal(daysInMonth('2026-02'), 28);
    assert.equal(daysInMonth('2028-02'), 29);
    assert.equal(daysInMonth('2026-12'), 31);
    assert.equal(isValidISODate('2026-02-29'), false);
    assert.equal(isValidISODate('2028-02-29'), true);
    assert.equal(isValidISODate('2026-13-01'), false);
    assert.equal(isValidISODate('26-1-1'), false);
    assert.equal(isValidISODate(''), false);
  });
  it('adds days across month and year ends', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  });
  it('weekday is Monday=1 … Sunday=7', () => {
    assert.equal(isoWeekday('2026-09-28'), 1);
    assert.equal(isoWeekday('2026-10-04'), 7);
  });
  it('formats 12-hour times and relative days', () => {
    assert.equal(formatTime('00:05'), '12:05 AM');
    assert.equal(formatTime('12:00'), '12:00 PM');
    assert.equal(formatTime('17:30'), '5:30 PM');
    assert.equal(formatTime(''), '');
    setNow('2026-09-29');
    assert.equal(formatDay('2026-09-29'), 'Today');
    assert.equal(formatDay('2026-09-28'), 'Yesterday');
    assert.equal(formatDay('2026-09-24'), 'Thu, 24 Sep');
    assert.equal(formatDate('2026-01-05'), '5 Jan 2026');
  });
  it('uses local dates just after midnight (IST)', () => {
    setNow('2026-10-01T00:10');
    assert.equal(today(), '2026-10-01');
  });
});

describe('formatting', () => {
  it('formats rupees with Indian grouping', () => {
    assert.equal(rupees(150000), '₹1,50,000');
    assert.equal(rupees(0), '₹0');
    assert.equal(rupees(-500), '-₹500');
  });
  it('normalises phone numbers for WhatsApp', () => {
    assert.equal(normalizePhone('98765 43210'), '919876543210');
    assert.equal(normalizePhone('+91 98765-43210'), '919876543210');
    assert.equal(normalizePhone('09876543210'), '919876543210');
    assert.equal(normalizePhone('5551234567', '1'), '15551234567');
  });
  it('builds an encoded WhatsApp link', async () => {
    opened.length = 0;
    await openWhatsApp('98765 43210', 'Fee ₹1,500 & thanks — Priya');
    assert.equal(opened[0], `https://wa.me/919876543210?text=${encodeURIComponent('Fee ₹1,500 & thanks — Priya')}`);
  });
  it('percent handles zero', () => {
    assert.equal(pct(3, 0), 0);
    assert.equal(pct(2, 3), 67);
  });
});

/* ============================================================ migrations */

describe('migrations', () => {
  it('creates the latest schema and is idempotent', async () => {
    const db = await freshDb();
    await migrate(db);
    const v = await db.getFirstAsync('PRAGMA user_version');
    assert.equal(v.user_version, SCHEMA_VERSION);
  });
  it('upgrades a v2 (batches) database: attendance merged to one mark per student per day', async () => {
    const raw = new Database(':memory:');
    raw.exec(MIGRATIONS[0]);
    raw.exec(MIGRATIONS[1]);
    raw.exec('PRAGMA user_version = 2');
    raw.exec(`
      INSERT INTO batches (id, name, created_at) VALUES (1, 'Maths', 'x'), (2, 'Science', 'x');
      INSERT INTO students (id, name, joining_date, monthly_fee, created_at) VALUES (1, 'Asha', '2026-01-01', 500, 'x'), (2, 'Bina', '2026-01-01', 500, 'x');
      INSERT INTO enrollments VALUES (1, 1), (1, 2), (2, 1);
      INSERT INTO attendance (batch_id, student_id, date, status) VALUES
        (1, 1, '2026-09-01', 'absent'), (2, 1, '2026-09-01', 'present'),
        (1, 1, '2026-09-02', 'leave'),  (2, 1, '2026-09-02', 'absent'),
        (1, 2, '2026-09-01', 'holiday'),
        (1, 1, '2026-09-05', 'holiday'), (1, 2, '2026-09-05', 'holiday');
      INSERT INTO fee_dues (student_id, month, amount_due) VALUES (1, '2026-09', 500);`);
    const db = adapter(raw);
    await migrate(db);
    assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, SCHEMA_VERSION);
    const rows = await db.getAllAsync('SELECT student_id, date, status FROM attendance ORDER BY student_id, date');
    assert.deepEqual(rows, [
      { student_id: 1, date: '2026-09-01', status: 'present' },
      { student_id: 1, date: '2026-09-02', status: 'absent' },
    ], 'stray holiday marks on a class day are dropped');
    assert.deepEqual(await db.getAllAsync('SELECT date, name FROM holidays'), [{ date: '2026-09-05', name: '' }], 'all-holiday day becomes a holiday');
    const tables = (await db.getAllAsync("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t: { name: string }) => t.name);
    assert.ok(!tables.includes('batches') && !tables.includes('enrollments'), 'batch tables dropped');
    assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS n FROM fee_dues')).n, 1, 'fees untouched');
    assert.equal((await db.getFirstAsync('PRAGMA foreign_key_check')), null, 'no broken references');
    await repo.saveRoll(db, '2026-09-03', [{ student_id: 1, status: 'present' }]);
  });
  it('upgrades a v1 database without losing data', async () => {
    const raw = new Database(':memory:');
    raw.exec(MIGRATIONS[0]);
    raw.exec('PRAGMA user_version = 1');
    raw.prepare("INSERT INTO students (name, joining_date, monthly_fee, created_at) VALUES ('Old', '2026-01-01', 500, 'x')").run();
    const db = adapter(raw);
    await migrate(db);
    const s = await db.getFirstAsync('SELECT name, fees_resume FROM students');
    assert.equal(s.name, 'Old');
    assert.equal(s.fees_resume, null);
    assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, SCHEMA_VERSION);
  });
});

/* ================================================================= dues */

describe('monthly fee dues', () => {
  it('creates dues from joining month to now, across a year boundary', async () => {
    setNow('2026-02-10');
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2025-12-20' });
    assert.deepEqual(await months(db, sid), ['2025-12', '2026-01', '2026-02']);
  });
  it('adds nothing for a future joining date until that month arrives', async () => {
    setNow('2026-09-29');
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2026-10-05' });
    assert.deepEqual(await months(db, sid), []);
    setNow('2026-10-01');
    await repo.ensureDues(db);
    assert.deepEqual(await months(db, sid), ['2026-10']);
  });
  it('catches up months when the app was not opened for a while', async () => {
    setNow('2026-01-15');
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2026-01-01' });
    setNow('2026-04-02');
    assert.equal(await repo.ensureDues(db), 3);
    assert.equal(await repo.ensureDues(db), 0, 'second call adds nothing');
    assert.deepEqual(await months(db, sid), ['2026-01', '2026-02', '2026-03', '2026-04']);
  });
  it('never creates dues for a ₹0 (free) student', async () => {
    setNow('2026-05-10');
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2026-01-01', monthly_fee: 0 });
    assert.deepEqual(await months(db, sid), []);
  });
  it('changing a free student to paid starts this month, not retroactively', async () => {
    setNow('2026-05-10');
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2026-01-01', monthly_fee: 0 });
    await student(db, { id: sid, joining_date: '2026-01-01', monthly_fee: 1500 });
    assert.deepEqual(await dues(db, sid), ['2026-05:1500:0']);
    setNow('2026-06-01');
    await repo.ensureDues(db);
    assert.deepEqual(await months(db, sid), ['2026-05', '2026-06']);
  });
  it('does not charge months while a student was archived', async () => {
    setNow('2026-01-10');
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2026-01-01' });
    await repo.setStudentArchived(db, sid, true);
    setNow('2026-04-03');
    await repo.ensureDues(db);
    assert.deepEqual(await months(db, sid), ['2026-01'], 'nothing while archived');
    await repo.setStudentArchived(db, sid, false);
    assert.deepEqual(await months(db, sid), ['2026-01', '2026-04'], 'restarts in the restore month only');
    setNow('2026-05-01');
    await repo.ensureDues(db);
    assert.deepEqual(await months(db, sid), ['2026-01', '2026-04', '2026-05']);
  });
  it('editing the student later does not refill the archived gap', async () => {
    setNow('2026-01-10');
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2026-01-01' });
    await repo.setStudentArchived(db, sid, true);
    setNow('2026-04-03');
    await repo.setStudentArchived(db, sid, false);
    await student(db, { id: sid, name: 'Renamed', joining_date: '2026-01-01' });
    assert.deepEqual(await months(db, sid), ['2026-01', '2026-04']);
  });
  it('moving the joining date later removes unpaid earlier dues but keeps paid ones', async () => {
    setNow('2026-04-10');
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2026-01-01' });
    const jan = (await repo.listFeesForStudent(db, sid)).find((f) => f.month === '2026-01')!;
    await repo.addPayment(db, { fee_due_id: jan.id, amount: 1000, paid_on: '2026-01-05', mode: 'cash', note: '' });
    await student(db, { id: sid, joining_date: '2026-03-01' });
    assert.deepEqual(await months(db, sid), ['2026-01', '2026-03', '2026-04']);
  });
  it('moving the joining date earlier adds the missing months', async () => {
    setNow('2026-04-10');
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2026-03-01' });
    await student(db, { id: sid, joining_date: '2026-01-15' });
    assert.deepEqual(await months(db, sid), ['2026-01', '2026-02', '2026-03', '2026-04']);
  });
  it('a fee change applies from this month; paid months and past months keep their amount', async () => {
    setNow('2026-03-10');
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2026-02-01' });
    await student(db, { id: sid, joining_date: '2026-02-01', monthly_fee: 1200 });
    assert.deepEqual(await dues(db, sid), ['2026-02:1000:0', '2026-03:1200:0']);
    const mar = (await repo.listFeesForStudent(db, sid)).find((f) => f.month === '2026-03')!;
    await repo.addPayment(db, { fee_due_id: mar.id, amount: 200, paid_on: '2026-03-10', mode: 'upi', note: '' });
    await student(db, { id: sid, joining_date: '2026-02-01', monthly_fee: 1500 });
    assert.deepEqual(await dues(db, sid), ['2026-02:1000:0', '2026-03:1200:200'], 'month with a payment is locked');
    setNow('2026-04-01');
    await repo.ensureDues(db);
    assert.ok((await dues(db, sid)).includes('2026-04:1500:0'));
  });
  it('setting the fee to ₹0 keeps past arrears but drops this month', async () => {
    setNow('2026-03-10');
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2026-01-01' });
    await student(db, { id: sid, joining_date: '2026-01-01', monthly_fee: 0 });
    assert.deepEqual(await months(db, sid), ['2026-01', '2026-02']);
  });
});

/* ============================================================= payments */

describe('payments and fee status', () => {
  async function setup(nowAt = '2026-03-05') {
    setNow(nowAt);
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2026-02-01' });
    const [mar, feb] = await repo.listFeesForStudent(db, sid);
    return { db, sid, mar, feb };
  }
  it('partial then full payment moves pending → partial → paid', async () => {
    const { db, mar } = await setup();
    assert.equal(repo.feeStatus(mar, 10), 'pending');
    await repo.addPayment(db, { fee_due_id: mar.id, amount: 400, paid_on: '2026-03-05', mode: 'upi', note: '' });
    assert.equal(repo.feeStatus((await repo.getFeeRow(db, mar.id))!, 10), 'partial');
    await repo.addPayment(db, { fee_due_id: mar.id, amount: 600, paid_on: '2026-03-05', mode: 'cash', note: '' });
    assert.equal(repo.feeStatus((await repo.getFeeRow(db, mar.id))!, 10), 'paid');
  });
  it('rejects overpayment, zero, fractions and future dates', async () => {
    const { db, mar } = await setup();
    const add = (amount: number, paid_on = '2026-03-05') =>
      repo.addPayment(db, { fee_due_id: mar.id, amount, paid_on, mode: 'cash', note: '' });
    await assert.rejects(add(1001), /more than the balance/);
    await assert.rejects(add(0), /above 0/);
    await assert.rejects(add(-5), /above 0/);
    await assert.rejects(add(10.5), /whole number/);
    await assert.rejects(add(100, '2026-03-06'), /future/);
    await add(1000);
    await assert.rejects(add(1), /more than the balance of ₹0/);
  });
  it('overdue starts the day after the due day, and for any earlier month', async () => {
    const { mar, feb } = await setup('2026-03-10');
    assert.equal(repo.feeStatus(mar, 10), 'pending', 'on the due day itself');
    assert.equal(repo.feeStatus(feb, 10), 'overdue');
    setNow('2026-03-11');
    assert.equal(repo.feeStatus(mar, 10), 'overdue');
    assert.equal(repo.daysOverdue('2026-03', 10), 1);
    assert.equal(repo.daysOverdue('2026-02', 10), 29);
    setNow('2026-03-05');
    assert.equal(repo.daysOverdue('2026-03', 10), 0);
  });
  it('deleting a payment re-opens the fee', async () => {
    const { db, mar } = await setup();
    const pid = await repo.addPayment(db, { fee_due_id: mar.id, amount: 1000, paid_on: '2026-03-05', mode: 'cash', note: '' });
    await repo.deletePayment(db, pid);
    const row = (await repo.getFeeRow(db, mar.id))!;
    assert.equal(row.paid, 0);
    assert.equal(repo.feeStatus(row, 10), 'pending');
  });
  it('a discount can waive a month (₹0) and rejects bad amounts', async () => {
    const { db, mar } = await setup();
    await repo.setDueAmount(db, mar.id, 0);
    assert.equal(repo.feeStatus((await repo.getFeeRow(db, mar.id))!, 10), 'paid');
    await assert.rejects(repo.setDueAmount(db, mar.id, -1));
    await assert.rejects(repo.setDueAmount(db, mar.id, 2.5));
  });
  it('month summary and arrears add up', async () => {
    const { db, mar } = await setup();
    await repo.addPayment(db, { fee_due_id: mar.id, amount: 300, paid_on: '2026-03-05', mode: 'cash', note: '' });
    assert.deepEqual(await repo.monthSummary(db, '2026-03'), { expected: 1000, collected: 300, pending: 700, students: 1, cleared: 0 });
    assert.deepEqual(await repo.arrearsBefore(db, '2026-03'), { total: 1000, students: 1 });
    assert.deepEqual(await repo.monthSummary(db, '2025-01'), { expected: 0, collected: 0, pending: 0, students: 0, cleared: 0 });
    const [s] = await repo.listStudents(db, {});
    assert.equal(s.outstanding, 1700);
  });
});

/* =========================================================== attendance */

describe('attendance', () => {
  it('save then update the same day is an upsert (one mark per student per day)', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2026-09-01' });
    await repo.saveRoll(db, '2026-09-28', [{ student_id: sid, status: 'absent' }]);
    await repo.saveRoll(db, '2026-09-28', [{ student_id: sid, status: 'present' }]);
    assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS n FROM attendance')).n, 1);
    assert.equal((await repo.getRoll(db, '2026-09-28'))[0].status, 'present');
  });
  it('the roll lists everyone who has joined, without any setup', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    await student(db, { name: 'Zara', joining_date: '2026-09-01', class_name: 'Class 9' });
    await student(db, { name: 'Amit', joining_date: '2026-09-01' });
    const roll = await repo.getRoll(db, '2026-09-28');
    assert.deepEqual(roll.map((r) => [r.name, r.class_name, r.status]), [['Amit', '', null], ['Zara', 'Class 9', null]]);
  });
  it('roll excludes students who joined later, and archived students without a record', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const early = await student(db, { name: 'Early', joining_date: '2026-09-01' });
    await student(db, { name: 'Late', joining_date: '2026-09-20' });
    const gone = await student(db, { name: 'Gone', joining_date: '2026-09-01' });
    await repo.saveRoll(db, '2026-09-10', [{ student_id: early, status: 'present' }, { student_id: gone, status: 'absent' }]);
    await repo.setStudentArchived(db, gone, true);
    assert.deepEqual((await repo.getRoll(db, '2026-09-10')).map((r) => r.name), ['Early', 'Gone'], 'history keeps archived');
    assert.deepEqual((await repo.getRoll(db, '2026-09-28')).map((r) => r.name), ['Early', 'Late']);
  });
  it('holidays and leave do not count against attendance %', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2026-09-01' });
    await repo.saveRoll(db, '2026-09-21', [{ student_id: sid, status: 'present' }]);
    await repo.setHoliday(db, '2026-09-22', 'Ganesh Chaturthi');
    await repo.saveRoll(db, '2026-09-23', [{ student_id: sid, status: 'leave' }]);
    await repo.saveRoll(db, '2026-09-24', [{ student_id: sid, status: 'absent' }]);
    const m = await repo.studentMonthAttendance(db, sid, '2026-09');
    assert.deepEqual(m.stats, { present: 1, absent: 1, leave: 1, percent: 50 });
    assert.equal(m.days.length, 3);
    assert.deepEqual(m.holidays, [{ date: '2026-09-22', name: 'Ganesh Chaturthi' }]);
    assert.equal((await repo.studentMonthAttendance(db, sid, '2026-08')).stats.percent, 0);
  });
  it('clearing a day removes only that day', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2026-09-01' });
    await repo.saveRoll(db, '2026-09-27', [{ student_id: sid, status: 'present' }]);
    await repo.saveRoll(db, '2026-09-28', [{ student_id: sid, status: 'present' }]);
    await repo.clearRoll(db, '2026-09-28');
    const rows = await db.getAllAsync('SELECT date FROM attendance');
    assert.deepEqual(rows.map((r: { date: string }) => r.date), ['2026-09-27']);
  });
  it('Today card data: expected, marked, counts, holiday, and students added after marking', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const a = await student(db, { name: 'A', joining_date: '2026-09-01' });
    const b = await student(db, { name: 'B', joining_date: '2026-09-01' });
    await student(db, { name: 'Future', joining_date: '2026-10-05' });
    let d = await repo.daySummary(db, '2026-09-28');
    assert.deepEqual([d.expected, d.marked, d.holiday], [2, 0, false]);
    await repo.saveRoll(db, '2026-09-28', [{ student_id: a, status: 'present' }, { student_id: b, status: 'leave' }]);
    d = await repo.daySummary(db, '2026-09-28');
    assert.deepEqual([d.marked, d.present, d.absent, d.leave, d.holiday], [2, 1, 0, 1, false]);
    await student(db, { name: 'New', joining_date: '2026-09-28' });
    d = await repo.daySummary(db, '2026-09-28');
    assert.deepEqual([d.expected, d.marked], [3, 2], 'a student added later shows as not marked yet');
    await repo.setHoliday(db, '2026-09-27', 'Sunday event');
    const h = await repo.daySummary(db, '2026-09-27');
    assert.deepEqual([h.holiday, h.holiday_name, h.marked], [true, 'Sunday event', 0]);
    assert.equal(await repo.activeStudentCount(db), 4);
  });
  it('month calendar: one entry per day with expected, counts and holidays', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const a = await student(db, { name: 'A', joining_date: '2026-09-01' });
    const c = await student(db, { name: 'C', joining_date: '2026-09-15' });
    await repo.saveRoll(db, '2026-09-21', [{ student_id: a, status: 'present' }, { student_id: c, status: 'absent' }]);
    await repo.saveRoll(db, '2026-09-10', [{ student_id: a, status: 'present' }]);
    await repo.setHoliday(db, '2026-09-23', 'Holiday');
    await repo.setMark(db, '2026-09-30', a, 'leave', 'Trip');
    const cal = await repo.monthCalendar(db, '2026-09');
    assert.equal(cal.length, 30);
    const by = Object.fromEntries(cal.map((d) => [d.date, d]));
    assert.deepEqual([by['2026-09-10'].expected, by['2026-09-10'].present], [1, 1], 'C had not joined yet');
    assert.deepEqual([by['2026-09-21'].expected, by['2026-09-21'].marked, by['2026-09-21'].absent], [2, 2, 1]);
    assert.equal(by['2026-09-23'].holiday!.name, 'Holiday');
    assert.equal(by['2026-09-30'].leave, 1);
    const st = await repo.monthStudentStats(db, '2026-09');
    assert.deepEqual(st.map((x) => [x.name, x.present, x.absent, x.leave]), [['A', 2, 0, 1], ['C', 0, 1, 0]]);
  });
  it('holidays: any date (incl. future), renamed, removed; a holiday replaces marks and a roll replaces a holiday', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const a = await student(db, { joining_date: '2026-09-01' });
    await repo.saveRoll(db, '2026-09-28', [{ student_id: a, status: 'present' }]);
    await repo.setHoliday(db, '2026-09-28', 'Rain');
    assert.equal((await repo.daySummary(db, '2026-09-28')).marked, 0, 'marks removed');
    await repo.setHoliday(db, '2026-09-28', 'Heavy rain');
    assert.equal((await repo.getHoliday(db, '2026-09-28'))!.name, 'Heavy rain');
    await repo.saveRoll(db, '2026-09-28', [{ student_id: a, status: 'present' }]);
    assert.equal(await repo.getHoliday(db, '2026-09-28'), null, 'taking attendance makes it a class day again');
    await repo.setHoliday(db, '2026-11-14', 'Children’s Day');
    assert.deepEqual(await repo.listHolidays(db, '2026-11-01', '2026-11-30'), [{ date: '2026-11-14', name: 'Children’s Day' }]);
    await repo.removeHoliday(db, '2026-11-14');
    assert.deepEqual(await repo.listHolidays(db, '2026-11-01', '2026-11-30'), []);
    await repo.setHoliday(db, '2026-09-27');
    await repo.clearRoll(db, '2026-09-27');
    assert.equal(await repo.getHoliday(db, '2026-09-27'), null, 'clear removes the holiday too');
  });
  it('leave with a reason: can be planned for a future date and shows up pre-filled on the roll', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const a = await student(db, { name: 'A', joining_date: '2026-09-01' });
    await student(db, { name: 'B', joining_date: '2026-09-01' });
    await repo.setMark(db, '2026-10-02', a, 'leave', '  Family function ');
    await assert.rejects(repo.setMark(db, '2026-10-02', a, 'present'), /Only leave/);
    const roll = await repo.getRoll(db, '2026-10-02');
    assert.deepEqual(roll.map((r) => [r.name, r.status, r.note]), [['A', 'leave', 'Family function'], ['B', null, null]]);
    await repo.saveRoll(db, '2026-09-28', [{ student_id: a, status: 'present' }]);
    await repo.setMark(db, '2026-09-28', a, 'leave', 'Sick');
    assert.equal((await repo.getRoll(db, '2026-09-28'))[0].note, 'Sick');
    await repo.saveRoll(db, '2026-09-28', [{ student_id: a, status: 'leave' }]);
    assert.equal((await repo.getRoll(db, '2026-09-28'))[0].note, 'Sick', 'saving the roll keeps the reason');
    await repo.setMark(db, '2026-09-28', a, null);
    assert.equal((await repo.getRoll(db, '2026-09-28'))[0].status, null);
  });
});

/* ============================================================ students */

describe('students, search and deletes', () => {
  it('search is case-insensitive, matches phone and class, and treats % and _ literally', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    await student(db, { name: 'Anika Bose', parent_phone: '9000011111', class_name: 'Class 10 · DPS' });
    await student(db, { name: '100% Rahul', parent_phone: '9000022222' });
    await student(db, { name: 'Under_score', parent_phone: '9000033333' });
    const names = async (search: string) => (await repo.listStudents(db, { search })).map((x) => x.name);
    assert.deepEqual(await names('anika'), ['Anika Bose']);
    assert.deepEqual(await names('22222'), ['100% Rahul']);
    assert.deepEqual(await names('dps'), ['Anika Bose']);
    assert.deepEqual(await names('%'), ['100% Rahul']);
    assert.deepEqual(await names('_'), ['Under_score']);
    assert.deepEqual(await names('zzz'), []);
    assert.equal((await names('  ')).length, 3, 'blank search shows all');
  });
  it('handles Hindi names, apostrophes and quotes safely', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const sid = await student(db, { name: 'आरव शर्मा', class_name: "St. Mary's \"A\"", notes: "Robert'); DROP TABLE students;--" });
    const got = await repo.getStudent(db, sid);
    assert.equal(got!.name, 'आरव शर्मा');
    assert.equal(got!.class_name, "St. Mary's \"A\"");
    assert.equal((await repo.listStudents(db, { search: 'आरव' })).length, 1);
  });
  it('deleting a student removes their dues, payments and attendance', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const sid = await student(db, { joining_date: '2026-09-01' });
    const [due] = await repo.listFeesForStudent(db, sid);
    await repo.addPayment(db, { fee_due_id: due.id, amount: 500, paid_on: '2026-09-28', mode: 'cash', note: '' });
    await repo.saveRoll(db, '2026-09-28', [{ student_id: sid, status: 'present' }]);
    await repo.deleteStudent(db, sid);
    for (const t of ['fee_dues', 'payments', 'attendance']) {
      assert.equal((await db.getFirstAsync(`SELECT COUNT(*) AS n FROM ${t}`)).n, 0, t);
    }
  });
});

/* ============================================================ settings */

describe('settings', () => {
  it('defaults, saves and survives junk values', async () => {
    const db = await freshDb();
    assert.equal((await repo.getSettings(db)).fee_due_day, 10);
    assert.equal((await repo.getSettings(db)).default_fee, 0);
    await repo.setSettings(db, { default_fee: 1500 });
    assert.equal((await repo.getSettings(db)).default_fee, 1500);
    await repo.setSettings(db, { tutor_name: 'Priya', fee_due_day: 5, country_code: '1' });
    const s = await repo.getSettings(db);
    assert.deepEqual([s.tutor_name, s.fee_due_day, s.country_code], ['Priya', 5, '1']);
    await db.runAsync("UPDATE settings SET value = 'abc' WHERE key = 'fee_due_day'");
    assert.equal((await repo.getSettings(db)).fee_due_day, 10);
    await db.runAsync("INSERT INTO settings (key, value) VALUES ('unknown_key', 'x')");
    assert.equal('unknown_key' in (await repo.getSettings(db)), false);
  });
});

/* ============================================================== backup */

describe('backup and restore', () => {
  it('round-trips every table exactly, onto a phone with other data', async () => {
    setNow('2026-09-29');
    const db = await freshDb();
    await seedDemo(db);
    await repo.setSettings(db, { tutor_name: 'Priya', last_backup_at: '2026-09-01T00:00:00Z', last_backup_where: 'a file' });
    const snap = await createSnapshot(db);
    const target = await freshDb();
    await student(target, { name: 'To be replaced' });
    await repo.setSettings(target, { last_backup_at: 'KEEP-ME', last_backup_where: 'Google Drive' });
    await restoreSnapshot(target, parseSnapshot(JSON.stringify(snap)));
    const again = await createSnapshot(target);
    for (const t of Object.keys(snap.data)) assert.deepEqual(again.data[t as never], snap.data[t as never], t);
    const s = await repo.getSettings(target);
    assert.equal(s.tutor_name, 'Priya', 'settings travel');
    assert.equal(s.last_backup_at, 'KEEP-ME', 'device-only settings stay');
    assert.deepEqual(await repo.monthSummary(target, '2026-09'), await repo.monthSummary(db, '2026-09'));
    const next = await student(target, { name: 'New' });
    assert.ok(next > Math.max(...snap.data.students.map((r) => r.id as number)), 'ids continue after restore');
    assert.match(describeSnapshot(snap), /18 students · \d+ payments · \d+ attendance marks/);
  });
  it('restores an older backup that still has batches (merging marks to one per day)', async () => {
    setNow('2026-09-29');
    const db = await freshDb();
    const snap = parseSnapshot(JSON.stringify({
      app: 'tuitionbook', schemaVersion: 2, exportedAt: '2026-09-01T00:00:00Z', counts: {},
      data: {
        batches: [{ id: 1, name: 'Maths' }, { id: 2, name: 'Science' }],
        enrollments: [{ student_id: 1, batch_id: 1 }, { student_id: 1, batch_id: 2 }],
        students: [{ id: 1, name: 'Old kid', parent_phone: '', class_name: '', joining_date: '2026-01-01', monthly_fee: 100, status: 'active', notes: '', created_at: 'x' }],
        attendance: [
          { id: 1, batch_id: 1, student_id: 1, date: '2026-09-01', status: 'absent' },
          { id: 2, batch_id: 2, student_id: 1, date: '2026-09-01', status: 'present' },
          { id: 3, batch_id: 1, student_id: 1, date: '2026-09-02', status: 'leave' },
          { id: 4, batch_id: 2, student_id: 1, date: '2026-09-02', status: 'holiday' },
          { id: 5, batch_id: 1, student_id: 1, date: '2026-09-05', status: 'holiday' },
        ],
      },
    }));
    await restoreSnapshot(db, snap);
    const s = await repo.getStudent(db, 1);
    assert.equal(s!.fees_resume, null);
    const rows = await db.getAllAsync('SELECT date, status FROM attendance ORDER BY date');
    assert.deepEqual(rows, [{ date: '2026-09-01', status: 'present' }, { date: '2026-09-02', status: 'leave' }]);
    assert.deepEqual(await repo.listHolidays(db, '2026-09-01', '2026-09-30'), [{ date: '2026-09-05', name: '' }]);
  });
  it('rejects files that are not TuitionBook backups, damaged, or from a newer app', () => {
    assert.throws(() => parseSnapshot('not json'), /not a valid/);
    assert.throws(() => parseSnapshot('{}'), /not a TuitionBook backup/);
    assert.throws(() => parseSnapshot('{"app":"other","data":{}}'), /not a TuitionBook backup/);
    assert.throws(() => parseSnapshot('{"app":"tuitionbook","data":{"students":"oops"}}'), /damaged/);
    assert.throws(() => parseSnapshot(`{"app":"tuitionbook","schemaVersion":${SCHEMA_VERSION + 1},"data":{}}`), /newer version/);
  });
  it('a restore that fails half-way leaves the existing data untouched', async () => {
    setNow('2026-09-29');
    const db = await freshDb();
    await student(db, { name: 'Keep me' });
    const bad = parseSnapshot(JSON.stringify({
      app: 'tuitionbook', schemaVersion: SCHEMA_VERSION, exportedAt: 'x', counts: {},
      data: { students: [{ id: 1, name: null, joining_date: '2026-01-01', monthly_fee: 0, status: 'active', created_at: 'x' }] },
    }));
    await assert.rejects(restoreSnapshot(db, bad));
    assert.deepEqual((await repo.listStudents(db, {})).map((x) => x.name), ['Keep me']);
  });
  it('an empty backup restores to an empty app', async () => {
    const db = await freshDb();
    await student(db);
    const empty = await createSnapshot(await freshDb());
    await restoreSnapshot(db, empty);
    assert.equal((await repo.listStudents(db, {})).length, 0);
  });
  it('handles a large coaching centre quickly (300 students, 2 years)', async () => {
    setNow('2026-09-29');
    const db = await freshDb();
    const t0 = Date.now();
    for (let i = 0; i < 300; i++) await student(db, { name: `Student ${i}`, joining_date: '2024-10-01' });
    const snap = await createSnapshot(db);
    assert.equal(snap.counts.fee_dues, 300 * 24);
    const target = await freshDb();
    await restoreSnapshot(target, parseSnapshot(JSON.stringify(snap)));
    assert.equal((await repo.listStudents(target, {})).length, 300);
    assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0} ms`);
  });
});

describe('sample data', () => {
  it('loads and can be erased (settings kept)', async () => {
    setNow('2026-09-29');
    const db = await freshDb();
    await repo.setSettings(db, { tutor_name: 'Priya' });
    await seedDemo(db);
    assert.equal((await repo.listStudents(db, {})).length, 18);
    await wipeAll(db);
    assert.equal((await repo.listStudents(db, {})).length, 0);
    assert.equal((await repo.getSettings(db)).tutor_name, 'Priya');
  });
});
