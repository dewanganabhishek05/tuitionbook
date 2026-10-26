// Turns a report into a PDF or Excel file and hands it to the share sheet (or downloads it on web).
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { reportToHtml } from './html';
import type { Report } from './types';
import { reportToXlsx } from './xlsx';

export type ReportFormat = 'pdf' | 'xlsx';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// A4 at 72 dpi, which is what expo-print counts page size in.
const A4 = { portrait: { width: 595, height: 842 }, landscape: { width: 842, height: 595 } };

export async function exportReport(report: Report, format: ReportFormat): Promise<string> {
  const name = `${report.fileBase}.${format}`;

  if (format === 'xlsx') {
    const bytes = reportToXlsx(report);
    if (Platform.OS === 'web') {
      download(new Blob([bytes as BlobPart], { type: XLSX_MIME }), name);
      return name;
    }
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    await share(file.uri, XLSX_MIME, name);
    return name;
  }

  const html = reportToHtml(report);
  if (Platform.OS === 'web') {
    // Browsers make the PDF themselves: open the report on its own and use "Save as PDF".
    const w = window.open('', '_blank');
    if (!w) throw new Error('Allow pop-ups to save the PDF.');
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
    return name;
  }
  const size = report.landscape ? A4.landscape : A4.portrait;
  const printed = await Print.printToFileAsync({ html, ...size });
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  await new File(printed.uri).move(file);
  await share(file.uri, 'application/pdf', name);
  return name;
}

async function share(uri: string, mimeType: string, name: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: name, UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : 'org.openxmlformats.spreadsheetml.sheet' });
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
