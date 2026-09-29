import type { SQLiteDatabase } from 'expo-sqlite';
import { transaction } from './tx';

export const DB_NAME = 'tuitionbook.db';

/**
 * Ordered migrations. Each entry moves the database from version i to i+1.
 * Never edit a shipped migration: append a new one instead.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS batches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    days        TEXT    NOT NULL DEFAULT '',      -- ISO weekdays, e.g. "1,3,5" (Mon, Wed, Fri)
    start_time  TEXT    NOT NULL DEFAULT '',      -- "HH:MM", 24h
    default_fee INTEGER NOT NULL DEFAULT 0,       -- whole rupees
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS students (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    parent_phone TEXT    NOT NULL DEFAULT '',
    class_name   TEXT    NOT NULL DEFAULT '',
    joining_date TEXT    NOT NULL,                -- "YYYY-MM-DD"
    monthly_fee  INTEGER NOT NULL DEFAULT 0,
    status       TEXT    NOT NULL DEFAULT 'active', -- active | archived
    notes        TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    batch_id   INTEGER NOT NULL REFERENCES batches(id)  ON DELETE CASCADE,
    PRIMARY KEY (student_id, batch_id)
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id   INTEGER NOT NULL REFERENCES batches(id)  ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    date       TEXT    NOT NULL,                  -- "YYYY-MM-DD"
    status     TEXT    NOT NULL,                  -- present | absent | leave | holiday
    UNIQUE (batch_id, student_id, date)
  );
  CREATE INDEX IF NOT EXISTS idx_attendance_date    ON attendance(date);
  CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id, date);

  CREATE TABLE IF NOT EXISTS fee_dues (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    month      TEXT    NOT NULL,                  -- "YYYY-MM"
    amount_due INTEGER NOT NULL,
    UNIQUE (student_id, month)
  );
  CREATE INDEX IF NOT EXISTS idx_fee_dues_month ON fee_dues(month);

  CREATE TABLE IF NOT EXISTS payments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    fee_due_id INTEGER NOT NULL REFERENCES fee_dues(id) ON DELETE CASCADE,
    amount     INTEGER NOT NULL,
    paid_on    TEXT    NOT NULL,                  -- "YYYY-MM-DD"
    mode       TEXT    NOT NULL DEFAULT 'cash',   -- cash | upi | bank | other
    note       TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_payments_due ON payments(fee_due_id);
  `,
  // v2: month from which fees resume after a student is restored from the archive (null = joining month).
  `ALTER TABLE students ADD COLUMN fees_resume TEXT;`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Tables in dependency order (parents first). Used by backup/restore. */
export const TABLES = {
  settings: ['key', 'value'],
  batches: ['id', 'name', 'days', 'start_time', 'default_fee', 'archived', 'created_at'],
  students: ['id', 'name', 'parent_phone', 'class_name', 'joining_date', 'monthly_fee', 'status', 'notes', 'created_at', 'fees_resume'],
  enrollments: ['student_id', 'batch_id'],
  attendance: ['id', 'batch_id', 'student_id', 'date', 'status'],
  fee_dues: ['id', 'student_id', 'month', 'amount_due'],
  payments: ['id', 'fee_due_id', 'amount', 'paid_on', 'mode', 'note', 'created_at'],
} as const;

export type TableName = keyof typeof TABLES;

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await transaction(db, async (tx) => {
      await tx.execAsync(MIGRATIONS[version]);
      await tx.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
    version += 1;
  }
}
