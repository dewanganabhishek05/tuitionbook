// Rebuilds table rows from OCR words using their positions, so a list that was a table on paper
// comes back as rows of cells, however the OCR engine happened to group the lines.
import type { Row } from './parse';

export interface OcrWord { text: string; left: number; top: number; right: number; bottom: number }
export interface OcrPage { width: number; height: number; words: OcrWord[] }

const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
};

export function wordsToRows(words: OcrWord[]): Row[] {
  const ws = words.filter((w) => w.text.trim() && w.right > w.left && w.bottom > w.top);
  if (!ws.length) return [];
  const h = median(ws.map((w) => w.bottom - w.top)) || 10;
  const cy = (w: OcrWord) => (w.top + w.bottom) / 2;

  // Walk left to right; a word joins the row whose last word is just to its left and at the same height.
  // Comparing with the neighbouring word (not the row average) copes with a slightly tilted photo.
  const rows: OcrWord[][] = [];
  for (const w of [...ws].sort((a, b) => a.left - b.left)) {
    let best = -1;
    let bestD = Infinity;
    rows.forEach((r, i) => {
      const last = r[r.length - 1];
      const dy = Math.abs(cy(w) - cy(last));
      const tol = Math.max(0.55 * h, 0.5 * (last.bottom - last.top));
      if (dy <= tol && dy < bestD) { best = i; bestD = dy; }
    });
    if (best >= 0) rows[best].push(w);
    else rows.push([w]);
  }
  rows.sort((a, b) => cy(a[0]) - cy(b[0]));

  return rows.map((r) => {
    const cells: string[] = [];
    let cur: string[] = [];
    r.forEach((w, i) => {
      if (i > 0) {
        const gap = w.left - r[i - 1].right;
        if (gap > 1.1 * h) { cells.push(cur.join(' ')); cur = []; }
      }
      cur.push(w.text);
    });
    cells.push(cur.join(' '));
    return cells;
  });
}

export function pagesToRows(pages: OcrPage[]): Row[] {
  return pages.flatMap((p) => wordsToRows(p.words));
}
