// Google account connection (Android/iOS). Only asks for `drive.file`: the app can see
// just the backup files it created itself, never the rest of the user's Drive.
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import Constants from 'expo-constants';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface GoogleAccount {
  email: string;
  name: string | null;
  photo: string | null;
}

let configured = false;

function configure() {
  if (configured) return;
  const webClientId = (Constants.expoConfig?.extra as { googleWebClientId?: string } | undefined)?.googleWebClientId;
  GoogleSignin.configure({
    scopes: [DRIVE_SCOPE],
    webClientId: webClientId && !webClientId.startsWith('REPLACE') ? webClientId : undefined,
  });
  configured = true;
}

export const googleAuthSupported = true;

export function currentAccount(): GoogleAccount | null {
  configure();
  const u = GoogleSignin.getCurrentUser();
  return u ? { email: u.user.email, name: u.user.name, photo: u.user.photo } : null;
}

/** Restores a previous sign-in without UI, if there is one. */
export async function restoreAccount(): Promise<GoogleAccount | null> {
  configure();
  if (!GoogleSignin.hasPreviousSignIn()) return null;
  try {
    const r = await GoogleSignin.signInSilently();
    return r.type === 'success' ? { email: r.data.user.email, name: r.data.user.name, photo: r.data.user.photo } : null;
  } catch {
    return null;
  }
}

export async function connectAccount(): Promise<GoogleAccount | null> {
  configure();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const r = await GoogleSignin.signIn();
    if (!isSuccessResponse(r)) return null; // cancelled
    if (!r.data.scopes?.includes(DRIVE_SCOPE)) {
      const more = await GoogleSignin.addScopes({ scopes: [DRIVE_SCOPE] });
      if (!more || !isSuccessResponse(more)) throw new Error('Drive permission is needed to save backups.');
    }
    return { email: r.data.user.email, name: r.data.user.name, photo: r.data.user.photo };
  } catch (e) {
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.IN_PROGRESS) return null;
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) throw new Error('Google Play Services is not available on this phone.');
      if (e.code === '10' || e.code === 'DEVELOPER_ERROR') {
        throw new Error('Google sign-in is not set up for this build yet (OAuth client / SHA-1). See README → Google Drive setup.');
      }
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export async function disconnectAccount() {
  configure();
  try {
    await GoogleSignin.revokeAccess();
  } catch {
    // already revoked or offline: signing out locally is enough
  }
  await GoogleSignin.signOut();
}

export async function getAccessToken(): Promise<string> {
  configure();
  const { accessToken } = await GoogleSignin.getTokens();
  return accessToken;
}

export async function refreshAccessToken(stale: string): Promise<string> {
  await GoogleSignin.clearCachedAccessToken(stale);
  return getAccessToken();
}
