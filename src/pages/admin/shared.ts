import { supabase } from '@/lib/supabase';
import { fetchAll, selectIn } from '@/lib/query';
import type { Profile, RoleKey, StudentGroup } from '@/lib/types';

/** الأدوار التي لها «نطاق طلاب» (المدير والتفريغ والعضو بلا نطاق) */
export const SCOPED_ROLES: RoleKey[] = [
  'sheikh',
  'contact_officer',
  'attendance_officer',
  'finance_officer',
  'tasks_officer',
];

export interface StudentLite {
  id: string;
  full_name: string;
}

/** طلاب المجلس مرتبين أبجديًا */
export async function loadStudents(circleId: string): Promise<StudentLite[]> {
  const enrolled = await fetchAll<{ student_id: string }>(() =>
    supabase.from('enrollments').select('id, student_id').eq('circle_id', circleId),
  );
  const people = await selectIn<Pick<Profile, 'id' | 'full_name'>>(
    'profiles',
    'id, full_name',
    'id',
    enrolled.map((e) => e.student_id),
  );
  return people.sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));
}

export async function loadGroups(circleId: string): Promise<StudentGroup[]> {
  const { data } = await supabase.from('student_groups').select('*').eq('circle_id', circleId).order('name');
  return (data ?? []) as StudentGroup[];
}
