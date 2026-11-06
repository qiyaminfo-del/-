import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAll, selectIn } from '@/lib/query';
import { useApp } from '@/store/session';
import { useCurrentSession, useTemplates } from '@/hooks/useSessions';
import { Card, Chip, Empty, Loading, PageHead, Stat } from '@/components/ui';
import { writeOrQueue, pendingCount } from '@/lib/offline';
import { fillTemplate, isValidPhone, openWhatsApp } from '@/lib/whatsapp';
import { formatDateTime } from '@/lib/format';
import {
  ATTENDANCE_CYCLE,
  ATTENDANCE_LABEL,
  type AttendanceState,
  type Profile,
} from '@/lib/types';

interface Row extends Profile {
  state: AttendanceState | null;
  confirmed: boolean;
  history: string;
}

const TONE: Record<AttendanceState, string> = {
  present: 'bg-emerald-600 text-white',
  late: 'bg-amber-500 text-white',
  excused: 'bg-sky-600 text-white',
  absent: 'bg-rose-600 text-white',
};

export default function Attendance() {
  const { profile, activeCircleId, circles, setPendingSync } = useApp();
  const { session, reload } = useCurrentSession();
  const templates = useTemplates();
  const [rows, setRows] = useState<Row[] | null>(null);

  const circle = circles.find((c) => c.id === activeCircleId);

  const load = useCallback(async () => {
    if (!activeCircleId || !session) {
      setRows([]);
      return;
    }
    setRows(null);

    const enrolled = await fetchAll<{ student_id: string }>(() =>
      supabase.from('enrollments').select('id, student_id').eq('circle_id', activeCircleId),
    );
    const ids = enrolled.map((e) => e.student_id);
    if (!ids.length) {
      setRows([]);
      return;
    }

    const [people, marks, confirms, stats] = await Promise.all([
      selectIn<Profile>('profiles', '*', 'id', ids),
      fetchAll<{ student_id: string; state: AttendanceState }>(() =>
        supabase.from('attendance').select('id, student_id, state').eq('session_id', session.id),
      ),
      fetchAll<{ student_id: string }>(() =>
        supabase
          .from('contacts_log')
          .select('id, student_id')
          .eq('session_id', session.id)
          .eq('outcome', 'confirmed'),
      ),
      // الإحصاء يُحسب في القاعدة، داخل هذا المجلس فقط
      fetchAll<{ student_id: string; total: number; attended: number }>(
        () =>
          supabase
            .from('v_student_attendance_stats')
            .select('student_id, total, attended')
            .eq('circle_id', activeCircleId),
        'student_id',
      ),
    ]);

    const markMap = new Map(marks.map((m) => [m.student_id, m.state]));
    const confirmSet = new Set(confirms.map((c) => c.student_id));
    const seen = new Map(stats.map((s) => [s.student_id, s]));

    const list: Row[] = people.map((p) => {
      const h = seen.get(p.id);
      return {
        ...p,
        state: markMap.get(p.id) ?? null,
        confirmed: confirmSet.has(p.id),
        history: h ? `${h.attended} من ${h.total}` : 'أول مجلس',
      };
    });

    // المؤكدون أولًا — ثمرة وحدة التواصل
    list.sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || a.full_name.localeCompare(b.full_name, 'ar'));
    setRows(list);
  }, [activeCircleId, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const all = rows ?? [];
    return {
      total: all.length,
      present: all.filter((r) => r.state === 'present').length,
      late: all.filter((r) => r.state === 'late').length,
      absent: all.filter((r) => r.state === 'absent').length,
      unmarked: all.filter((r) => !r.state).length,
    };
  }, [rows]);

  async function cycle(row: Row) {
    if (!session) return;
    const idx = row.state ? ATTENDANCE_CYCLE.indexOf(row.state) : -1;
    const next = ATTENDANCE_CYCLE[(idx + 1) % ATTENDANCE_CYCLE.length];

    setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, state: next } : r)) ?? prev);

    const result = await writeOrQueue(
      'attendance',
      {
        session_id: session.id,
        student_id: row.id,
        state: next,
        marked_by: profile?.id ?? null,
        marked_at: new Date().toISOString(),
      },
      'session_id,student_id',
    );
    if (result === 'rejected') {
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, state: row.state } : r)) ?? prev);
      alert('رفضت القاعدة التسجيل. تأكد أن لك دور مسؤول الحضور في هذا المجلس.');
    }
    void pendingCount().then(setPendingSync);
  }

  async function closeSheet() {
    if (!session) return;
    // غير المسجَّلين يُعتبرون غائبين عند الإغلاق
    const missing = (rows ?? []).filter((r) => !r.state);
    for (const r of missing) {
      await writeOrQueue(
        'attendance',
        { session_id: session.id, student_id: r.id, state: 'absent', marked_by: profile?.id ?? null },
        'session_id,student_id',
      );
    }
    const { error } = await supabase.from('sessions').update({ status: 'closed' }).eq('id', session.id);
    if (error) {
      // الغياب حُفظ أو انتظر المزامنة؛ الإغلاق نفسه يحتاج اتصالًا
      alert('سُجّل الغياب، لكن تعذّر إغلاق الكشف الآن. أعد المحاولة عند عودة الاتصال.');
    }
    void pendingCount().then(setPendingSync);
    await reload();
    await load();
  }

  const absentTemplate = templates.find((t) => t.key === 'absence');

  if (!session)
    return <Empty title="لا توجد جلسة" hint="أنشئ جلسة من لوحة الإدارة قبل فتح كشف الحضور." />;
  if (rows === null) return <Loading />;

  const closed = session.status === 'closed';

  return (
    <>
      <PageHead
        title="كشف الحضور"
        sub={formatDateTime(session.held_at)}
        action={
          closed ? (
            <Chip tone="neutral">الكشف مغلق</Chip>
          ) : (
            <button className="btn-primary" onClick={() => void closeSheet()}>
              إغلاق الكشف
            </button>
          )
        }
      />

      <div className="mb-4 grid grid-cols-4 gap-2">
        <Stat label="حاضر" value={stats.present} tone="good" />
        <Stat label="متأخر" value={stats.late} tone="warn" />
        <Stat label="غائب" value={stats.absent} tone="bad" />
        <Stat label="لم يُسجَّل" value={stats.unmarked} />
      </div>

      {rows.length === 0 ? (
        <Empty title="لا طلاب في هذا المجلس" hint="أضف الطلاب من شاشة «قائمتي» أولًا." />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id} className="flex items-center gap-3">
              <button
                disabled={closed}
                onClick={() => void cycle(r)}
                className={`min-w-20 rounded-xl px-3 py-2.5 text-sm font-semibold transition active:scale-95 ${
                  r.state ? TONE[r.state] : 'bg-stone-100 text-ink-soft'
                }`}
              >
                {r.state ? ATTENDANCE_LABEL[r.state] : 'سجّل'}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{r.full_name}</span>
                  {r.confirmed && <Chip tone="info">أكّد الحضور</Chip>}
                </div>
                <p className="text-xs text-ink-soft">حضر {r.history}</p>
              </div>

              {closed && r.state === 'absent' && isValidPhone(r.phone) && absentTemplate && (
                <button
                  className="btn-wa px-3 py-2 text-xs"
                  onClick={() =>
                    openWhatsApp(
                      r.phone!,
                      fillTemplate(absentTemplate.body, {
                        اسم_الطالب: r.full_name,
                        اسم_المجلس: circle?.name,
                      }),
                    )
                  }
                >
                  افتقاد
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      <p className="mt-4 text-center text-xs text-ink-faint">
        الضغط على الزر يدوّر الحالة: حاضر ← متأخر ← بعذر ← غائب. يعمل بلا إنترنت ويزامن تلقائيًا.
      </p>
    </>
  );
}
