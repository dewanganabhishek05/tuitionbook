// End-to-end UI flows against the web preview (phone-sized viewport, fresh install).
// Run:  npx expo start --web --port 8081   then   node tests/e2e/flows.mjs [baseUrl]
// Needs Playwright (npm i -D playwright). Screenshots land in tests/e2e/out/.
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE = process.argv[2] || 'http://localhost:8081';
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const TODAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const y = new Date(d); y.setDate(d.getDate() - 1);
const YESTERDAY = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
const t = new Date(d); t.setDate(d.getDate() + 1);
const TOMORROW = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
const nm = new Date(d.getFullYear(), d.getMonth() + 1, 5);
const NEXT_MONTH_DAY = `${nm.getFullYear()}-${pad(nm.getMonth() + 1)}-05`;

const results = [];
let page;
const alerts = [];

const vis = (loc) => loc.filter({ visible: true }).first();
const text = (s, exact = false) => vis(page.getByText(s, { exact }));
const ph = (s) => vis(page.getByPlaceholder(s, { exact: true }));
const label = (s) => vis(page.getByLabel(s, { exact: true }));
async function see(s, exact = false, timeout = 8000) {
  await text(s, exact).waitFor({ state: 'visible', timeout });
}
async function notSee(s, exact = false) {
  await page.waitForTimeout(300);
  const n = await page.getByText(s, { exact }).filter({ visible: true }).count();
  if (n) throw new Error(`Expected not to see "${s}"`);
}
async function click(s, exact = false) {
  await text(s, exact).click();
  await page.waitForTimeout(250);
}
async function fill(placeholder, value) {
  const f = ph(placeholder);
  await f.fill('');
  await f.fill(value);
}
async function go(path) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
}
async function tab(name) {
  await vis(page.getByRole('tab', { name })).click().catch(async () => click(name, true));
  await page.waitForTimeout(400);
}
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    const shot = `${OUT}FAIL-${results.length + 1}.png`;
    await page.screenshot({ path: shot }).catch(() => {});
    results.push({ name, ok: false, error: e.message.split('\n')[0], shot });
    console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`);
  }
}
const lastAlert = () => alerts.at(-1) ?? '';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
  page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(60000);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', async (dlg) => { alerts.push(dlg.message()); await dlg.accept(); });

  console.log(`\nTuitionBook E2E · ${BASE} · today ${TODAY}\n`);
  await go('/');

  /* ---------------------------------------------------------- onboarding */
  await step('Fresh install starts straight away: add a student or try sample data', async () => {
    await see('Add your first student');
    await see('Try with sample data');
    await notSee('batch');
  });

  await step('Settings: a default monthly fee for new students', async () => {
    await go('/settings');
    const inputs = page.locator('input').filter({ visible: true });
    await inputs.nth(2).fill('15a');
    await click('Save', true);
    await see('Whole rupees only');
    await inputs.nth(2).fill('1500');
    await click('Save', true);
    await see('Add your first student');
  });

  /* ------------------------------------------------------------- students */
  await step('Student form validates required fields and dates', async () => {
    await click('Add student', true);
    await see('New student');
    await vis(page.getByText('Add student', { exact: true })).click();
    await see('Enter the student’s name');
    await see('Enter a 10-digit phone number');
    await fill('e.g. Aarav Sharma', 'Aarav Sharma');
    await fill('10-digit mobile', '98765');
    await fill('YYYY-MM-DD', '2026-02-30');
    await vis(page.getByText('Add student', { exact: true })).click();
    await see('Enter a 10-digit phone number');
    await see('Use the format YYYY-MM-DD');
  });

  await step('Fee pre-fills from Settings; the student is saved', async () => {
    await fill('10-digit mobile', '98765 43210');
    await fill('YYYY-MM-DD', YESTERDAY); // joined yesterday so a past day can be marked
    await fill('e.g. Class 10, DPS', 'Class 10 · DPS');
    const fee = await ph('0').inputValue();
    if (fee !== '1500') throw new Error(`fee pre-fill was "${fee}"`);
    await vis(page.getByText('Add student', { exact: true })).click();
    await see('Aarav Sharma');
    await see('₹1,500 / month');
    await see('Class 10 · DPS');
  });

  await step('Save & add another keeps class and fee, clears name and phone', async () => {
    await go('/student/form');
    await fill('e.g. Aarav Sharma', 'Diya Patel');
    await fill('10-digit mobile', '9000000011');
    await fill('e.g. Class 10, DPS', 'Class 9');
    await click('Save & add another');
    await see('✓ Diya Patel added');
    if ((await ph('e.g. Aarav Sharma').inputValue()) !== '') throw new Error('name not cleared');
    if ((await ph('e.g. Class 10, DPS').inputValue()) !== 'Class 9') throw new Error('class not kept');
    await fill('e.g. Aarav Sharma', 'Kabir Singh');
    await fill('10-digit mobile', '9000000012');
    await click('Save & add another');
    await see('✓ Kabir Singh added');
  });

  await step('Add a future joiner and a free (₹0) student', async () => {
    await go('/student/form');
    await fill('e.g. Aarav Sharma', 'Future Kid');
    await fill('10-digit mobile', '9000000001');
    await fill('YYYY-MM-DD', NEXT_MONTH_DAY);
    await vis(page.getByText('Add student', { exact: true })).click();
    await see('No fees yet', false);
    await go('/student/form');
    await fill('e.g. Aarav Sharma', "Free D'Souza");
    await fill('10-digit mobile', '9000000002');
    await fill('0', '0');
    await vis(page.getByText('Add student', { exact: true })).click();
    await see('₹0 / month');
  });

  await step('Students list: search by name, phone and class; fee-pending filter', async () => {
    await go('/students');
    await see('5 shown');
    await fill('Search name, phone or class', 'aarav');
    await see('1 shown');
    await fill('Search name, phone or class', '43210');
    await see('Aarav Sharma');
    await fill('Search name, phone or class', 'class 9');
    await see('Diya Patel');
    await see('2 shown'); // Kabir kept "Class 9" from "Save & add another"
    await fill('Search name, phone or class', 'zzz');
    await see('No matches');
    await fill('Search name, phone or class', '');
    await click('Fee pending', true);
    await see('3 shown');
    await click('All', true);
  });

  await step('Edit a student’s fee: this month’s due follows', async () => {
    await text('Aarav Sharma', true).click();
    await label('Edit student').click();
    await see('Edit student');
    await fill('0', '2000');
    await click('Save changes');
    await see('₹2,000 / month');
  });

  /* ----------------------------------------------------------- attendance */
  await step('Today shows one attendance card for everyone who has joined', async () => {
    await go('/');
    await see('4 students');
    await see('Not marked');
    await click('Take attendance');
    await see('Save attendance');
    await see('Aarav Sharma');
    await see("Free D'Souza");
    await notSee('Future Kid');
    await see('Present of 4');
    await see('Class 10 · DPS');
  });

  await step('All absent, Holiday toggle and Leave update the counts', async () => {
    await click('All absent');
    await click('Holiday', true);
    await see('Marked as holiday');
    await see('Save as holiday');
    await click('Holiday', true);
    await click('All present');
    await label("Free D'Souza Leave").click();
    await label('Aarav Sharma Absent').click();
    await see('Present of 4');
  });

  await step('Save shows the absent-parents sheet; Today shows the counts', async () => {
    await click('Save attendance');
    await see('Tell parents?');
    await see('Send', true);
    await click('Done', true);
    await see('2/4 present');
    await page.screenshot({ path: `${OUT}today-marked.png` });
  });

  await step('A student added after marking shows as "not marked yet"', async () => {
    await go('/student/form');
    await fill('e.g. Aarav Sharma', 'Late Joiner');
    await fill('10-digit mobile', '9000000099');
    await vis(page.getByText('Add student', { exact: true })).click();
    await see('Late Joiner');
    await go('/');
    await see('1 not marked yet');
  });

  await step('Re-opening keeps the saved marks and offers Update', async () => {
    await click('Edit', true);
    await see('Update attendance');
    await see('Late Joiner');
  });

  await step('Clear attendance removes the day', async () => {
    await label('Clear attendance').click();
    await see('Not marked');
  });

  await step('Mark a past day (yesterday); next day is blocked at today', async () => {
    await label('Previous day').click();
    await see('Yesterday');
    await see('1 student');
    await click('Take attendance');
    await see('Present of 1');
    await notSee("Free D'Souza"); // joined today, so not on yesterday's roll
    await click('Save attendance');
    await see('Yesterday');
    await see('1/1 present');
    await label('Next day').click();
    await see('Today', true);
    await label('Next day').click({ force: true });
    await see('Today', true);
  });

  await step('Holiday saves and shows on Today', async () => {
    await click('Take attendance');
    await click('Holiday', true);
    await click('Save as holiday');
    await see('Holiday', true);
  });

  /* ------------------------------------------------------------- calendar */
  await step('Calendar tab: month grid, legend and month summary', async () => {
    await go('/calendar');
    await see('Calendar', true);
    await see('Days taken');
    await see('Planned leave');
    await see('Tap a date to see each student');
    await page.screenshot({ path: `${OUT}calendar.png` });
  });

  await step('Tap today: day screen shows the holiday; rename it, then remove it', async () => {
    await label(`Day ${TODAY}`).click();
    await see('Holiday', true);
    await see('No class this day');
    await label('Rename holiday').click();
    await fill('e.g. Diwali, Exam break', 'Rain holiday');
    await vis(page.getByText('Save', { exact: true })).click();
    await see('Rain holiday');
    await go('/');
    await see('Rain holiday');
    await go(`/day/${TODAY}`);
    await click('Remove holiday');
    await see('Take attendance');
  });

  await step('Past day: see each student and change one to leave with a reason', async () => {
    await go(`/day/${YESTERDAY}`);
    await see('Yesterday');
    await see('Present', true);
    await text('Aarav Sharma', true).click();
    await page.getByText('Leave', { exact: true }).filter({ visible: true }).last().click(); // the chip in the sheet
    await fill('e.g. Sick, Family function', 'Sick');
    await vis(page.getByText('Save', { exact: true })).click();
    await see('Leave: Sick');
  });

  await step('Future day: plan leave for a student and mark a named holiday', async () => {
    await go(`/day/${TOMORROW}`);
    await see('Upcoming day');
    await notSee('Take attendance');
    await text('Diya Patel', true).click();
    await notSee('Present', true); // only leave is allowed ahead of time
    await fill('e.g. Sick, Family function', 'Family function');
    await vis(page.getByText('Save', { exact: true })).click();
    await see('Leave: Family function');
    const t2 = new Date(d); t2.setDate(d.getDate() + 2);
    const IN2 = `${t2.getFullYear()}-${pad(t2.getMonth() + 1)}-${pad(t2.getDate())}`;
    await go(`/day/${IN2}`);
    await click('Mark holiday');
    await fill('e.g. Diwali, Exam break', 'Diwali');
    await page.getByText('Mark as holiday', { exact: true }).filter({ visible: true }).last().click(); // the button, not the title
    await see('Diwali');
    await see('Holiday', true);
  });

  await step('Planned leave is pre-filled when that day’s roll is taken', async () => {
    // Tomorrow can't be marked yet, so check it on the day screen and in the calendar list instead.
    await go('/calendar');
    if (TOMORROW.slice(0, 7) === TODAY.slice(0, 7)) {
      await see('Holidays & planned leave');
      await see('1 on leave');
    }
    await go(`/day/${TOMORROW}`);
    await see('Leave', true);
  });

  /* ------------------------------------------------------------------ fees */
  await step('Fees tab: pending list, totals and WhatsApp remind button', async () => {
    await go('/fees');
    await see('Pending · 4');
    await see('Paid · 0');
    await see('₹2,000', true);
    await label('Remind Aarav Sharma').waitFor();
  });

  await step('Payment validation: overpay and future date', async () => {
    await text('Aarav Sharma', true).click();
    await see('Balance due');
    await fill('0', '2500');
    await click('Record ₹2,500');
    await see('That’s more than the balance of ₹2,000');
    await fill('0', '500');
    await vis(page.getByLabel('Payment date')).fill(TOMORROW);
    await click('Record ₹500');
    await see('Payment date can’t be in the future');
  });

  await step('Partial payment: sheet and balance', async () => {
    await click('Today', true);
    await click('Cash', true);
    await fill('e.g. UPI ref 1234', 'first instalment');
    await click('Record ₹500');
    await see('Payment recorded');
    await see('₹1,500 still due');
    await see('Send receipt on WhatsApp');
    await click('Done', true);
    await see('₹500 paid');
  });

  await step('Pay the rest: moves to the Paid tab', async () => {
    await text('Aarav Sharma', true).click();
    await click('Record ₹1,500');
    await click('Done', true);
    await see('Pending · 3');
    await click('Paid · 1');
    await see('Aarav Sharma');
  });

  await step('Delete a payment re-opens the fee', async () => {
    await text('Aarav Sharma', true).click();
    await vis(page.getByLabel('Delete payment')).click();
    await see('Balance due');
    await label('Back').click();
    await click('Pending · 4');
  });

  await step('Change amount due to ₹0 warns (below paid), then marks the month paid', async () => {
    await text('Aarav Sharma', true).click();
    await click('Change amount due');
    await see('For a discount');
    await vis(page.locator('input[inputmode="numeric"]').last()).fill('0');
    await vis(page.getByText('Save', { exact: true })).click();
    await page.waitForTimeout(500);
    if (!lastAlert().includes('Less than already paid')) throw new Error('no warning when below paid amount');
    await see('Paid', true);
  });

  await step('Month navigation: can go back, cannot go past this month', async () => {
    await go('/fees');
    const monthLabel = await vis(page.getByText(/^[A-Z][a-z]{2} \d{4}$/)).textContent();
    await label('Next month').click();
    const after = await vis(page.getByText(/^[A-Z][a-z]{2} \d{4}$/)).textContent();
    if (after !== monthLabel) throw new Error('moved into the future');
    await label('Previous month').click();
    await see('No fees for');
  });

  /* ------------------------------------------------ student lifecycle */
  await step('Archive a student: leaves All, appears in Archived, restore works', async () => {
    await go('/students');
    await text("Free D'Souza", true).click();
    await click('Archive student');
    await see('Archived', true);
    await see('Delete permanently');
    await go('/students');
    await notSee("Free D'Souza", true);
    await click('Archived', true);
    await see("Free D'Souza");
    await text("Free D'Souza", true).click();
    await click('Restore student');
    await notSee('Delete permanently');
  });

  await step('Delete permanently (only for archived students)', async () => {
    await click('Archive student');
    await click('Delete permanently');
    await go('/students');
    await notSee("Free D'Souza", true);
  });

  /* ------------------------------------------------------------ settings */
  await step('Settings validate the due day and personalise the greeting', async () => {
    await go('/settings');
    const inputs = page.locator('input').filter({ visible: true });
    await inputs.nth(0).fill('Priya');
    await inputs.nth(3).fill('0');
    await click('Save', true);
    await see('Pick a day from 1 to 28');
    await inputs.nth(3).fill('31');
    await click('Save', true);
    await see('Pick a day from 1 to 28');
    await inputs.nth(3).fill('5');
    await click('Save', true);
    await go('/');
    await see(', Priya');
  });

  /* -------------------------------------------------------------- backup */
  let backupPath;
  await step('Export a backup file (valid JSON, no batch tables)', async () => {
    await go('/backup');
    await see('Not backed up yet');
    const dl = page.waitForEvent('download');
    await click('Export file');
    const file = await dl;
    backupPath = `${OUT}${file.suggestedFilename()}`;
    await file.saveAs(backupPath);
    const snap = JSON.parse(readFileSync(backupPath, 'utf8'));
    if (snap.app !== 'tuitionbook' || snap.counts.students !== 5 || 'batches' in snap.data) {
      throw new Error(`bad backup: ${JSON.stringify(snap.counts)}`);
    }
    await see('Last backup just now');
  });

  await step('Erase all data, then restore from the file', async () => {
    await go('/settings');
    await click('Erase all data');
    await go('/');
    await see('Add your first student');
    await go('/backup');
    const chooser = page.waitForEvent('filechooser');
    await click('Restore file');
    await (await chooser).setFiles(backupPath);
    await page.waitForTimeout(1200);
    if (!alerts.some((a) => a.startsWith('Replace data on this phone?'))) throw new Error('no confirmation before restore');
    if (!lastAlert().startsWith('Restored')) throw new Error(`last alert: ${lastAlert()}`);
    await go('/students');
    await see('Aarav Sharma');
    await see('Future Kid');
  });

  await step('An old backup that has batches restores fine', async () => {
    await go('/backup');
    const old = {
      app: 'tuitionbook', schemaVersion: 2, exportedAt: '2026-09-01T00:00:00Z', counts: { students: 1 },
      data: {
        batches: [{ id: 1, name: 'Maths' }], enrollments: [{ student_id: 1, batch_id: 1 }],
        students: [{ id: 1, name: 'Old Batch Kid', parent_phone: '9000000000', class_name: '', joining_date: '2026-01-01', monthly_fee: 100, status: 'active', notes: '', created_at: 'x' }],
        attendance: [{ id: 1, batch_id: 1, student_id: 1, date: '2026-09-01', status: 'present' }],
      },
    };
    const chooser = page.waitForEvent('filechooser');
    await click('Restore file');
    await (await chooser).setFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
    await page.waitForTimeout(1200);
    if (!lastAlert().startsWith('Restored')) throw new Error(`last alert: ${lastAlert()}`);
    await go('/students');
    await see('Old Batch Kid');
  });

  await step('Restoring a non-backup file is refused with a clear message', async () => {
    await go('/backup');
    const chooser = page.waitForEvent('filechooser');
    await click('Restore file');
    await (await chooser).setFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
    await page.waitForTimeout(800);
    if (!lastAlert().includes('not a TuitionBook backup')) throw new Error(`alert was: ${lastAlert()}`);
  });

  await step('Google Drive section explains it is phone-only in the web preview', async () => {
    await see('Google Drive backup works in the Android / iOS app');
  });

  /* ------------------------------------------------------- deep links */
  await step('Missing records show friendly screens, not crashes', async () => {
    await go('/student/999');
    await see('Student not found');
    await go('/payment/999');
    await see('Not found', true);
    await label('Back').click();
    await see('Attendance');
  });

  await step('Sample data loads on top of an empty install', async () => {
    await go('/settings');
    await click('Erase all data');
    await go('/');
    await click('Try with sample data');
    await see('/18 paid', false, 60000);
    await see('18 students');
    await go('/students');
    await see('18 shown');
  });

  await step('With many absentees, the parents sheet still shows Done on screen (found on Android)', async () => {
    await go('/');
    await click('Take attendance');
    await click('All absent');
    await click('Save attendance');
    await see('Tell parents?');
    const done = page.getByText('Done', { exact: true }).filter({ visible: true }).last();
    const box = await done.boundingBox();
    if (!box || box.y + box.height > 844) throw new Error(`Done is off-screen (y=${box && Math.round(box.y)})`);
    await done.click({ trial: false });
    await see('0/18 present');
  });

  await step('No JavaScript errors during the whole run', async () => {
    if (pageErrors.length) throw new Error(pageErrors.join(' | '));
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} flows passed`);
  process.exit(failed.length ? 1 : 0);
})();
