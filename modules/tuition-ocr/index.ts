import { Platform } from 'react-native';
import { requireNativeModule } from 'expo';

export interface OcrWord { text: string; left: number; top: number; right: number; bottom: number }
export interface OcrPage { width: number; height: number; words: OcrWord[] }

interface Native { recognize(uri: string, isPdf: boolean): Promise<OcrPage[]> }

export const ocrAvailable = Platform.OS === 'android';

export function recognize(uri: string, isPdf: boolean): Promise<OcrPage[]> {
  if (!ocrAvailable) return Promise.reject(new Error('Reading photos and PDFs works in the Android app.'));
  return requireNativeModule<Native>('TuitionOcr').recognize(uri, isPdf);
}
