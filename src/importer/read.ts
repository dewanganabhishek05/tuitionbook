// Opens whatever the user picked (photo, PDF, Excel, CSV, Word, text, contacts…) and returns students.
import { unzipSync, strFromU8 } from 'fflate';
import * as XLSX from 'xlsx';
import { pagesToRows, type OcrPage } from './ocr';
import { mergeResults, parseRows, textToRows, vcardRows, type ParseResult, type Row } from './parse';

export interface Picked { uri: string; name: string; mimeType?: string | null }

export class ImportError extends Error {}

type Kind = 'image' | 'pdf' | 'bytes';

const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|bmp|gif)$/i;
const MAX_BYTES = 30 * 1024 * 1024;

function kindOf(f: Picked): Kind {
  const mime = (f.mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/') || IMAGE_EXT.test(f.name)) return 'image';
  if (mime === 'application/pdf' || /\.pdf$/i.test(f.name)) return 'pdf';
  return 'bytes';
}

async function readBytes(uri: string): Promise<Uint8Array> {
  let buf: ArrayBuffer;
  const { Platform } = await import('react-native');
  if (Platform.OS === 'web') buf = await (await fetch(uri)).arrayBuffer();
  else {
    const { File } = await import('expo-file-system');
    buf = await new File(uri).arrayBuffer();
  }
  if (buf.byteLength > MAX_BYTES) throw new ImportError('That file is too large (limit 30 MB).');
  return new Uint8Array(buf);
}

const startsWith = (b: Uint8Array, ...sig: number[]) => sig.every((v, i) => b[i] === v);

/* ------------------------------------------------------------------ individual formats */

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function fromWorkbook(wb: XLSX.WorkBook): ParseResult {
  const parts: ParseResult[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '', blankrows: false });
    const rows: Row[] = grid.map((r) => r.map(cellText));
    // A sheet named "Class 8" gives its students that class when the rows do not say.
    const sheetClass = /^(?:class|std|standard|grade)\s*[-:]?\s*(\d{1,2})\b|^(\d{1,2})(?:st|nd|rd|th)?$/i.exec(name.trim());
    const cls = sheetClass ? `Class ${sheetClass[1] ?? sheetClass[2]}` : '';
    parts.push(parseRows(rows, { reliable: true, sheetClass: cls }));
  }
  return mergeResults(parts);
}

const unxml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

function wordText(xml: string): string {
  return unxml(
    xml.replace(/<w:tab\s*\/>/g, '\t').replace(/<w:br\s*\/>/g, ' ')
      .replace(/<\/w:p>/g, ' ').replace(/<(?!w:t[ >])[^>]*>/g, '').replace(/<w:t[^>]*>/g, '')
      .replace(/<\/w:t>/g, ''),
  ).replace(/\s+/g, ' ').trim();
}

/** Word .docx: table rows become rows of cells, every other paragraph is one row. */
export function docxRows(xml: string): { rows: Row[]; tables: boolean } {
  const rows: Row[] = [];
  let tables = false;
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g;
  for (const m of xml.matchAll(re)) {
    if (m[0].startsWith('<w:tbl>')) {
      tables = true;
      for (const tr of m[0].matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)) {
        rows.push([...tr[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((tc) => wordText(tc[0])));
      }
    } else {
      const t = wordText(m[0]);
      if (t) rows.push([t]);
    }
  }
  return { rows, tables };
}

function fromDocx(files: Record<string, Uint8Array>): ParseResult {
  const doc = files['word/document.xml'];
  if (!doc) throw new ImportError('Could not read that Word file.');
  const { rows, tables } = docxRows(strFromU8(doc));
  return parseRows(rows, { reliable: tables });
}

function fromText(text: string, name: string): ParseResult {
  if (/BEGIN:VCARD/i.test(text)) return parseRows(vcardRows(text), { reliable: false });
  const t = text.trim();
  if ((t.startsWith('[') || t.startsWith('{')) && /\.json$/i.test(name)) {
    try {
      const data = JSON.parse(t);
      const arr: Record<string, unknown>[] = Array.isArray(data) ? data : Array.isArray(data?.students) ? data.students : [];
      if (arr.length && typeof arr[0] === 'object') {
        const keys = [...new Set(arr.flatMap((o) => Object.keys(o)))];
        return parseRows([keys, ...arr.map((o) => keys.map((k) => cellText(o[k])))], { reliable: true });
      }
    } catch { /* fall through to plain text */ }
  }
  const { rows, reliable } = textToRows(text);
  return parseRows(rows, { reliable });
}

function looksLikeText(b: Uint8Array): boolean {
  const n = Math.min(b.length, 4000);
  let bad = 0;
  for (let i = 0; i < n; i++) if (b[i] === 0 || (b[i] < 9) || (b[i] > 13 && b[i] < 32)) bad++;
  return n > 0 && bad / n < 0.02;
}

function decode(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  return new TextDecoder('utf-8').decode(b);
}

async function fromBytes(b: Uint8Array, name: string): Promise<ParseResult> {
  if (startsWith(b, 0x25, 0x50, 0x44, 0x46)) throw new ImportError('PDF'); // %PDF with a wrong name: caller retries as pdf
  if (startsWith(b, 0x50, 0x4b, 0x03, 0x04)) {
    const files = unzipSync(b, { filter: (f) => /^(word\/document\.xml|xl\/|\[Content_Types\]|content\.xml|mimetype)/.test(f.name) });
    if (files['word/document.xml']) return fromDocx(files);
    try { return fromWorkbook(XLSX.read(b, { type: 'array', dateNF: 'yyyy-mm-dd' })); } catch { /* not a sheet */ }
    if (files['content.xml']) {
      // .odt text: strip tags per paragraph/row
      const xml = strFromU8(files['content.xml']);
      const rows: Row[] = [...xml.matchAll(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g)].map((m) => [unxml(m[1].replace(/<[^>]+>/g, ''))]);
      return parseRows(rows, { reliable: false });
    }
    throw new ImportError('Could not find a student list in that file.');
  }
  if (startsWith(b, 0xd0, 0xcf, 0x11, 0xe0)) {
    try { return fromWorkbook(XLSX.read(b, { type: 'array', dateNF: 'yyyy-mm-dd' })); } catch {
      throw new ImportError('Old Word (.doc) files cannot be read. Save it as .docx or PDF and try again.');
    }
  }
  if (/\.(xlsx?|xlsm|xlsb|ods|numbers)$/i.test(name)) {
    try { return fromWorkbook(XLSX.read(b, { type: 'array', dateNF: 'yyyy-mm-dd' })); } catch { /* try as text */ }
  }
  if (looksLikeText(b)) return fromText(decode(b), name);
  throw new ImportError('This file type is not supported. Use a photo, PDF, Excel, CSV, Word or text file.');
}

/* ------------------------------------------------------------------ OCR */

async function ocr(uri: string, isPdf: boolean): Promise<ParseResult> {
  const { recognize, ocrAvailable } = await import('../../modules/tuition-ocr');
  if (!ocrAvailable) throw new ImportError('Reading photos and PDFs works in the Android app. In a browser, use Excel, CSV, Word or text files.');
  let pages: OcrPage[];
  try {
    pages = await recognize(uri, isPdf);
  } catch (e) {
    const msg = (e as { code?: string; message?: string });
    if (msg.code === 'PDF_PROTECTED') throw new ImportError('This PDF is password protected. Remove the password and try again.');
    throw new ImportError(msg.message || 'Could not read the text from this file.');
  }
  const rows = pagesToRows(pages);
  console.log('[import-ocr-debug]', JSON.stringify(rows)); // TEMP: remove after device check
  if (!rows.length) throw new ImportError('No text was found. Try a clearer, well-lit photo with the whole list in view.');
  return parseRows(rows, { reliable: false });
}

/* ------------------------------------------------------------------ entry */

export async function readStudents(files: Picked[]): Promise<ParseResult & { files: number }> {
  const parts: ParseResult[] = [];
  const problems: string[] = [];
  for (const f of files) {
    try {
      const kind = kindOf(f);
      if (kind === 'image') parts.push(await ocr(f.uri, false));
      else if (kind === 'pdf') parts.push(await ocr(f.uri, true));
      else {
        const bytes = await readBytes(f.uri);
        try {
          parts.push(await fromBytes(bytes, f.name));
        } catch (e) {
          if ((e as Error).message === 'PDF') parts.push(await ocr(f.uri, true));
          else throw e;
        }
      }
    } catch (e) {
      problems.push(files.length > 1 ? `${f.name}: ${(e as Error).message}` : (e as Error).message);
    }
  }
  if (!parts.length) throw new ImportError(problems.join('\n') || 'Nothing could be read.');
  const merged = mergeResults(parts);
  return { ...merged, skipped: [...problems, ...merged.skipped].slice(0, 40), files: parts.length };
}
