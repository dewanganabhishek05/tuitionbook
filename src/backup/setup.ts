// What Google Cloud needs to know about this app before Drive sign-in can work.
import Constants from 'expo-constants';

export class GoogleSetupError extends Error {
  constructor() {
    super('Google Drive is not set up for this app yet.');
    this.name = 'GoogleSetupError';
  }
}

interface SetupExtra { package?: string; sha1?: string }

const extra = (Constants.expoConfig?.extra as { googleSetup?: SetupExtra } | undefined)?.googleSetup ?? {};

/** Values to enter in Google Cloud Console → Credentials → OAuth client ID → Android. */
export const GOOGLE_SETUP = {
  packageName: extra.package ?? 'com.tuitionbook.app',
  sha1: extra.sha1 ?? '',
  consoleUrl: 'https://console.cloud.google.com/apis/credentials',
  driveApiUrl: 'https://console.cloud.google.com/apis/library/drive.googleapis.com',
  consentUrl: 'https://console.cloud.google.com/apis/credentials/consent',
};
