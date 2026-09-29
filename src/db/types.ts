export type AttendanceStatus = 'present' | 'absent' | 'leave';
export type PaymentMode = 'cash' | 'upi' | 'bank' | 'other';
export type FeeStatus = 'paid' | 'partial' | 'pending' | 'overdue';

export interface Student {
  id: number;
  name: string;
  parent_phone: string;
  class_name: string;
  joining_date: string;
  monthly_fee: number;
  status: 'active' | 'archived';
  notes: string;
  created_at: string;
  fees_resume: string | null;
}

export interface StudentListItem extends Student {
  outstanding: number;
}

export interface RollEntry {
  student_id: number;
  name: string;
  parent_phone: string;
  class_name: string;
  joining_date: string;
  status: AttendanceStatus | null;
  note: string | null;
}

export interface FeeRow {
  id: number; // fee_due id
  student_id: number;
  month: string;
  amount_due: number;
  paid: number;
  last_paid_on: string | null;
  name: string;
  parent_phone: string;
  class_name: string;
}

export interface DaySummary {
  date: string;
  expected: number; // active students who had joined by that date
  marked: number;
  present: number;
  absent: number;
  leave: number;
  holiday: boolean;
  holiday_name: string;
}

export interface Holiday {
  date: string;
  name: string;
}

export interface CalendarDay {
  date: string;
  expected: number; // active students who had joined by then
  marked: number;
  present: number;
  absent: number;
  leave: number;
  holiday: Holiday | null;
}

export interface Payment {
  id: number;
  fee_due_id: number;
  amount: number;
  paid_on: string;
  mode: PaymentMode;
  note: string;
  created_at: string;
}

export interface Settings {
  tutor_name: string;
  center_name: string;
  fee_due_day: number;
  default_fee: number;
  country_code: string;
  last_backup_at: string;
  last_backup_where: string;
}
