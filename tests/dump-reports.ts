// Dev helper: writes every report as HTML for the sample data (used to eyeball the PDF layout).
import { writeFileSync } from 'node:fs';
import { seedDemo } from '../src/db/seed';
import { listStudents } from '../src/db/repo';
import { attendanceReport, feesReport, studentReport } from '../src/reports/data';
import { reportToHtml } from '../src/reports/html';
import { freshDb, setNow } from './harness';

(async () => {
  setNow('2026-10-26');
  const db = await freshDb();
  await seedDemo(db);
  const out = process.argv[2];
  const sid = (await listStudents(db, {}))[0].id;
  const all: [string, Awaited<ReturnType<typeof attendanceReport>>][] = [
    ['attendance', await attendanceReport(db, '2026-10')], ['fees', await feesReport(db, '2026-10')],
    ['student', await studentReport(db, sid)], ['students', await studentReport(db, 'all')],
  ];
  for (const [k, r] of all) writeFileSync(`${out}/${k}.html`, reportToHtml(r));
  console.log(all.map(([k, r]) => `${k}:${r.landscape ? 'L' : 'P'}`).join(' '));
})();
