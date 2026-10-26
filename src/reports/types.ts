// A report is plain data (tables of cells). PDF and Excel are both rendered from the same data.
export type Cell = string | number | null;
export type Fmt = 'text' | 'int' | 'money' | 'pct' | 'center';

export interface Table {
  /** Excel sheet name and the heading above the table in the PDF. */
  name: string;
  columns: string[];
  /** Optional second header row (e.g. weekday letters under the dates). */
  subHeaders?: string[];
  rows: Cell[][];
  /** Per column; defaults to text. money/pct/int are right-aligned numbers, center is centred text. */
  fmt?: Fmt[];
  /** Optional bold last row, e.g. totals. */
  totals?: Cell[];
  /** Shown under the table when there are no rows. */
  emptyNote?: string;
}

export interface Report {
  key: 'attendance' | 'notes' | 'fees' | 'student';
  title: string;
  subtitle: string;
  /** File name without extension. */
  fileBase: string;
  /** Wide tables print on a landscape page. */
  landscape: boolean;
  /** Label / value pairs shown at the top (and as the first sheet in Excel). */
  summary: [string, string][];
  tables: Table[];
  /** Whose report it is (tutor or centre name), printed in the header. */
  owner: string;
  generatedOn: string;
}
