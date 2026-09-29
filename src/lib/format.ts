import { Linking } from 'react-native';

export function rupees(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Digits only, with the country code added to a 10-digit local number. */
export function normalizePhone(phone: string, countryCode = '91'): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return countryCode + digits;
  if (digits.length === 11 && digits.startsWith('0')) return countryCode + digits.slice(1);
  return digits;
}

export function openWhatsApp(phone: string, text: string, countryCode = '91') {
  const url = `https://wa.me/${normalizePhone(phone, countryCode)}?text=${encodeURIComponent(text)}`;
  return Linking.openURL(url);
}

export function callPhone(phone: string) {
  return Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`);
}

export function pct(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 100);
}
