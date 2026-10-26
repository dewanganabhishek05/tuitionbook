// Report data, HTML and Excel output, plus "tick a chapter for all students".
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as XLSX from 'xlsx';
import * as notes from '../src/db/notes';
import * as repo from '../src/db/repo';
import { seedDemo } from '../src/db/seed';
import { today } from '../src/lib/dates';
import { attendanceReport, feesReport, notesReport, studentReport } from '../src/reports/data';
import { reportToHtml } from '../src/reports/html';
import { reportToXlsx } from '../src/reports/xlsx';
import type { Report } from '../src/reports/types';
import { freshDb, resetNow, setNow, type TestDb } from './harness';

afterEach(() => resetNow());

async function student(db: TestDb, name: string, over: Partial<repo.StudentInput> = {}) {
  return repo.saveStudent(db, {
    name, parent_phone: '9876543210', class_name: 'Class 10', joining_date: '2026-09-01', monthly_fee: 1000, notes: '', ...over,
  });
}
const book = (r: Report) => XLSX.read(reportToXlsx(r), { type: 'array', cellNF: true });
const rows = (wb: XLSX.WorkBook, sheet: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, blankrows: false });

describe('attendance report', () => {
  it('counts per student, draws the day grid, and keeps holidays and late joiners right', async () => {
    setNow('2026-10-15');
    const db = await freshDb();
    const a = await student(db, 'Asha');
    const b = await student(db, 'Bala', { joining_date: '2026-10-10' });
    await repo.saveRoll(db, '2026-10-05', [{ student_id: a, status: 'present' }]);
    await repo.saveRoll(db, '2026-10-06', [{ student_id: a, status: 'absent' }]);
    await repo.setMark(db, '2026-10-07', a, 'leave', 'Sick');
    await repo.saveRoll(db, '2026-10-12', [{ student_id: a, status: 'present' }, { student_id: b, status: 'present' }]);
    await repo.setHoliday(db, '2026-10-08', 'Diwali');
    const r = await attendanceReport(db, '2026-10');
    const summary = r.tables[0];
    assert.deepEqual(summary.rows[0], ['Asha', 'Class 10', 2, 1, 1, 67]);
    assert.deepEqual(summary.rows[1], ['Bala', 'Class 10', 1, 0, 0, 100]);
    assert.deepEqual(summary.totals?.slice(2), [3, 1, 1, 75]);
    const grid = r.tables[1];
    assert.equal(grid.columns.length, 32); // student + 31 days
    assert.equal(grid.subHeaders?.[5], 'M');
    const asha = grid.rows[0];
    assert.deepEqual([asha[5], asha[6], asha[7], asha[8], asha[9]], ['P', 'A', 'L', 'H', '']);
    const bala = grid.rows[1];
    assert.equal(bala[5], '', 'before Bala joined');
    assert.equal(bala[8], '', 'holiday before joining is blank');
    assert.equal(bala[12], 'P');
    assert.match(r.summary.find(([k]) => k === 'Holidays')![1], /Diwali/);
    assert.equal(r.summary.find(([k]) => k === 'Days attendance taken')![1], '4');
    assert.equal(r.fileBase, 'TuitionBook-Attendance-2026-10');
  });
  it('refuses a month with no students', async () => {
    setNow('2026-10-15');
    const db = await freshDb();
    await assert.rejects(() => attendanceReport(db, '2026-10'), /no students/);
    await student(db, 'Late', { joining_date: '2026-11-01' });
    await assert.rejects(() => attendanceReport(db, '2026-10'), /no students/);
  });
});

describe('notes report', () => {
  it('has an overview and one sheet per subject with a tick per chapter', async () => {
    setNow('2026-10-15');
    const db = await freshDb();
    const a = await student(db, 'Asha');
    await student(db, 'Bala');
    const maths = await notes.saveSubject(db, { name: 'Maths' });
    await notes.saveSubject(db, { name: 'Sci/ence: 1?', chapters: 5 });
    for (const ch of [1, 2, 30]) await notes.toggleCheck(db, maths, a, ch);
    const r = await notesReport(db);
    assert.equal(r.tables[0].name, 'Overview');
    assert.deepEqual(r.tables[0].columns.slice(2), ['Maths (of 30)', 'Sci/ence: 1? (of 5)', 'Overall %']);
    assert.deepEqual(r.tables[0].rows[0].slice(2), [3, 0, 9]); // 3 of 35 chapters
    const wb = book(r);
    assert.deepEqual(wb.SheetNames, ['Overview', 'Overview 2', 'Maths', 'Sci ence  1']);
    const sheet = rows(wb, 'Maths');
    assert.equal((sheet[0] as unknown[]).length, 33); // Student, Done, %, 30 chapters
    assert.deepEqual((sheet[1] as unknown[]).slice(0, 6), ['Asha', 3, 10, '✓', '✓', '']);
    assert.equal((sheet[1] as unknown[])[32], '✓');
  });
  it('needs a subject and a student', async () => {
    const db = await freshDb();
    await assert.rejects(() => notesReport(db), /Add a subject/);
    await notes.saveSubject(db, { name: 'Maths' });
    await assert.rejects(() => notesReport(db), /no students/);
  });
});

describe('fees report', () => {
  it('lists dues with status and totals, and the payments received that month', async () => {
    setNow('2026-10-15');
    const db = await freshDb();
    const a = await student(db, 'Asha');
    await student(db, 'Bala', { monthly_fee: 2000 });
    await repo.ensureDues(db);
    const due = (await repo.listFeesForMonth(db, '2026-10')).find((f) => f.student_id === a)!;
    await repo.addPayment(db, { fee_due_id: due.id, amount: 400, paid_on: '2026-10-03', mode: 'upi', note: 'ref 9' });
    await repo.addPayment(db, { fee_due_id: due.id, amount: 600, paid_on: '2026-10-09', mode: 'cash', note: '' });
    const r = await feesReport(db, '2026-10');
    const fees = r.tables[0];
    assert.deepEqual(fees.rows[0].slice(0, 7), ['Asha', 'Class 10', '9876543210', 1000, 1000, 0, 'Paid']);
    assert.deepEqual(fees.rows[1].slice(3, 7), [2000, 0, 2000, 'Overdue']);
    assert.deepEqual(fees.totals?.slice(3, 6), [3000, 1000, 2000]);
    assert.deepEqual(r.tables[1].rows.map((p) => [p[1], p[3], p[4]]), [['Asha', 400, 'UPI'], ['Asha', 600, 'Cash']]);
    assert.equal(r.summary.find(([k]) => k === 'Pending')![1], '₹2,000');
    const wb = book(r);
    assert.equal(wb.Sheets.Fees.D2.v, 1000);
    assert.equal(wb.Sheets.Fees.D2.z, '"₹"#,##0');
    await assert.rejects(() => feesReport(db, '2026-01'), /no fees/);
  });
});

describe('student reports', () => {
  it('one student: attendance by month, fees, payments and notes', async () => {
    setNow('2026-10-15');
    const db = await freshDb();
    const a = await student(db, 'Asha');
    await repo.ensureDues(db);
    const maths = await notes.saveSubject(db, { name: 'Maths' });
    await notes.toggleCheck(db, maths, a, 4);
    await repo.saveRoll(db, '2026-10-05', [{ student_id: a, status: 'present' }]);
    await repo.saveRoll(db, '2026-09-07', [{ student_id: a, status: 'absent' }]);
    const sep = (await repo.listFeesForStudent(db, a)).find((f) => f.month === '2026-09')!;
    await repo.addPayment(db, { fee_due_id: sep.id, amount: 1000, paid_on: '2026-09-04', mode: 'bank', note: '' });
    const r = await studentReport(db, a);
    assert.equal(r.title, 'Asha');
    assert.deepEqual(r.tables.map((t) => t.name), ['Attendance', 'Fees', 'Payments', 'Notes Check']);
    assert.deepEqual(r.tables[0].rows.map((x) => x.slice(0, 4)), [['Sep 2026', 0, 1, 0], ['Oct 2026', 1, 0, 0]]);
    assert.deepEqual(r.tables[1].rows.map((x) => [x[0], x[3], x[4]]), [['Sep 2026', 0, 'Paid'], ['Oct 2026', 1000, 'Overdue']]);
    assert.deepEqual(r.tables[2].rows[0].slice(0, 4), ['4 Sep 2026', 'Sep 2026', 1000, 'Bank']);
    assert.deepEqual(r.tables[3].rows[0], ['Maths', 1, 30, 3]);
    assert.match(r.fileBase, /^TuitionBook-Student-Asha-2026-10-15$/);
    assert.equal(book(r).SheetNames.length, 5);
  });
  it('all students: one line each, and a missing student is an error', async () => {
    setNow('2026-10-15');
    const db = await freshDb();
    const a = await student(db, 'Asha');
    await student(db, 'Bala');
    await repo.ensureDues(db);
    await repo.saveRoll(db, '2026-10-05', [{ student_id: a, status: 'present' }]);
    const r = await studentReport(db, 'all');
    assert.equal(r.tables[0].rows.length, 2);
    assert.equal(r.tables[0].rows[0][6], 100);
    assert.equal(r.tables[0].rows[1][6], null); // no marks yet
    assert.equal(r.tables[0].rows[0][10], null); // no subjects
    await assert.rejects(() => studentReport(db, 999), /no longer exists/);
  });
  it('works on the sample data for every report', async () => {
    setNow('2026-09-29');
    const db = await freshDb();
    await seedDemo(db);
    const sid = (await repo.listStudents(db, {}))[0].id;
    for (const r of [await attendanceReport(db, '2026-09'), await notesReport(db), await feesReport(db, '2026-09'), await studentReport(db, sid), await studentReport(db, 'all')]) {
      const wb = book(r);
      assert.ok(wb.SheetNames.length >= 2, r.title);
      assert.ok(reportToHtml(r).length > 1000, r.title);
    }
  });
});

describe('excel bytes', () => {
  it('are a real Uint8Array holding a zip (xlsx) file', async () => {
    setNow('2026-10-15');
    const db = await freshDb();
    await student(db, 'Asha');
    await repo.ensureDues(db);
    const bytes = reportToXlsx(await feesReport(db, '2026-10'));
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(Object.prototype.toString.call(bytes), '[object Uint8Array]');
    assert.deepEqual([bytes[0], bytes[1]], [0x50, 0x4b]); // "PK"
  });
});

describe('html', () => {
  it('escapes names and shows formatted money, percentages and totals', async () => {
    setNow('2026-10-15');
    const db = await freshDb();
    await student(db, '<script>alert(1)</script> & "Co"');
    await repo.ensureDues(db);
    const html = reportToHtml(await feesReport(db, '2026-10'));
    assert.ok(!html.includes('<script>alert'));
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;Co&quot;/);
    assert.match(html, /₹1,000/);
    assert.match(html, /No payments were received in October 2026/);
    assert.match(html, /size: A4 portrait/);
  });
});

describe('mark a chapter for all students', () => {
  it('ticks and clears for every active student, leaving archived ones alone', async () => {
    const db = await freshDb();
    const a = await student(db, 'Asha');
    const b = await student(db, 'Bala');
    const c = await student(db, 'Chitra');
    const sub = await notes.saveSubject(db, { name: 'Maths' });
    await notes.toggleCheck(db, sub, a, 2); // already ticked for one
    await notes.toggleCheck(db, sub, c, 9);
    await repo.setStudentArchived(db, c, true);
    assert.deepEqual(await notes.chapterCoverage(db, sub).then((x) => [x.students, x.counts[1], x.counts[8], x.counts.length]), [2, 1, 0, 30]);
    await notes.setChapterForAll(db, sub, 2, true);
    assert.deepEqual(await notes.getChecks(db, sub, b), [2]);
    assert.equal((await notes.chapterCoverage(db, sub)).counts[1], 2);
    await notes.setChapterForAll(db, sub, 2, false);
    assert.deepEqual(await notes.getChecks(db, sub, a), []);
    assert.deepEqual(await notes.getChecks(db, sub, c), [9], 'archived student untouched');
    await assert.rejects(() => notes.setChapterForAll(db, sub, 31, true), /No such chapter/);
  });
  it('check all / clear all for everyone', async () => {
    const db = await freshDb();
    const a = await student(db, 'Asha');
    const b = await student(db, 'Bala');
    const sub = await notes.saveSubject(db, { name: 'GK', chapters: 8 });
    await notes.setAllChaptersForAll(db, sub, true);
    assert.equal((await notes.getChecks(db, sub, a)).length, 8);
    assert.equal((await notes.getChecks(db, sub, b)).length, 8);
    await notes.setAllChaptersForAll(db, sub, false);
    assert.equal((await notes.chapterCoverage(db, sub)).counts.every((n) => n === 0), true);
  });
});

void today;
