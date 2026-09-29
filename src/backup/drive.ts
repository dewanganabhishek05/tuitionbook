// Google Drive REST v3: backups live in a "TuitionBook Backups" folder in the user's own Drive.
import type { SQLiteDatabase } from 'expo-sqlite';
import { getAccessToken, refreshAccessToken } from './googleAuth';
import { backupFileName, createSnapshot, parseSnapshot, type Snapshot } from './snapshot';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = 'TuitionBook Backups';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveBackup {
  id: string;
  name: string;
  createdTime: string;
  size?: string;
}

/** fetch with the user's token; retries once with a fresh token on 401. */
async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let token = await getAccessToken();
  const go = (t: string) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });
  let res = await go(token);
  if (res.status === 401) {
    token = await refreshAccessToken(token);
    res = await go(token);
  }
  if (!res.ok) {
    let msg = `Google Drive error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error?.message) msg = body.error.message;
    } catch {
      // not JSON
    }
    throw new Error(msg);
  }
  return res;
}

async function findFolder(): Promise<string | null> {
  const q = `name = '${FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const res = await driveFetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`);
  const body = (await res.json()) as { files: { id: string }[] };
  return body.files[0]?.id ?? null;
}

async function ensureFolder(): Promise<string> {
  const existing = await findFolder();
  if (existing) return existing;
  const res = await driveFetch(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  return ((await res.json()) as { id: string }).id;
}

export async function uploadBackup(db: SQLiteDatabase): Promise<DriveBackup> {
  const snap = await createSnapshot(db);
  const folderId = await ensureFolder();
  const boundary = `tb${Date.now().toString(36)}`;
  const meta = { name: backupFileName(), mimeType: 'application/json', parents: [folderId] };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(snap)}\r\n--${boundary}--`;
  const res = await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=id,name,createdTime,size`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await res.json()) as DriveBackup;
}

export async function listBackups(): Promise<DriveBackup[]> {
  const folderId = await findFolder();
  if (!folderId) return [];
  const q = `'${folderId}' in parents and trashed = false`;
  const res = await driveFetch(
    `${API}/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&pageSize=30&fields=files(id,name,createdTime,size)`,
  );
  return ((await res.json()) as { files: DriveBackup[] }).files;
}

export async function downloadBackup(id: string): Promise<Snapshot> {
  const res = await driveFetch(`${API}/files/${encodeURIComponent(id)}?alt=media`);
  return parseSnapshot(await res.text());
}

export async function deleteBackup(id: string) {
  await driveFetch(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
