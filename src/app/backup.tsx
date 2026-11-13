import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { ActivityIndicator, Image, Linking, View } from 'react-native';
import { deleteBackup, downloadBackup, listBackups, uploadBackup, type DriveBackup } from '../backup/drive';
import {
  connectAccount, disconnectAccount, googleAuthSupported, restoreAccount, type GoogleAccount,
} from '../backup/googleAuth';
import { exportBackupFile, pickBackupFile } from '../backup/local';
import { GOOGLE_SETUP, GoogleSetupError } from '../backup/setup';
import { describeSnapshot, restoreSnapshot, type Snapshot } from '../backup/snapshot';
import { getSettings, setSettings, ensureDues } from '../db/repo';
import { useDb, useLive } from '../db/live';
import { formatDate, timeAgo, toISODate } from '../lib/dates';
import { Button, Card, Divider, IconButton, Row, Screen, Section, Text, confirm, notify } from '../ui/kit';
import { useTheme } from '../ui/theme';

export default function BackupScreen() {
  const db = useDb();
  const { c } = useTheme();
  const settings = useLive(getSettings);
  const [account, setAccount] = useState<GoogleAccount | null>(null);
  const [checking, setChecking] = useState(googleAuthSupported);
  const [backups, setBackups] = useState<DriveBackup[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  const loadBackups = useCallback(async () => {
    try {
      setBackups(await listBackups());
    } catch (e) {
      setBackups([]);
      notify('Could not load Drive backups', (e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!googleAuthSupported) return;
    restoreAccount().then((a) => {
      setAccount(a);
      setChecking(false);
      if (a) loadBackups();
    });
  }, [loadBackups]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      if (e instanceof GoogleSetupError) setSetupOpen(true); // show the steps instead of an error box
      else notify('Something went wrong', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async (snap: Snapshot, source: string) => {
    const ok = await confirm(
      'Replace data on this phone?',
      `Backup from ${formatDate(toISODate(new Date(snap.exportedAt)))} (${describeSnapshot(snap)}).\n\nEverything currently on this phone will be replaced. Tip: back up first.`,
      'Restore',
      true,
    );
    if (!ok) return;
    await restoreSnapshot(db, snap);
    await ensureDues(db);
    notify('Restored', `Your data from ${source} is back.`);
  };

  return (
    <Screen back title="Backup" subtitle="Your data lives only on this phone">
      <Card>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="shield-checkmark-outline" size={22} color={c.text} />
          </View>
          <View style={{ flex: 1 }}>
            <Text v="heading">
              {settings.data?.last_backup_at ? `Last backup ${timeAgo(settings.data.last_backup_at)}` : 'Not backed up yet'}
            </Text>
            <Text v="caption" tone="muted">
              {settings.data?.last_backup_where ? `Saved to ${settings.data.last_backup_where}. ` : ''}Back up weekly so a lost phone doesn’t lose your records.
            </Text>
          </View>
        </View>
      </Card>

      <Section title="Google Drive">
        <Card>
          {!googleAuthSupported ? (
            <Text v="caption" tone="muted">Google Drive backup works in the Android / iOS app. Use a backup file below in this preview.</Text>
          ) : checking ? (
            <ActivityIndicator color={c.muted} />
          ) : !account ? (
            <View style={{ gap: 12 }}>
              <Text v="caption" tone="muted">
                Connect your Google account to save backups to a “TuitionBook Backups” folder in your own Drive. The app can only see files it creates.
              </Text>
              <Button
                label="Connect Google account"
                icon="logo-google"
                loading={busy === 'connect'}
                onPress={() => run('connect', async () => {
                  const a = await connectAccount();
                  if (a) { setAccount(a); await loadBackups(); }
                })}
              />
              {setupOpen ? (
                <DriveSetupHelp onClose={() => setSetupOpen(false)} />
              ) : (
                <Button label="First time? How to set up" size="sm" variant="ghost" onPress={() => setSetupOpen(true)} />
              )}
              <Text v="caption" tone="faint">
                No Google setup yet? You can still keep backups in Drive: use Export file below and choose Drive.
              </Text>
            </View>
          ) : (
            <View style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {account.photo
                  ? <Image source={{ uri: account.photo }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                  : <Ionicons name="person-circle-outline" size={40} color={c.muted} />}
                <View style={{ flex: 1 }}>
                  <Text v="heading" numberOfLines={1}>{account.name ?? 'Google account'}</Text>
                  <Text v="caption" tone="muted" numberOfLines={1}>{account.email}</Text>
                </View>
                <Button
                  label="Disconnect" size="sm" variant="secondary"
                  onPress={async () => {
                    if (await confirm('Disconnect Google?', 'Backups already in Drive stay there.', 'Disconnect')) {
                      await disconnectAccount();
                      setAccount(null);
                      setBackups(null);
                    }
                  }}
                />
              </View>
              <Button
                label="Back up to Drive now"
                icon="cloud-upload-outline"
                loading={busy === 'upload'}
                onPress={() => run('upload', async () => {
                  await uploadBackup(db);
                  await setSettings(db, { last_backup_at: new Date().toISOString(), last_backup_where: 'Google Drive' });
                  await loadBackups();
                  notify('Backed up', `Saved to Google Drive (${account.email}).`);
                })}
              />
            </View>
          )}
        </Card>

        {account && (
          <Card padded={false}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 4, paddingTop: 6 }}>
              <Text v="label" tone="muted">Backups in Drive</Text>
              <IconButton name="refresh" label="Refresh list" onPress={() => { setBackups(null); loadBackups(); }} />
            </View>
            {backups === null ? (
              <View style={{ padding: 16 }}><ActivityIndicator color={c.muted} /></View>
            ) : backups.length === 0 ? (
              <View style={{ padding: 16, paddingTop: 4 }}><Text v="caption" tone="muted">No backups yet.</Text></View>
            ) : backups.map((b, i) => (
              <View key={b.id}>
                {i > 0 && <Divider inset={16} />}
                <Row
                  title={`${formatDate(toISODate(new Date(b.createdTime)))} · ${new Date(b.createdTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
                  subtitle={`${b.size ? `${Math.max(1, Math.round(Number(b.size) / 1024))} KB · ` : ''}${timeAgo(b.createdTime)}`}
                  chevron={false}
                  right={
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      {busy === `restore:${b.id}` ? <ActivityIndicator color={c.muted} style={{ marginRight: 12 }} /> : (
                        <Button label="Restore" size="sm" variant="secondary"
                          onPress={() => run(`restore:${b.id}`, async () => doRestore(await downloadBackup(b.id), 'Google Drive'))} />
                      )}
                      <IconButton
                        name="trash-outline" label="Delete backup"
                        onPress={async () => {
                          if (await confirm('Delete this backup from Drive?', 'This cannot be undone.', 'Delete', true)) {
                            await run(`del:${b.id}`, async () => { await deleteBackup(b.id); await loadBackups(); });
                          }
                        }}
                      />
                    </View>
                  }
                />
              </View>
            ))}
          </Card>
        )}
      </Section>

      <Section title="Backup file">
        <Card>
          <Text v="caption" tone="muted" style={{ marginBottom: 12 }}>
            Works without any setup. Tap Export file, then choose Drive to keep it in Google Drive, or send it to yourself on WhatsApp or email. Restore picks the file from Drive, Files or anywhere else.
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              label="Export file" icon="download-outline" variant="secondary" style={{ flex: 1 }}
              loading={busy === 'export'}
              onPress={() => run('export', async () => {
                await exportBackupFile(db);
                await setSettings(db, { last_backup_at: new Date().toISOString(), last_backup_where: 'a file' });
              })}
            />
            <Button
              label="Restore file" icon="folder-open-outline" variant="secondary" style={{ flex: 1 }}
              loading={busy === 'import'}
              onPress={() => run('import', async () => {
                const snap = await pickBackupFile();
                if (snap) await doRestore(snap, 'the file');
              })}
            />
          </View>
        </Card>
      </Section>
    </Screen>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  const [done, setDone] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <Text v="caption" tone="muted">{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface2, borderRadius: 14, paddingLeft: 12, paddingRight: 4, paddingVertical: 4 }}>
        <Text style={{ flex: 1, fontSize: 13 }}>{value || '—'}</Text>
        <Button
          label={done ? 'Copied' : 'Copy'} size="sm" variant="secondary" disabled={!value}
          onPress={async () => { await Clipboard.setStringAsync(value); setDone(true); setTimeout(() => setDone(false), 1500); }}
        />
      </View>
    </View>
  );
}

/** Shown when Google says this app is not registered yet: the exact values and steps for Google Cloud Console. */
function DriveSetupHelp({ onClose }: { onClose: () => void }) {
  const steps: [string, string | null][] = [
    ['Create a project in Google Cloud Console and enable the Google Drive API.', GOOGLE_SETUP.driveApiUrl],
    ['OAuth consent screen: choose External, add the scope …/auth/drive.file and add your Gmail as a Test user.', GOOGLE_SETUP.consentUrl],
    ['Credentials → Create credentials → OAuth client ID → Android. Enter the package name and SHA-1 below.', GOOGLE_SETUP.consoleUrl],
    ['Wait a few minutes, come back here and tap Connect Google account.', null],
  ];
  return (
    <View style={{ gap: 12 }}>
      <Text v="heading">Set up Google Drive (one time)</Text>
      <Text v="caption" tone="muted">
        Google needs to know this app before it lets you sign in. It takes about 5 minutes and is free.
      </Text>
      {steps.map(([text, url], i) => (
        <View key={i} style={{ gap: 6 }}>
          <Text v="caption"><Text v="caption" style={{ fontWeight: '700' }}>{i + 1}. </Text>{text}</Text>
          {url ? <Button label="Open in browser" size="sm" variant="secondary" icon="open-outline" onPress={() => Linking.openURL(url)} /> : null}
        </View>
      ))}
      <CopyRow label="Package name" value={GOOGLE_SETUP.packageName} />
      <CopyRow label="SHA-1 certificate fingerprint" value={GOOGLE_SETUP.sha1} />
      <Text v="caption" tone="faint">
        The SHA-1 is for the APK signed with the TuitionBook release key. If you installed the app from Google Play, also add the app signing key SHA-1 shown in Play Console → App integrity.
      </Text>
      <Button label="Hide steps" size="sm" variant="ghost" onPress={onClose} />
    </View>
  );
}
