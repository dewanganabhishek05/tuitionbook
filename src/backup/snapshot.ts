// Backup format: one JSON document holding every table. Restore replaces all local data atomically.
import type { SQLiteDatabase } from 'expo-sqlite';
import { transaction } from '../db/tx';
import { notifyChange } from '../db/live';
import { SCHEMA_VERSION, TABLES, type TableName } from '../db/schema';

export const BACKUP_APP_ID = 'tuitionbook';

export interface Snapshot {
  app: typeof BACKUP_APP_ID;
  schemaVersion: number;
  exportedAt: string;
  counts: Record<string, number>;
  data: Record<TableName, Record<string, unknown>[]>;
}

// Device-specific settings that must not travel with a backup.
const LOCAL_ONLY_SETTINGS = new Set(['last_backup_at', 'last_backup_where']);

export async function createSnapshot(db: SQLiteDatabase): Promise<Snapshot> {
  const data = {} as Snapshot['data'];
  const counts: Record<string, number> = {};
  for (const [table, cols] of Object.entries(TABLES) as [TableName, readonly string[]][]) {
    let rows = await db.getAllAsync<Record<string, unknown>>(`SELECT ${cols.join(', ')} FROM ${table}`);
    if (table === 'settings') rows = rows.filter((r) => !LOCAL_ONLY_SETTINGS.has(String(r.key)));
    data[table] = rows;
    counts[table] = rows.length;
  }
  return { app: BACKUP_APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), counts, data };
}

export function backupFileName(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `tuitionbook-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

export function parseSnapshot(text: string): Snapshot {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('This file is not a valid TuitionBook backup.');
  }
  const s = obj as Partial<Snapshot>;
  if (!s || s.app !== BACKUP_APP_ID || typeof s.data !== 'object' || !s.data) {
    throw new Error('This file is not a TuitionBook backup.');
  }
  if ((s.schemaVersion ?? 0) > SCHEMA_VERSION) {
    throw new Error('This backup was made by a newer version of the app. Please update the app first.');
  }
  for (const t of Object.keys(TABLES)) {
    const rows = (s.data as Record<string, unknown>)[t];
    if (rows !== undefined && !Array.isArray(rows)) throw new Error(`Backup is damaged (table ${t}).`);
  }
  return upgradeSnapshot(s as Snapshot);
}

const RANK: Record<string, number> = { present: 3, absent: 2, leave: 1 };

/**
 * Backups from before v3 had batches (a student could have several marks on one day, one per
 * batch) and stored holidays as a "holiday" mark on everyone. Convert them the same way the v3
 * database migration does: one mark per student per day, and holidays in their own table.
 */
export function upgradeSnapshot(snap: Snapshot): Snapshot {
  if ((snap.schemaVersion ?? 0) >= 3) return snap;
  const data = snap.data as Record<string, Record<string, unknown>[] | undefined>;
  const rows = data.attendance ?? [];
  const holidayDates = new Set<string>();
  const byDate = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const list = byDate.get(String(r.date)) ?? [];
    list.push(r);
    byDate.set(String(r.date), list);
  }
  for (const [date, list] of byDate) if (list.every((r) => r.status === 'holiday')) holidayDates.add(date);

  const byDay = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    if (r.status === 'holiday' || holidayDates.has(String(r.date))) continue;
    const key = `${r.student_id}|${r.date}`;
    const prev = byDay.get(key);
    if (!prev || (RANK[String(r.status)] ?? 0) > (RANK[String(prev.status)] ?? 0)) {
      byDay.set(key, { id: prev?.id ?? r.id, student_id: r.student_id, date: r.date, status: r.status, note: '' });
    }
  }
  const { batches: _b, enrollments: _e, ...rest } = data;
  return {
    ...snap,
    data: {
      ...rest,
      attendance: [...byDay.values()],
      holidays: [...holidayDates].sort().map((date) => ({ date, name: '' })),
    } as unknown as Snapshot['data'],
  };
}

export async function restoreSnapshot(db: SQLiteDatabase, snap: Snapshot) {
  const tables = Object.keys(TABLES) as TableName[];
  const keep = await db.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key IN (${[...LOCAL_ONLY_SETTINGS].map(() => '?').join(',')})`,
    [...LOCAL_ONLY_SETTINGS],
  );
  await transaction(db, async (tx) => {
    await tx.execAsync('PRAGMA defer_foreign_keys = ON');
    for (const t of [...tables].reverse()) await tx.execAsync(`DELETE FROM ${t}`);
    for (const t of tables) {
      const cols = TABLES[t] as readonly string[];
      const rows = snap.data[t] ?? [];
      const sql = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      for (const r of rows) {
        const values = cols.map((c) => {
          const v = r[c];
          return v === undefined ? null : (v as string | number | null);
        });
        await tx.runAsync(sql, values);
      }
    }
    for (const k of keep) {
      await tx.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k.key, k.value);
    }
  });
  notifyChange();
}

export function describeSnapshot(s: Snapshot) {
  const c = s.counts ?? {};
  return `${c.students ?? s.data.students?.length ?? 0} students · ${c.payments ?? s.data.payments?.length ?? 0} payments · ${
    c.attendance ?? s.data.attendance?.length ?? 0
  } attendance marks`;
}
