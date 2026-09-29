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

async function batch(db: TestDb, name = 'Maths', days = [1, 3, 5], fee = 1000) {
  return repo.saveBatch(db, { name, days, start_time: '17:00', default_fee: fee });
}
async function student(db: TestDb, b: number, over: Partial<repo.StudentInput> = {}) {
  return repo.saveStudent(db, {
    name: 'Ravi Kumar', parent_phone: '9876543210', class_name: '', joining_date: today(),
    monthly_fee: 1000, notes: '', batchIds: [b], ...over,
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
    const sid = await student(db, await batch(db), { joining_date: '2025-12-20' });
    assert.deepEqual(await months(db, sid), ['2025-12', '2026-01', '2026-02']);
  });
  it('adds nothing for a future joining date until that month arrives', async () => {
    setNow('2026-09-29');
    const db = await freshDb();
    const sid = await student(db, await batch(db), { joining_date: '2026-10-05' });
    assert.deepEqual(await months(db, sid), []);
    setNow('2026-10-01');
    await repo.ensureDues(db);
    assert.deepEqual(await months(db, sid), ['2026-10']);
  });
  it('catches up months when the app was not opened for a while', async () => {
    setNow('2026-01-15');
    const db = await freshDb();
    const sid = await student(db, await batch(db), { joining_date: '2026-01-01' });
    setNow('2026-04-02');
    assert.equal(await repo.ensureDues(db), 3);
    assert.equal(await repo.ensureDues(db), 0, 'second call adds nothing');
    assert.deepEqual(await months(db, sid), ['2026-01', '2026-02', '2026-03', '2026-04']);
  });
  it('never creates dues for a ₹0 (free) student', async () => {
    setNow('2026-05-10');
    const db = await freshDb();
    const sid = await student(db, await batch(db), { joining_date: '2026-01-01', monthly_fee: 0 });
    assert.deepEqual(await months(db, sid), []);
  });
  it('changing a free student to paid starts this month, not retroactively', async () => {
    setNow('2026-05-10');
    const db = await freshDb();
    const b = await batch(db);
    const sid = await student(db, b, { joining_date: '2026-01-01', monthly_fee: 0 });
    await student(db, b, { id: sid, joining_date: '2026-01-01', monthly_fee: 1500 });
    assert.deepEqual(await dues(db, sid), ['2026-05:1500:0']);
    setNow('2026-06-01');
    await repo.ensureDues(db);
    assert.deepEqual(await months(db, sid), ['2026-05', '2026-06']);
  });
  it('does not charge months while a student was archived', async () => {
    setNow('2026-01-10');
    const db = await freshDb();
    const sid = await student(db, await batch(db), { joining_date: '2026-01-01' });
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
    const b = await batch(db);
    const sid = await student(db, b, { joining_date: '2026-01-01' });
    await repo.setStudentArchived(db, sid, true);
    setNow('2026-04-03');
    await repo.setStudentArchived(db, sid, false);
    await student(db, b, { id: sid, name: 'Renamed', joining_date: '2026-01-01' });
    assert.deepEqual(await months(db, sid), ['2026-01', '2026-04']);
  });
  it('moving the joining date later removes unpaid earlier dues but keeps paid ones', async () => {
    setNow('2026-04-10');
    const db = await freshDb();
    const b = await batch(db);
    const sid = await student(db, b, { joining_date: '2026-01-01' });
    const jan = (await repo.listFeesForStudent(db, sid)).find((f) => f.month === '2026-01')!;
    await repo.addPayment(db, { fee_due_id: jan.id, amount: 1000, paid_on: '2026-01-05', mode: 'cash', note: '' });
    await student(db, b, { id: sid, joining_date: '2026-03-01' });
    assert.deepEqual(await months(db, sid), ['2026-01', '2026-03', '2026-04']);
  });
  it('moving the joining date earlier adds the missing months', async () => {
    setNow('2026-04-10');
    const db = await freshDb();
    const b = await batch(db);
    const sid = await student(db, b, { joining_date: '2026-03-01' });
    await student(db, b, { id: sid, joining_date: '2026-01-15' });
    assert.deepEqual(await months(db, sid), ['2026-01', '2026-02', '2026-03', '2026-04']);
  });
  it('a fee change applies from this month; paid months and past months keep their amount', async () => {
    setNow('2026-03-10');
    const db = await freshDb();
    const b = await batch(db);
    const sid = await student(db, b, { joining_date: '2026-02-01' });
    await student(db, b, { id: sid, joining_date: '2026-02-01', monthly_fee: 1200 });
    assert.deepEqual(await dues(db, sid), ['2026-02:1000:0', '2026-03:1200:0']);
    const mar = (await repo.listFeesForStudent(db, sid)).find((f) => f.month === '2026-03')!;
    await repo.addPayment(db, { fee_due_id: mar.id, amount: 200, paid_on: '2026-03-10', mode: 'upi', note: '' });
    await student(db, b, { id: sid, joining_date: '2026-02-01', monthly_fee: 1500 });
    assert.deepEqual(await dues(db, sid), ['2026-02:1000:0', '2026-03:1200:200'], 'month with a payment is locked');
    setNow('2026-04-01');
    await repo.ensureDues(db);
    assert.ok((await dues(db, sid)).includes('2026-04:1500:0'));
  });
  it('setting the fee to ₹0 keeps past arrears but drops this month', async () => {
    setNow('2026-03-10');
    const db = await freshDb();
    const b = await batch(db);
    const sid = await student(db, b, { joining_date: '2026-01-01' });
    await student(db, b, { id: sid, joining_date: '2026-01-01', monthly_fee: 0 });
    assert.deepEqual(await months(db, sid), ['2026-01', '2026-02']);
  });
});

/* ============================================================= payments */

describe('payments and fee status', () => {
  async function setup(nowAt = '2026-03-05') {
    setNow(nowAt);
    const db = await freshDb();
    const sid = await student(db, await batch(db), { joining_date: '2026-02-01' });
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
  it('save then update the same day is an upsert', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const b = await batch(db);
    const sid = await student(db, b, { joining_date: '2026-09-01' });
    await repo.saveRoll(db, b, '2026-09-28', [{ student_id: sid, status: 'absent' }]);
    await repo.saveRoll(db, b, '2026-09-28', [{ student_id: sid, status: 'present' }]);
    const n = await db.getFirstAsync('SELECT COUNT(*) AS n FROM attendance');
    assert.equal(n.n, 1);
    assert.equal((await repo.getRoll(db, b, '2026-09-28'))[0].status, 'present');
  });
  it('roll excludes students who joined later, and archived students without a record', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const b = await batch(db);
    const early = await student(db, b, { name: 'Early', joining_date: '2026-09-01' });
    await student(db, b, { name: 'Late', joining_date: '2026-09-20' });
    const gone = await student(db, b, { name: 'Gone', joining_date: '2026-09-01' });
    await repo.saveRoll(db, b, '2026-09-10', [{ student_id: early, status: 'present' }, { student_id: gone, status: 'absent' }]);
    await repo.setStudentArchived(db, gone, true);
    assert.deepEqual((await repo.getRoll(db, b, '2026-09-10')).map((r) => r.name), ['Early', 'Gone'], 'history keeps archived');
    assert.deepEqual((await repo.getRoll(db, b, '2026-09-28')).map((r) => r.name), ['Early', 'Late']);
  });
  it('a student in two batches is marked separately in each', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const b1 = await batch(db, 'Maths');
    const b2 = await batch(db, 'Science');
    const sid = await student(db, b1, { batchIds: [b1, b2], joining_date: '2026-09-01' });
    await repo.saveRoll(db, b1, '2026-09-28', [{ student_id: sid, status: 'present' }]);
    await repo.saveRoll(db, b2, '2026-09-28', [{ student_id: sid, status: 'absent' }]);
    const m = await repo.studentMonthAttendance(db, sid, '2026-09');
    assert.deepEqual([m.stats.present, m.stats.absent, m.stats.percent], [1, 1, 50]);
  });
  it('holidays and leave do not count against attendance %', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const b = await batch(db);
    const sid = await student(db, b, { joining_date: '2026-09-01' });
    await repo.saveRoll(db, b, '2026-09-21', [{ student_id: sid, status: 'present' }]);
    await repo.saveRoll(db, b, '2026-09-22', [{ student_id: sid, status: 'holiday' }]);
    await repo.saveRoll(db, b, '2026-09-23', [{ student_id: sid, status: 'leave' }]);
    await repo.saveRoll(db, b, '2026-09-24', [{ student_id: sid, status: 'absent' }]);
    const m = await repo.studentMonthAttendance(db, sid, '2026-09');
    assert.deepEqual(m.stats, { present: 1, absent: 1, leave: 1, percent: 50 });
    const empty = await repo.studentMonthAttendance(db, sid, '2026-08');
    assert.equal(empty.stats.percent, 0);
  });
  it('clearing a day removes only that batch and day', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const b = await batch(db);
    const sid = await student(db, b, { joining_date: '2026-09-01' });
    await repo.saveRoll(db, b, '2026-09-27', [{ student_id: sid, status: 'present' }]);
    await repo.saveRoll(db, b, '2026-09-28', [{ student_id: sid, status: 'present' }]);
    await repo.clearRoll(db, b, '2026-09-28');
    const rows = await db.getAllAsync('SELECT date FROM attendance');
    assert.deepEqual(rows.map((r: { date: string }) => r.date), ['2026-09-27']);
  });
  it('Today screen data: scheduled by weekday, holiday detection, archived batches hidden', async () => {
    setNow('2026-10-04'); // Sunday
    const db = await freshDb();
    const weekday = await batch(db, 'Weekdays', [1, 2, 3, 4, 5]);
    const sunday = await batch(db, 'Sunday', [7]);
    const none = await batch(db, 'No fixed days', []);
    const sid = await student(db, sunday, { joining_date: '2026-10-01', batchIds: [sunday, weekday] });
    await repo.saveRoll(db, sunday, '2026-10-04', [{ student_id: sid, status: 'holiday' }]);
    const days = await repo.getBatchDays(db, '2026-10-04');
    const by = Object.fromEntries(days.map((d) => [d.batch.name, d]));
    assert.equal(by.Sunday.scheduled, true);
    assert.equal(by.Sunday.holiday, true);
    assert.equal(by.Weekdays.scheduled, false);
    assert.equal(by['No fixed days'].scheduled, false);
    await repo.setBatchArchived(db, none, true);
    assert.equal((await repo.getBatchDays(db, '2026-10-04')).length, 2);
  });
  it('batch month summary counts per student and per date', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const b = await batch(db);
    const a = await student(db, b, { name: 'A', joining_date: '2026-09-01' });
    const c = await student(db, b, { name: 'C', joining_date: '2026-09-01' });
    await repo.saveRoll(db, b, '2026-09-21', [{ student_id: a, status: 'present' }, { student_id: c, status: 'absent' }]);
    await repo.saveRoll(db, b, '2026-09-23', [{ student_id: a, status: 'holiday' }, { student_id: c, status: 'holiday' }]);
    const m = await repo.batchMonthAttendance(db, b, '2026-09');
    assert.deepEqual(m.students.map((s) => [s.name, s.present, s.absent]), [['A', 1, 0], ['C', 0, 1]]);
    assert.deepEqual(m.dates.map((d) => [d.date, d.holiday === d.total]), [['2026-09-23', true], ['2026-09-21', false]]);
  });
});

/* ============================================================ students */

describe('students, search and deletes', () => {
  it('search is case-insensitive, matches phone, and treats % and _ literally', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const b = await batch(db);
    await student(db, b, { name: 'Anika Bose', parent_phone: '9000011111' });
    await student(db, b, { name: '100% Rahul', parent_phone: '9000022222' });
    await student(db, b, { name: 'Under_score', parent_phone: '9000033333' });
    const names = async (search: string) => (await repo.listStudents(db, { search })).map((s) => s.name);
    assert.deepEqual(await names('anika'), ['Anika Bose']);
    assert.deepEqual(await names('22222'), ['100% Rahul']);
    assert.deepEqual(await names('%'), ['100% Rahul']);
    assert.deepEqual(await names('_'), ['Under_score']);
    assert.deepEqual(await names('zzz'), []);
    assert.equal((await names('  ')).length, 3, 'blank search shows all');
  });
  it('batch filter combines with search; students can be in several batches', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const m = await batch(db, 'Maths');
    const s = await batch(db, 'Science');
    await student(db, m, { name: 'Both', batchIds: [m, s] });
    await student(db, s, { name: 'Sci only', batchIds: [s] });
    assert.deepEqual((await repo.listStudents(db, { batchId: m })).map((x) => x.name), ['Both']);
    assert.deepEqual((await repo.listStudents(db, { batchId: s, search: 'sci' })).map((x) => x.name), ['Sci only']);
    const both = (await repo.listStudents(db, {})).find((x) => x.name === 'Both')!;
    assert.equal(both.batch_names, 'Maths · Science');
  });
  it('handles Hindi names, apostrophes and quotes safely', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const b = await batch(db, "St. Mary's \"A\"");
    const sid = await student(db, b, { name: 'आरव शर्मा', notes: "Robert'); DROP TABLE students;--" });
    const got = await repo.getStudent(db, sid);
    assert.equal(got!.student.name, 'आरव शर्मा');
    assert.equal(got!.batches[0].name, "St. Mary's \"A\"");
    assert.equal((await repo.listStudents(db, { search: 'आरव' })).length, 1);
  });
  it('deleting a student removes their dues, payments and attendance', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const b = await batch(db);
    const sid = await student(db, b, { joining_date: '2026-09-01' });
    const [due] = await repo.listFeesForStudent(db, sid);
    await repo.addPayment(db, { fee_due_id: due.id, amount: 500, paid_on: '2026-09-28', mode: 'cash', note: '' });
    await repo.saveRoll(db, b, '2026-09-28', [{ student_id: sid, status: 'present' }]);
    await repo.deleteStudent(db, sid);
    for (const t of ['fee_dues', 'payments', 'attendance', 'enrollments']) {
      assert.equal((await db.getFirstAsync(`SELECT COUNT(*) AS n FROM ${t}`)).n, 0, t);
    }
  });
  it('deleting a batch removes its attendance and enrolments but keeps students and fees', async () => {
    setNow('2026-09-28');
    const db = await freshDb();
    const b = await batch(db);
    const sid = await student(db, b, { joining_date: '2026-09-01' });
    await repo.saveRoll(db, b, '2026-09-28', [{ student_id: sid, status: 'present' }]);
    await repo.deleteBatch(db, b);
    assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS n FROM attendance')).n, 0);
    const s = (await repo.listStudents(db, {}))[0];
    assert.equal(s.batch_names, null);
    assert.equal((await repo.listFeesForStudent(db, sid)).length, 1);
  });
  it('batch days are de-duplicated and sorted', async () => {
    const db = await freshDb();
    const b = await repo.saveBatch(db, { name: 'X', days: [5, 1, 3, 1], start_time: '', default_fee: 0 });
    assert.equal((await repo.getBatch(db, b))!.days, '1,3,5');
  });
});

/* ============================================================ settings */

describe('settings', () => {
  it('defaults, saves and survives junk values', async () => {
    const db = await freshDb();
    assert.equal((await repo.getSettings(db)).fee_due_day, 10);
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
    await repo.saveBatch(target, { name: 'To be replaced', days: [], start_time: '', default_fee: 0 });
    await repo.setSettings(target, { last_backup_at: 'KEEP-ME', last_backup_where: 'Google Drive' });
    await restoreSnapshot(target, parseSnapshot(JSON.stringify(snap)));
    const again = await createSnapshot(target);
    for (const t of Object.keys(snap.data)) assert.deepEqual(again.data[t as never], snap.data[t as never], t);
    const s = await repo.getSettings(target);
    assert.equal(s.tutor_name, 'Priya', 'settings travel');
    assert.equal(s.last_backup_at, 'KEEP-ME', 'device-only settings stay');
    assert.deepEqual(await repo.monthSummary(target, '2026-09'), await repo.monthSummary(db, '2026-09'));
    const next = await repo.saveBatch(target, { name: 'New', days: [], start_time: '', default_fee: 0 });
    assert.ok(next > Math.max(...snap.data.batches.map((r) => r.id as number)), 'ids continue after restore');
    assert.match(describeSnapshot(snap), /18 students · \d+ payments · \d+ attendance marks/);
  });
  it('restores an older (v1) backup that lacks newer columns', async () => {
    setNow('2026-09-29');
    const db = await freshDb();
    const snap = parseSnapshot(JSON.stringify({
      app: 'tuitionbook', schemaVersion: 1, exportedAt: '2026-01-01T00:00:00Z', counts: {},
      data: {
        batches: [{ id: 1, name: 'Old', days: '1', start_time: '', default_fee: 0, archived: 0, created_at: 'x' }],
        students: [{ id: 1, name: 'Old kid', parent_phone: '', class_name: '', joining_date: '2026-01-01', monthly_fee: 100, status: 'active', notes: '', created_at: 'x' }],
      },
    }));
    await restoreSnapshot(db, snap);
    const s = await repo.getStudent(db, 1);
    assert.equal(s!.student.fees_resume, null);
    assert.equal((await repo.listBatches(db)).length, 1);
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
    const b = await batch(db, 'Keep me');
    await student(db, b, { name: 'Keep me too' });
    const bad = parseSnapshot(JSON.stringify({
      app: 'tuitionbook', schemaVersion: SCHEMA_VERSION, exportedAt: 'x', counts: {},
      data: { batches: [{ id: 1, name: null, days: '', start_time: '', default_fee: 0, archived: 0, created_at: 'x' }] },
    }));
    await assert.rejects(restoreSnapshot(db, bad));
    assert.deepEqual((await repo.listBatches(db)).map((x) => x.name), ['Keep me']);
    assert.deepEqual((await repo.listStudents(db, {})).map((x) => x.name), ['Keep me too']);
  });
  it('an empty backup restores to an empty app', async () => {
    const db = await freshDb();
    await student(db, await batch(db));
    const empty = await createSnapshot(await freshDb());
    await restoreSnapshot(db, empty);
    assert.equal((await repo.listStudents(db, {})).length, 0);
  });
  it('handles a large coaching centre quickly (300 students, 2 years)', async () => {
    setNow('2026-09-29');
    const db = await freshDb();
    const b = await batch(db);
    const t0 = Date.now();
    for (let i = 0; i < 300; i++) await student(db, b, { name: `Student ${i}`, joining_date: '2024-10-01' });
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
    assert.equal((await repo.listBatches(db)).length, 0);
    assert.equal((await repo.getSettings(db)).tutor_name, 'Priya');
  });
});
