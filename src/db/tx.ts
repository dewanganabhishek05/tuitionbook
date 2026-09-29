import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

type Exec = Pick<SQLiteDatabase, 'runAsync' | 'execAsync' | 'getAllAsync' | 'getFirstAsync'>;

// The web preview's SQLite has one connection and no exclusive transactions, so web
// transactions are queued one after another instead of overlapping.
let webQueue: Promise<unknown> = Promise.resolve();

/**
 * Runs `fn` in one transaction. On phones it's an exclusive transaction (other writes wait);
 * on web, transactions are serialized through a queue.
 */
export async function transaction(db: SQLiteDatabase, fn: (tx: Exec) => Promise<void>) {
  if (Platform.OS === 'web') {
    const run = webQueue.then(() => db.withTransactionAsync(() => fn(db)));
    webQueue = run.catch(() => {});
    return run;
  }
  await db.withExclusiveTransactionAsync((tx) => fn(tx));
}
