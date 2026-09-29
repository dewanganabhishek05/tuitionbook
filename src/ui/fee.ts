import type { FeeStatus } from '../db/types';
import type { Tone } from './theme';

export const FEE_BADGE: Record<FeeStatus, { label: string; tone: Tone }> = {
  paid: { label: 'Paid', tone: 'good' },
  partial: { label: 'Partial', tone: 'warn' },
  pending: { label: 'Pending', tone: 'neutral' },
  overdue: { label: 'Overdue', tone: 'bad' },
};

export const MODE_LABEL = { cash: 'Cash', upi: 'UPI', bank: 'Bank', other: 'Other' } as const;
