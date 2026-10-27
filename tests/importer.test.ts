import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import * as XLSX from 'xlsx';
import { docxRows } from '../src/importer/read';
import { wordsToRows, type OcrWord } from '../src/importer/ocr';
import { isDuplicate, mergeResults, normClass, normDate, parseRows, takePhones, textToRows, vcardRows } from '../src/importer/parse';

const names = (r: { students: { name: string }[] }) => r.students.map((s) => s.name);

test('header row: columns mapped by name, any order', () => {
  const r = parseRows([
    ['S.No', 'Student Name', 'Class', 'Parent Mobile', 'Monthly Fee', 'Date of Joining', 'Remarks'],
    ['1', 'AARAV SHARMA', '8', '98765 43210', '1,500', '05/06/2025', 'Needs maths help'],
    ['2', 'Diya Verma', 'Class 10', '+91 91234-56789', '₹2000', '2025-07-01', ''],
    ['', '', '', '', '', '', ''],
    ['3', 'Kabir', '', '', '', '', ''],
  ], { reliable: true });
  assert.equal(r.students.length, 3);
  assert.deepEqual(r.students[0], {
    name: 'Aarav Sharma', phone: '9876543210', class_name: 'Class 8', fee: 1500, joining: '2025-06-05',
    notes: 'Needs maths help', source: r.students[0].source,
  });
  assert.equal(r.students[1].phone, '9123456789');
  assert.equal(r.students[1].fee, 2000);
  assert.equal(r.students[1].joining, '2025-07-01');
  assert.equal(r.students[2].name, 'Kabir');
  assert.equal(r.students[2].fee, null);
});

test('first/last name columns are joined', () => {
  const r = parseRows([['First Name', 'Last Name', 'Mobile'], ['Riya', 'Patel', '9000000001']], { reliable: true });
  assert.equal(r.students[0].name, 'Riya Patel');
});

test('no header: each line classified by what it contains', () => {
  const r = parseRows([
    ['1. Aarav Sharma 9876543210 Class 8'],
    ['2) Diya Verma, 10th, 9123456789, Rs 1200'],
    ['3 | Kabir Singh | 8 | 98111 22333 | 1500'],
    ['Rohan Gupta S/o Mahesh Gupta 9811122334'],
    ['5  MEERA IYER  +91 98000 11122'],
  ], { reliable: false });
  assert.deepEqual(names(r), ['Aarav Sharma', 'Diya Verma', 'Kabir Singh', 'Rohan Gupta', 'Meera Iyer']);
  assert.equal(r.students[0].class_name, 'Class 8');
  assert.equal(r.students[1].class_name, 'Class 10');
  assert.equal(r.students[1].fee, 1200);
  assert.equal(r.students[2].class_name, 'Class 8');
  assert.equal(r.students[2].fee, 1500);
  assert.equal(r.students[2].phone, '9811122333');
  assert.equal(r.students[3].notes, 'S/o Mahesh Gupta');
  assert.equal(r.students[4].phone, '9800011122');
});

test('titles, headers and totals are skipped, not added as students', () => {
  const r = parseRows([
    ['Sharma Tuition Classes'],
    ['Student List 2025'],
    ['Sr No', 'Name', 'Phone'],
    ['1', 'Aarav Sharma', '9876543210'],
    ['Total students: 1'],
    ['Signature'],
  ], { reliable: false });
  assert.deepEqual(names(r), ['Aarav Sharma']);
  assert.ok(r.skipped.length >= 2);
});

test('phone formats', () => {
  assert.deepEqual(takePhones('call 09876543210 now').phones, ['9876543210']);
  assert.deepEqual(takePhones('+91-98765-43210').phones, ['9876543210']);
  assert.deepEqual(takePhones('919876543210').phones, ['9876543210']);
  assert.deepEqual(takePhones('9876543210 1500').phones, ['9876543210']);
  assert.deepEqual(takePhones('roll 12345').phones, []);
});

test('dates and classes', () => {
  assert.equal(normDate('5/6/25'), '2025-06-05');
  assert.equal(normDate('31-12-2024'), '2024-12-31');
  assert.equal(normDate('5-Jan-2025'), '2025-01-05');
  assert.equal(normDate('32/01/2025'), null);
  assert.equal(normClass('8'), 'Class 8');
  assert.equal(normClass('VIII'), 'Class 8');
  assert.equal(normClass('10th'), 'Class 10');
  assert.equal(normClass('Std-9 B'), 'Class 9 B');
  assert.equal(normClass('LKG'), 'LKG');
});

test('csv-like and tab text', () => {
  const t = textToRows('Name,Class,Phone\nAarav,8,9876543210\nDiya,9,9123456789\n');
  const r = parseRows(t.rows, { reliable: t.reliable });
  assert.deepEqual(names(r), ['Aarav', 'Diya']);
  assert.equal(r.students[1].class_name, 'Class 9');
  const t2 = textToRows('Aarav Sharma\t9876543210\nDiya Verma\t9123456789');
  assert.deepEqual(names(parseRows(t2.rows, { reliable: t2.reliable })), ['Aarav Sharma', 'Diya Verma']);
  const t3 = textToRows('Aarav Sharma\nDiya Verma\nKabir Singh');
  assert.deepEqual(names(parseRows(t3.rows, { reliable: t3.reliable })), ['Aarav Sharma', 'Diya Verma', 'Kabir Singh']);
});

test('csv: quoted cells keep their commas, quotes and line breaks', () => {
  const t = textToRows('Name,Fees,Notes\n"Sharma, Aarav","1,500","says ""hi""\nsecond line"\nDiya,1200,\n');
  assert.equal(t.rows.length, 3);
  assert.deepEqual(t.rows[1], ['Sharma, Aarav', '1,500', 'says "hi"\nsecond line']);
  const r = parseRows(t.rows, { reliable: t.reliable });
  assert.equal(r.students[0].fee, 1500);
  assert.equal(r.students[1].fee, 1200);
});

test('vcard contacts', () => {
  const rows = vcardRows('BEGIN:VCARD\nFN:Aarav Sharma\nTEL;CELL:+91 98765 43210\nEND:VCARD\nBEGIN:VCARD\nFN:Diya\nTEL:9123456789\nEND:VCARD');
  const r = parseRows(rows, { reliable: false });
  assert.deepEqual(r.students.map((s) => [s.name, s.phone]), [['Aarav Sharma', '9876543210'], ['Diya', '9123456789']]);
});

test('real xlsx: several sheets, sheet name gives the class, date cells', () => {
  const wb = XLSX.utils.book_new();
  const a = XLSX.utils.aoa_to_sheet([['Name', 'Phone', 'Fees', 'DOJ'], ['Aarav Sharma', 9876543210, 1500, new Date(2025, 5, 5)], ['Diya Verma', 9123456789, 1500, new Date(2025, 6, 1)]], { cellDates: true });
  const b = XLSX.utils.aoa_to_sheet([['Name', 'Phone'], ['Kabir Singh', '9811122333']]);
  XLSX.utils.book_append_sheet(wb, a, 'Class 8');
  XLSX.utils.book_append_sheet(wb, b, 'Class 9');
  const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true }));
  const read = XLSX.read(bytes, { type: 'array', dateNF: 'yyyy-mm-dd' });
  // same path as read.ts
  const parts = read.SheetNames.map((n) => {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(read.Sheets[n], { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '', blankrows: false });
    return parseRows(grid.map((r) => r.map(String)), { reliable: true, sheetClass: `Class ${n.split(' ')[1]}` });
  });
  const r = mergeResults(parts);
  assert.deepEqual(r.students.map((s) => [s.name, s.phone, s.class_name, s.fee, s.joining]), [
    ['Aarav Sharma', '9876543210', 'Class 8', 1500, '2025-06-05'],
    ['Diya Verma', '9123456789', 'Class 8', 1500, '2025-07-01'],
    ['Kabir Singh', '9811122333', 'Class 9', null, null],
  ]);
});

test('docx table + paragraphs', () => {
  const xml = `<w:document><w:body>
    <w:p><w:r><w:t>Student list</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Phone</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Aarav</w:t></w:r><w:r><w:t xml:space="preserve"> Sharma</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>98765 43210</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Diya &amp; Co</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>9123456789</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl></w:body></w:document>`;
  const { rows, tables } = docxRows(xml);
  assert.ok(tables);
  assert.deepEqual(rows[0], ['Student list']);
  const r = parseRows(rows, { reliable: true });
  assert.deepEqual(r.students.map((s) => [s.name, s.phone]), [['Aarav Sharma', '9876543210'], ['Diya Co', '9123456789']]);
  assert.ok(zipSync({ 'word/document.xml': strToU8(xml) }).length > 0);
});

test('ocr words → rows: tilted, split lines, column gaps', () => {
  const W = (text: string, x: number, y: number, w = text.length * 14): OcrWord => ({ text, left: x, top: y, right: x + w, bottom: y + 24 });
  // three rows, the photo is tilted so each word is a few px lower than the one before
  const words: OcrWord[] = [];
  const rowsIn = [['1', 'Aarav', 'Sharma', '9876543210'], ['2', 'Diya', 'Verma', '9123456789'], ['3', 'Kabir', 'Singh', '9811122333']];
  rowsIn.forEach((r, i) => {
    let x = 40;
    r.forEach((t, j) => {
      words.push(W(t, x + (j === 3 ? 160 : 0), 100 + i * 60 + j * 4));
      x += t.length * 14 + (j === 0 ? 70 : 12);
    });
  });
  // shuffle: engine order must not matter
  words.sort((a, b) => (a.text < b.text ? 1 : -1));
  const rows = wordsToRows(words);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ['1', 'Aarav Sharma', '9876543210']);
  const r = parseRows(rows, { reliable: false });
  assert.deepEqual(names(r), ['Aarav Sharma', 'Diya Verma', 'Kabir Singh']);
});

test('duplicates are detected by name+phone, or name when a phone is missing', () => {
  const ex = [{ name: 'Aarav Sharma', parent_phone: '+91 98765 43210' }, { name: 'Diya', parent_phone: '' }];
  assert.ok(isDuplicate({ name: 'aarav sharma', phone: '9876543210' }, ex));
  assert.ok(!isDuplicate({ name: 'Aarav Sharma', phone: '9000000000' }, ex));
  assert.ok(isDuplicate({ name: 'Aarav Sharma', phone: '' }, ex));
  assert.ok(isDuplicate({ name: 'Diya', phone: '9123456789' }, ex));
  assert.ok(!isDuplicate({ name: 'Kabir', phone: '' }, ex));
});

test('real OCR output (Tesseract on a table image, a rendered PDF page and a tilted noisy photo)', async () => {
  const fx = (await import('./fixtures/ocr-words.json', { with: { type: 'json' } })).default as Record<string, [string, number, number, number, number][]>;
  const words = (k: string): OcrWord[] => fx[k].map(([text, left, top, right, bottom]) => ({ text, left, top, right, bottom }));
  const table = parseRows(wordsToRows(words('table')), { reliable: false });
  assert.deepEqual(names(table).slice(0, 3), ['Aarav Sharma', 'Diya Verma', 'Kabir Singh']);
  assert.equal(table.students.length, 8);
  assert.deepEqual(table.students[0], { ...table.students[0], phone: '9876543210', class_name: 'Class 8', fee: 1500 });
  const pdf = parseRows(wordsToRows(words('pdf')), { reliable: false });
  assert.deepEqual(pdf.students.map((s) => [s.name, s.class_name, s.fee]), [
    ['Aditi Rao', 'Class 6', 1100], ['Bharat Jain', 'Class 7', 1100], ['Chhavi Bose', 'Class 8', 1300], ['Dhruv Kapoor', 'Class 9', 1400],
  ]);
  const photo = parseRows(wordsToRows(words('photo')), { reliable: false });
  assert.ok(photo.students.length >= 4);
  assert.equal(photo.students[0].phone, '9000000011');
});
