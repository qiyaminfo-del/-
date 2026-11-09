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
  tasks_officer: 'مسؤول التكاليف والأوراد',
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
  username?: string | null;
  account_kind?: 'student' | 'staff';
  disabled_at?: string | null;
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
  scope_all?: boolean;
}

export interface Assignment {
  id: string;
  role_id: string;
  student_id: string | null;
  group_id: string | null;
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
  arrived_at: string | null;
  marked_by: string | null;
  updated_by: string | null;
  updated_at: string | null;
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
  due_id: string | null;
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
  exempted?: number;
  dues_count?: number;
  status?: DueStatus | 'none';
}

export interface FeePlan {
  id: string;
  circle_id: string;
  name: string;
  total_amount: number;
  installments: number;
  currency: string;
}

/* ---------- المجموعات ---------- */
export interface StudentGroup {
  id: string;
  circle_id: string;
  name: string;
}

/* ---------- الأوراد ---------- */
export type WirdKind = 'check' | 'count' | 'amount';

export const WIRD_KIND_LABEL: Record<WirdKind, string> = {
  check: 'تم / لم يتم',
  count: 'عدد',
  amount: 'كمية',
};

export interface WorshipItem {
  id: string;
  circle_id: string;
  name: string;
  kind: WirdKind;
  unit: string | null;
  is_active: boolean;
  sort: number;
}

export interface WirdLevel {
  id: string;
  circle_id: string;
  name: string;
  description: string | null;
  sort: number;
}

export interface WirdLevelItem {
  level_id: string;
  item_id: string;
  target: number | null;
  sort: number;
}

export interface StudentLevel {
  id: string;
  circle_id: string;
  student_id: string;
  level_id: string;
  started_at: string;
  ended_at: string | null;
}

export interface WirdLog {
  id: string;
  student_id: string;
  item_id: string;
  day: string;
  level_id: string | null;
  done: boolean | null;
  value: number | null;
}

/* ---------- الرسوم المستحقة ---------- */
export type DueStatus = 'paid' | 'partial' | 'unpaid' | 'exempt';

export const DUE_STATUS_LABEL: Record<DueStatus | 'none', string> = {
  paid: 'مسددة',
  partial: 'مسددة جزئيًا',
  unpaid: 'غير مسددة',
  exempt: 'معفى',
  none: 'لا رسوم',
};

export interface FeeDue {
  id: string;
  enrollment_id: string;
  circle_id: string;
  student_id: string;
  full_name: string;
  fee_plan_id: string | null;
  label: string;
  period_start: string | null;
  period_end: string | null;
  amount: number;
  exempt_amount: number;
  exempt_reason: string | null;
  net: number;
  paid: number;
  remaining: number;
  status: DueStatus;
  last_paid_at: string | null;
}
