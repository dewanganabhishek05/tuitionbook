// Test harness: real SQLite (better-sqlite3) behind the same async API expo-sqlite exposes,
// plus a controllable clock so month/day boundaries can be tested.
import Database from 'better-sqlite3';
import { migrate } from '../src/db/schema';

/* ------------------------------------------------------------------ clock */

const RealDate = Date;
let fixed: number | null = null;

class FakeDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0 && fixed !== null) super(fixed);
    else super(...(args as []));
  }
  static now() {
    return fixed ?? RealDate.now();
  }
}

/** Freeze "now" at a local date-time, e.g. setNow('2026-03-15T10:00'). */
export function setNow(local: string) {
  const [d, t = '10:00'] = local.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  fixed = new RealDate(y, m - 1, day, hh, mm).getTime();
  (globalThis as { Date: DateConstructor }).Date = FakeDate as unknown as DateConstructor;
}

export function resetNow() {
  fixed = null;
  (globalThis as { Date: DateConstructor }).Date = RealDate;
}

/* --------------------------------------------------------------------- db */

export type TestDb = ReturnType<typeof adapter>;

export function adapter(raw: Database.Database) {
  const args = (p: unknown[]) => (p.length === 1 && (Array.isArray(p[0]) || (p[0] && typeof p[0] === 'object')) ? p[0] : p);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    raw,
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    runAsync: async (sql: string, ...p: unknown[]) => {
      const r = raw.prepare(sql).run(args(p) as never);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes };
    },
    getAllAsync: async (sql: string, ...p: unknown[]) => {
      const st = raw.prepare(sql);
      if (!st.reader) {
        st.run(args(p) as never);
        return [];
      }
      return st.all(args(p) as never);
    },
    getFirstAsync: async (sql: string, ...p: unknown[]) => {
      const st = raw.prepare(sql);
      if (!st.reader) {
        st.run(args(p) as never);
        return null;
      }
      return st.get(args(p) as never) ?? null;
    },
    withExclusiveTransactionAsync: async (fn: (tx: unknown) => Promise<void>) => {
      raw.exec('BEGIN EXCLUSIVE');
      try {
        await fn(db);
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  db.withTransactionAsync = (fn: () => Promise<void>) => db.withExclusiveTransactionAsync(fn);
  return db;
}

export async function freshDb() {
  const db = adapter(new Database(':memory:'));
  await migrate(db);
  return db;
}
