export type AttendanceStatus = 'present' | 'absent' | 'leave' | 'holiday';
export type PaymentMode = 'cash' | 'upi' | 'bank' | 'other';
export type FeeStatus = 'paid' | 'partial' | 'pending' | 'overdue';

export interface Batch {
  id: number;
  name: string;
  days: string; // "1,3,5"
  start_time: string; // "HH:MM"
  default_fee: number;
  archived: number;
  created_at: string;
}

export interface BatchWithCount extends Batch {
  student_count: number;
}

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
  batch_names: string | null;
  outstanding: number;
}

export interface RollEntry {
  student_id: number;
  name: string;
  parent_phone: string;
  status: AttendanceStatus | null;
}

export interface BatchDay {
  batch: BatchWithCount;
  scheduled: boolean;
  marked: number;
  present: number;
  absent: number;
  holiday: boolean;
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
  batch_names: string | null;
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
  country_code: string;
  last_backup_at: string;
  last_backup_where: string;
}
