// Web preview stub: Google sign-in uses native Android/iOS SDKs, so Drive backup is phone-only.
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface GoogleAccount {
  email: string;
  name: string | null;
  photo: string | null;
}

export const googleAuthSupported = false;
const NOT_HERE = 'Google Drive backup works in the Android / iOS app, not in the web preview.';

export function currentAccount(): GoogleAccount | null {
  return null;
}
export async function restoreAccount(): Promise<GoogleAccount | null> {
  return null;
}
export async function connectAccount(): Promise<GoogleAccount | null> {
  throw new Error(NOT_HERE);
}
export async function disconnectAccount() {}
export async function getAccessToken(): Promise<string> {
  throw new Error(NOT_HERE);
}
export async function refreshAccessToken(_stale: string): Promise<string> {
  throw new Error(NOT_HERE);
}
