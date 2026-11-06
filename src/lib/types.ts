export type RoleKey =
  | 'sheikh'
  | 'admin'
  | 'contact_officer'
  | 'attendance_officer'
  | 'finance_officer'
  | 'tasks_officer'
  | 'transcription_officer'
  | 'member'
  | 'student';

export const ROLE_LABEL: Record<RoleKey, string> = {
  sheikh: 'الشيخ',
  admin: 'مدير المنصة',
  contact_officer: 'مسؤول التواصل',
  attendance_officer: 'مسؤول الحضور',
  finance_officer: 'مسؤول الرسوم',
  tasks_officer: 'مسؤول التكاليف',
  transcription_officer: 'مسؤول التفريغ',
  member: 'عضو المجلس الخاص',
  student: 'طالب',
};

export type CircleType = 'public' | 'private';
export type AttendanceState = 'present' | 'late' | 'excused' | 'absent';
export type ContactOutcome = 'confirmed' | 'apologized' | 'no_answer' | 'wrong_number';
export type TaskType = 'worship' | 'activity' | 'initiative' | 'research';
export type ProgressState = 'not_started' | 'partial' | 'done' | 'stalled';
export type ReasonCode = 'forgot' | 'circumstance' | 'unclear_task' | 'dropped_out' | 'other';
export type PaymentMethod = 'cash' | 'transfer' | 'wallet';
export type SummaryStatus = 'draft' | 'pending_review' | 'approved' | 'published';
export type SessionStatus = 'scheduled' | 'open' | 'closed';

export const ATTENDANCE_LABEL: Record<AttendanceState, string> = {
  present: 'حاضر',
  late: 'متأخر',
  excused: 'بعذر',
  absent: 'غائب',
};

export const ATTENDANCE_CYCLE: AttendanceState[] = ['present', 'late', 'excused', 'absent'];

export const CONTACT_LABEL: Record<ContactOutcome, string> = {
  confirmed: 'مؤكد',
  apologized: 'معتذر',
  no_answer: 'لم يرد',
  wrong_number: 'رقم خاطئ',
};

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  worship: 'عبادة',
  activity: 'نشاط',
  initiative: 'مبادرة',
  research: 'بحث',
};

export const PROGRESS_LABEL: Record<ProgressState, string> = {
  not_started: 'لم يُسجَّل',
  partial: 'جزئي',
  done: 'منجز',
  stalled: 'متعثر',
};

export const REASON_LABEL: Record<ReasonCode, string> = {
  forgot: 'نسيان',
  circumstance: 'ظرف طارئ',
  unclear_task: 'لم يفهم التكليف',
  dropped_out: 'انقطاع',
  other: 'سبب آخر',
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'نقدي',
  transfer: 'تحويل',
  wallet: 'محفظة',
};

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  age: number | null;
  university: string | null;
  major: string | null;
  city: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
}

export interface Circle {
  id: string;
  name: string;
  type: CircleType;
  sheikh_id: string | null;
  schedule_rule: string | null;
  location: string | null;
  parent_circle_id: string | null;
  is_active: boolean;
}

export interface Session {
  id: string;
  circle_id: string;
  title: string | null;
  held_at: string;
  status: SessionStatus;
  recording_url: string | null;
}

export interface Role {
  id: string;
  profile_id: string;
  circle_id: string;
  role: RoleKey;
  revoked_at: string | null;
}

export interface Assignment {
  id: string;
  role_id: string;
  student_id: string;
  revoked_at: string | null;
}

export interface Enrollment {
  id: string;
  circle_id: string;
  student_id: string;
  fee_plan_id: string | null;
  exempt_reason: string | null;
  status: string;
}

export interface ContactLog {
  id: string;
  session_id: string;
  student_id: string;
  by_profile_id: string;
  channel: string;
  outcome: ContactOutcome;
  note: string | null;
  contacted_at: string;
}

export interface AttendanceRow {
  id: string;
  session_id: string;
  student_id: string;
  state: AttendanceState;
  marked_at: string;
}

export interface Payment {
  id: string;
  enrollment_id: string;
  amount: number;
  method: PaymentMethod;
  receipt_no: number;
  paid_at: string;
  reversal_of: string | null;
  note: string | null;
}

export interface Task {
  id: string;
  session_id: string;
  type: TaskType;
  title: string;
  description: string | null;
  due_at: string | null;
  recurrence: string | null;
}

export interface TaskProgress {
  id: string;
  task_id: string;
  student_id: string;
  state: ProgressState;
  percent: number;
  days_done: string[];
  evidence_url: string | null;
  reason: ReasonCode | null;
  updated_at: string;
}

export interface Summary {
  id: string;
  session_id: string;
  transcript_url: string | null;
  summary_md: string | null;
  status: SummaryStatus;
  published_at: string | null;
}

export interface WaTemplate {
  id: string;
  circle_id: string | null;
  key: string;
  label: string;
  body: string;
}

export interface EnrollmentBalance {
  enrollment_id: string;
  circle_id: string;
  student_id: string;
  full_name: string;
  due: number;
  paid: number;
  remaining: number;
  last_paid_at: string | null;
  fee_plan_id: string | null;
  exempt_reason: string | null;
}

export interface FeePlan {
  id: string;
  circle_id: string;
  name: string;
  total_amount: number;
  installments: number;
  currency: string;
}
