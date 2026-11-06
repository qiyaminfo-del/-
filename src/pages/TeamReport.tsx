import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/store/session';
import { Bar, Card, Chip, Empty, Loading, PageHead, Stat } from '@/components/ui';
import { formatNumber, percent } from '@/lib/format';
import { ROLE_LABEL, type RoleKey } from '@/lib/types';

interface OfficerRow {
  profile_id: string;
  full_name: string;
  role: RoleKey;
  scope_size: number;
  contacted_7d: number;
  tasks_updated_7d: number;
  settled: number;
}

const TARGET: Partial<Record<RoleKey, string>> = {
  contact_officer: '١٠٠٪ قبل ٢٤ ساعة من المجلس',
  attendance_officer: 'يُغلق الكشف خلال ساعة',
  finance_officer: '٩٠٪ خلال الشهر',
  tasks_officer: '١٠٠٪ قبل المجلس التالي',
  transcription_officer: 'النشر خلال ٤٨ ساعة',
};

function achieved(r: OfficerRow): number | null {
  if (!r.scope_size) return null;
  switch (r.role) {
    case 'contact_officer':
      return percent(r.contacted_7d, r.scope_size);
    case 'tasks_officer':
      return percent(r.tasks_updated_7d, r.scope_size);
    case 'finance_officer':
      return percent(r.settled, r.scope_size);
    default:
      return null;
  }
}

export default function TeamReport() {
  const activeCircleId = useApp((s) => s.activeCircleId);
  const [rows, setRows] = useState<OfficerRow[] | null>(null);
  const [overview, setOverview] = useState({ attendance: 0, tasks: 0, fees: 0 });

  const load = useCallback(async () => {
    if (!activeCircleId) return;
    setRows(null);

    const [{ data: perf }, { data: att }, { data: bal }] = await Promise.all([
      supabase.from('v_officer_performance').select('*').eq('circle_id', activeCircleId),
      supabase
        .from('v_session_attendance_summary')
        .select('*')
        .eq('circle_id', activeCircleId)
        .order('held_at', { ascending: false })
        .limit(5),
      supabase.from('v_enrollment_balance').select('due, paid').eq('circle_id', activeCircleId),
    ]);

    const list = ((perf ?? []) as OfficerRow[]).filter(
      (r) => r.role !== 'student' && r.role !== 'member',
    );
    list.sort((a, b) => (achieved(a) ?? 101) - (achieved(b) ?? 101));
    setRows(list);

    const attRows = (att ?? []) as { present: number; late: number; enrolled: number }[];
    const attAvg = attRows.length
      ? Math.round(
          attRows.reduce((s, r) => s + percent(Number(r.present) + Number(r.late), Number(r.enrolled)), 0) /
            attRows.length,
        )
      : 0;

    const balRows = (bal ?? []) as { due: number; paid: number }[];
    const due = balRows.reduce((s, r) => s + Number(r.due), 0);
    const paid = balRows.reduce((s, r) => s + Number(r.paid), 0);

    const withPct = list.map(achieved).filter((n): n is number => n != null);
    const team = withPct.length ? Math.round(withPct.reduce((a, b) => a + b, 0) / withPct.length) : 0;

    setOverview({ attendance: attAvg, tasks: team, fees: percent(paid, due) });
  }, [activeCircleId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!activeCircleId) return <Empty title="لا يوجد مجلس نشط" hint="اختر مجلسًا من الأعلى." />;
  if (rows === null) return <Loading />;

  return (
    <>
      <PageHead title="أداء الفريق" sub="النسبة محسوبة من الفعل المسجَّل، لا من تقرير يكتبه المسؤول عن نفسه" />

      <div className="mb-5 grid grid-cols-3 gap-2">
        <Stat label="متوسط الحضور" value={`${overview.attendance}٪`} tone="good" />
        <Stat label="التزام الفريق" value={`${overview.tasks}٪`} tone={overview.tasks >= 80 ? 'good' : 'warn'} />
        <Stat label="نسبة التحصيل" value={`${overview.fees}٪`} tone={overview.fees >= 80 ? 'good' : 'warn'} />
      </div>

      {rows.length === 0 ? (
        <Empty title="لم تُسنَد أدوار بعد" hint="أسنِد الأدوار والنطاقات من لوحة الإدارة." />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const pct = achieved(r);
            const tone = pct == null ? 'neutral' : pct >= 90 ? 'good' : pct >= 50 ? 'warn' : 'bad';
            return (
              <Card key={`${r.profile_id}-${r.role}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{r.full_name}</p>
                    <p className="text-xs text-ink-soft">{ROLE_LABEL[r.role]}</p>
                  </div>
                  {pct == null ? (
                    <Chip tone="neutral">يُقاس يدويًا</Chip>
                  ) : (
                    <Chip tone={tone as 'good' | 'warn' | 'bad'}>
                      {pct}٪ من {formatNumber(r.scope_size)}
                    </Chip>
                  )}
                </div>
                {pct != null && <Bar value={pct} tone={tone as 'good' | 'warn' | 'bad'} />}
                {TARGET[r.role] && (
                  <p className="mt-1.5 text-xs text-ink-faint">المستهدف: {TARGET[r.role]}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <button className="btn-ghost mt-5 w-full" onClick={() => window.print()}>
        طباعة أو حفظ PDF
      </button>
    </>
  );
}
