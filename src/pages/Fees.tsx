import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Layers } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchAll, selectIn } from '@/lib/query';
import { useApp, useIsAdmin } from '@/store/session';
import { useTemplates } from '@/hooks/useSessions';
import { Bar, Chip, Empty, Loading, PageHead, Stat } from '@/components/ui';
import { fillTemplate, isValidPhone, openWhatsApp } from '@/lib/whatsapp';
import { formatMoney, formatNumber, percent, relativeDay } from '@/lib/format';
import { DUE_TONE } from '@/lib/fees';
import { DUE_STATUS_LABEL, type DueStatus, type EnrollmentBalance, type FeePlan } from '@/lib/types';
import StudentFees from './fees/StudentFees';
import PlansSheet from './fees/PlansSheet';

interface Row extends EnrollmentBalance {
  phone: string | null;
}

type Filter = 'all' | DueStatus | 'none';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'unpaid', label: 'غير مسددة' },
  { key: 'partial', label: 'جزئيًا' },
  { key: 'paid', label: 'مسددة' },
  { key: 'exempt', label: 'معفى' },
  { key: 'none', label: 'بلا رسوم' },
];

export default function Fees() {
  const { activeCircleId, circles, roles } = useApp();
  const isAdmin = useIsAdmin();
  const templates = useTemplates();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [plans, setPlans] = useState<FeePlan[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [details, setDetails] = useState<Row | null>(null);
  const [editingPlans, setEditingPlans] = useState(false);

  const circle = circles.find((c) => c.id === activeCircleId);
  // الواجهة تُخفي ما لا يحق؛ والقاعدة هي الحَكَم في كل الأحوال
  const canManage =
    isAdmin || roles.some((r) => r.role === 'finance_officer' && r.circle_id === activeCircleId);

  const load = useCallback(async () => {
    if (!activeCircleId) return;
    const [list, { data: planRows }] = await Promise.all([
      fetchAll<EnrollmentBalance>(
        () => supabase.from('v_enrollment_balance').select('*').eq('circle_id', activeCircleId),
        'enrollment_id',
      ),
      supabase.from('fee_plans').select('*').eq('circle_id', activeCircleId).order('name'),
    ]);
    const people = await selectIn<{ id: string; phone: string | null }>(
      'profiles',
      'id, phone',
      'id',
      list.map((r) => r.student_id),
    );
    const phones = new Map(people.map((p) => [p.id, p.phone]));
    setRows(
      list
        .map((r) => ({
          ...r,
          due: Number(r.due),
          paid: Number(r.paid),
          remaining: Number(r.remaining),
          exempted: Number(r.exempted ?? 0),
          phone: phones.get(r.student_id) ?? null,
        }))
        .sort((a, b) => b.remaining - a.remaining || a.full_name.localeCompare(b.full_name, 'ar')),
    );
    setPlans((planRows ?? []) as FeePlan[]);
  }, [activeCircleId]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const all = rows ?? [];
    return {
      due: all.reduce((s, r) => s + r.due, 0),
      paid: all.reduce((s, r) => s + r.paid, 0),
      remaining: all.reduce((s, r) => s + Math.max(r.remaining, 0), 0),
      exempted: all.reduce((s, r) => s + (r.exempted ?? 0), 0),
      count: Object.fromEntries(FILTERS.map((f) => [f.key, all.filter((r) => f.key === 'all' || r.status === f.key).length])),
    };
  }, [rows]);

  const feeTemplate = templates.find((t) => t.key === 'fee');

  if (!activeCircleId) return <Empty title="لا يوجد مجلس نشط" hint="اختر مجلسًا من الأعلى." />;
  if (rows === null) return <Loading />;

  const shown = rows.filter((r) => filter === 'all' || r.status === filter);

  return (
    <>
      <PageHead
        title="الرسوم والتحصيل"
        sub="الرسوم المستحقة لكل طالب ودفعاتها وإعفاءاتها"
        action={
          canManage && (
            <button className="btn-ghost px-3 py-2 text-sm" onClick={() => setEditingPlans(true)}>
              <Layers size={16} />
              خطط الرسوم
            </button>
          )
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="المستحق (صافي)" value={formatMoney(totals.due)} />
        <Stat label="المحصَّل" value={formatMoney(totals.paid)} tone="good" />
        <Stat label="المتبقي" value={formatMoney(totals.remaining)} tone={totals.remaining ? 'bad' : 'good'} />
        <Stat label="الإعفاءات" value={formatMoney(totals.exempted)} />
      </div>

      <div className="mb-5">
        <Bar value={percent(totals.paid, totals.due)} tone="good" />
        <p className="mt-1.5 text-xs text-ink-soft">نسبة التحصيل {percent(totals.paid, totals.due)}٪</p>
      </div>

      <div className="scroll-x mb-4 flex gap-1.5 pb-1" role="tablist" aria-label="تصفية بالحالة">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`chip shrink-0 border px-3 py-1.5 text-sm ${
              filter === f.key ? 'border-brand-700 bg-brand-800 text-white' : 'border-line bg-white text-ink-soft'
            }`}
          >
            {f.label}
            <span className={filter === f.key ? 'text-white/70' : 'text-ink-faint'}>{formatNumber(totals.count[f.key])}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty title="لا يوجد طلاب" hint="أضف الطلاب من شاشة «قائمتي» أولًا." />
      ) : shown.length === 0 ? (
        <Empty title="لا أحد بهذه الحالة" hint="اختر تصفية أخرى من الأعلى." />
      ) : (
        <div className="space-y-2">
          {shown.map((r) => {
            const st = (r.status ?? 'none') as DueStatus | 'none';
            return (
              <div key={r.enrollment_id} className="card flex items-center gap-3 p-4">
                <button className="min-w-0 flex-1 text-start" onClick={() => setDetails(r)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.full_name}</span>
                    <Chip tone={DUE_TONE[st]}>{DUE_STATUS_LABEL[st]}</Chip>
                    {r.remaining > 0 && <span className="text-sm font-medium text-rose-700">متبقٍّ {formatMoney(r.remaining)}</span>}
                    {r.remaining < 0 && <Chip tone="warn">زيادة {formatMoney(-r.remaining)}</Chip>}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {r.dues_count ? `دفع ${formatMoney(r.paid)} من ${formatMoney(r.due)}` : 'لم تُحدَّد له رسوم بعد'}
                    {r.last_paid_at && ` · آخر دفعة ${relativeDay(r.last_paid_at)}`}
                  </p>
                </button>

                {r.remaining > 0 && isValidPhone(r.phone) && feeTemplate && (
                  <button
                    className="btn-wa px-3 py-2 text-xs"
                    onClick={() =>
                      openWhatsApp(r.phone!, fillTemplate(feeTemplate.body, { اسم_الطالب: r.full_name, اسم_المجلس: circle?.name }))
                    }
                  >
                    تذكير
                  </button>
                )}
                <button
                  onClick={() => setDetails(r)}
                  aria-label={`السجل المالي لـ ${r.full_name}`}
                  className="grid h-9 w-9 place-items-center rounded-lg text-ink-faint hover:bg-stone-100 hover:text-ink"
                >
                  <ChevronLeft size={18} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {details && (
        <StudentFees
          enrollmentId={details.enrollment_id}
          studentName={details.full_name}
          plans={plans}
          canManage={canManage}
          onClose={() => setDetails(null)}
          onChanged={() => void load()}
        />
      )}

      {editingPlans && (
        <PlansSheet circleId={activeCircleId} plans={plans} onClose={() => setEditingPlans(false)} onChanged={() => void load()} />
      )}
    </>
  );
}
