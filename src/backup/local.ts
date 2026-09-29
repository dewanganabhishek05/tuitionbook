// Manual backup to a file: share/save it anywhere (WhatsApp to self, Files, email), and restore from a picked file.
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { backupFileName, createSnapshot, parseSnapshot, type Snapshot } from './snapshot';

export async function exportBackupFile(db: SQLiteDatabase): Promise<string> {
  const snap = await createSnapshot(db);
  const json = JSON.stringify(snap);
  const name = backupFileName();

  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    return name;
  }

  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(json);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save TuitionBook backup' });
  }
  return name;
}

/** Lets the user pick a backup file. Returns null if they cancel. */
export async function pickBackupFile(): Promise<Snapshot | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const text = Platform.OS === 'web' && asset.file ? await asset.file.text() : await new File(asset.uri).text();
  return parseSnapshot(text);
}
