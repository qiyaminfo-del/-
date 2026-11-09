import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, ClipboardCheck, Printer, Wallet, type LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/query';
import { dbMessage } from '@/lib/errors';
import { useApp, useIsSteward } from '@/store/session';
import { Bar, Chip, Empty, Loading, PageHead, Stat } from '@/components/ui';
import { formatMoney, formatNumber, percent } from '@/lib/format';
import { DUE_TONE } from '@/lib/fees';
import { localDay } from '@/lib/wird';
import { DUE_STATUS_LABEL, type DueStatus, type EnrollmentBalance, type StudentGroup } from '@/lib/types';

type Tab = 'attendance' | 'wird' | 'fees';

interface AttRow {
  student_id: string;
  full_name: string;
  sessions: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
  unmarked: number;
  rate: number | null;
  avg_late_minutes: number | null;
}

interface WirdRow {
  student_id: string;
  full_name: string;
  level_name: string | null;
  required: number;
  completed: number;
  percent: number | null;
}

const firstOfMonth = () => {
  const d = new Date();
  return localDay(new Date(d.getFullYear(), d.getMonth(), 1));
};

export default function Reports() {
  const { activeCircleId, roles } = useApp();
  const steward = useIsSteward();
  const has = (r: string) => roles.some((x) => x.role === r && x.circle_id === activeCircleId);

  const tabs: { key: Tab; label: string; icon: LucideIcon; show: boolean }[] = [
    { key: 'attendance', label: 'الحضور', icon: ClipboardCheck, show: steward || has('attendance_officer') },
    { key: 'wird', label: 'الأوراد', icon: BookOpenCheck, show: steward || has('tasks_officer') },
    { key: 'fees', label: 'الرسوم', icon: Wallet, show: steward || has('finance_officer') },
  ].filter((t) => t.show) as { key: Tab; label: string; icon: LucideIcon; show: boolean }[];

  const [tab, setTab] = useState<Tab | null>(null);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(localDay());
  const [group, setGroup] = useState('');
  const [groups, setGroups] = useState<StudentGroup[]>([]);

  const current = tab && tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key;

  useEffect(() => {
    if (!activeCircleId) return;
    void supabase
      .from('student_groups')
      .select('*')
      .eq('circle_id', activeCircleId)
      .order('name')
      .then(({ data }) => setGroups((data ?? []) as StudentGroup[]));
  }, [activeCircleId]);

  if (!activeCircleId) return <Empty title="لا يوجد مجلس نشط" hint="اختر مجلسًا من الأعلى." />;
  if (!current) return <Empty title="لا تقارير متاحة لك" hint="التقارير لمن له مسؤولية حضور أو أوراد أو رسوم في هذا المجلس." />;

  const invalid = !from || !to || to < from;

  return (
    <>
      <PageHead
        title="التقارير"
        sub="تُحسب من السجل الفعلي، وتشمل فقط الطلاب المصرح لك بهم"
        action={
          <button className="btn-ghost no-print px-3 py-2 text-sm" onClick={() => window.print()}>
            <Printer size={16} />
            طباعة
          </button>
        }
      />

      <div role="tablist" aria-label="نوع التقرير" className="no-print mb-4 flex gap-1 rounded-2xl border border-line bg-white p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={current === t.key}
            onClick={() => setTab(t.key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              current === t.key ? 'bg-brand-800 text-white' : 'text-ink-soft hover:bg-stone-50'
            }`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {current !== 'fees' && (
        <div className="no-print mb-5 grid gap-2 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="r-from">من</label>
            <input id="r-from" className="field" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="r-to">إلى</label>
            <input id="r-to" className="field" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          {current === 'attendance' && (
            <div>
              <label className="label" htmlFor="r-group">المجموعة</label>
              <select id="r-group" className="field" value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="">كل الطلاب</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {invalid && current !== 'fees' ? (
        <Empty title="الفترة غير صحيحة" hint="اختر تاريخ بداية قبل تاريخ النهاية." />
      ) : current === 'attendance' ? (
        <AttendanceReport circleId={activeCircleId} from={from} to={to} group={group || null} />
      ) : current === 'wird' ? (
        <WirdReport circleId={activeCircleId} from={from} to={to} />
      ) : (
        <FeesReport circleId={activeCircleId} />
      )}
    </>
  );
}

function useRpc<T>(fn: string, args: Record<string, unknown>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(args);
  const run = useCallback(async () => {
    setRows(null);
    setError(null);
    const { data, error: e } = await supabase.rpc(fn, JSON.parse(key));
    if (e) {
      setError(dbMessage(e));
      setRows([]);
    } else setRows((data ?? []) as T[]);
  }, [fn, key]);
  useEffect(() => {
    void run();
  }, [run]);
  return { rows, error };
}

function AttendanceReport({ circleId, from, to, group }: { circleId: string; from: string; to: string; group: string | null }) {
  const { rows, error } = useRpc<AttRow>('attendance_report', { p_circle: circleId, p_from: from, p_to: to, p_group: group });

  const totals = useMemo(() => {
    const r = (rows ?? []).map((x) => ({ ...x, sessions: +x.sessions, present: +x.present, late: +x.late, absent: +x.absent, excused: +x.excused }));
    const sessions = r.reduce((s, x) => s + x.sessions, 0);
    const attended = r.reduce((s, x) => s + x.present + x.late, 0);
    return {
      rate: percent(attended, sessions),
      late: r.reduce((s, x) => s + x.late, 0),
      absent: r.reduce((s, x) => s + x.absent, 0),
      excused: r.reduce((s, x) => s + x.excused, 0),
    };
  }, [rows]);

  if (rows === null) return <Loading />;
  if (error) return <Empty title="تعذّر تحميل التقرير" hint={error} />;
  if (!rows.length) return <Empty title="لا بيانات" hint="لا طلاب في نطاقك أو لا جلسات في هذه الفترة." />;

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="نسبة الحضور" value={`${formatNumber(totals.rate)}٪`} tone={totals.rate >= 80 ? 'good' : 'warn'} />
        <Stat label="تأخر" value={formatNumber(totals.late)} tone="warn" />
        <Stat label="غياب" value={formatNumber(totals.absent)} tone="bad" />
        <Stat label="بعذر" value={formatNumber(totals.excused)} />
      </div>
      <div className="card scroll-x p-0">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-ink-soft">
              <th className="p-3 text-start font-medium">الطالب</th>
              <th className="p-3 font-medium">الجلسات</th>
              <th className="p-3 font-medium">حاضر</th>
              <th className="p-3 font-medium">متأخر</th>
              <th className="p-3 font-medium">بعذر</th>
              <th className="p-3 font-medium">غائب</th>
              <th className="p-3 font-medium">لم يُسجَّل</th>
              <th className="p-3 text-start font-medium">النسبة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.student_id} className="border-b border-line last:border-0">
                <td className="p-3 font-medium">{r.full_name}</td>
                <td className="p-3 text-center">{formatNumber(+r.sessions)}</td>
                <td className="p-3 text-center text-emerald-700">{formatNumber(+r.present)}</td>
                <td className="p-3 text-center text-amber-700">
                  {formatNumber(+r.late)}
                  {r.avg_late_minutes != null && <span className="block text-[11px] text-ink-faint">≈{formatNumber(r.avg_late_minutes)} د</span>}
                </td>
                <td className="p-3 text-center">{formatNumber(+r.excused)}</td>
                <td className="p-3 text-center text-rose-700">{formatNumber(+r.absent)}</td>
                <td className="p-3 text-center text-ink-faint">{formatNumber(+r.unmarked)}</td>
                <td className="w-40 p-3">
                  {r.rate == null ? (
                    <span className="text-xs text-ink-faint">—</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Bar value={r.rate} tone={r.rate >= 80 ? 'good' : r.rate >= 50 ? 'warn' : 'bad'} />
                      <span className="w-10 text-xs">{formatNumber(r.rate)}٪</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function WirdReport({ circleId, from, to }: { circleId: string; from: string; to: string }) {
  const { rows, error } = useRpc<WirdRow>('wird_report', { p_circle: circleId, p_from: from, p_to: to });

  if (rows === null) return <Loading />;
  if (error) return <Empty title="تعذّر تحميل التقرير" hint={error} />;
  if (!rows.length) return <Empty title="لا بيانات" hint="لا طلاب في نطاقك." />;

  const req = rows.reduce((s, r) => s + Number(r.required), 0);
  const done = rows.reduce((s, r) => s + Number(r.completed), 0);
  const tracked = rows.filter((r) => Number(r.required) > 0).length;

  return (
    <>
      <div className="mb-5 grid grid-cols-3 gap-2">
        <Stat label="الالتزام العام" value={`${formatNumber(percent(done, req))}٪`} tone={percent(done, req) >= 70 ? 'good' : 'warn'} />
        <Stat label="طلاب يُتابَعون" value={formatNumber(tracked)} />
        <Stat label="بلا مستوى" value={formatNumber(rows.length - tracked)} tone={rows.length - tracked ? 'warn' : 'neutral'} />
      </div>
      <p className="mb-3 text-xs text-ink-soft">النسبة لكل طالب = ما أنجزه من أوراد مستواه في كل يوم ÷ المطلوب منه في تلك الأيام.</p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.student_id} className="card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{r.full_name}</span>
                {r.level_name ? <Chip tone="info">{r.level_name}</Chip> : <Chip tone="warn">بلا مستوى</Chip>}
              </div>
              <span className="text-sm text-ink-soft">
                {formatNumber(Number(r.completed))} من {formatNumber(Number(r.required))}
              </span>
            </div>
            {r.percent != null ? (
              <div className="flex items-center gap-2">
                <Bar value={r.percent} tone={r.percent >= 70 ? 'good' : r.percent >= 40 ? 'warn' : 'bad'} />
                <span className="w-10 text-xs">{formatNumber(r.percent)}٪</span>
              </div>
            ) : (
              <p className="text-xs text-ink-faint">لا أوراد مطلوبة في هذه الفترة.</p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function FeesReport({ circleId }: { circleId: string }) {
  const [rows, setRows] = useState<EnrollmentBalance[] | null>(null);

  useEffect(() => {
    void fetchAll<EnrollmentBalance>(
      () => supabase.from('v_enrollment_balance').select('*').eq('circle_id', circleId),
      'enrollment_id',
    ).then(setRows);
  }, [circleId]);

  if (rows === null) return <Loading />;
  if (!rows.length) return <Empty title="لا بيانات" hint="لا طلاب في نطاقك." />;

  const sum = (k: 'due' | 'paid' | 'exempted') => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const remaining = rows.reduce((s, r) => s + Math.max(Number(r.remaining), 0), 0);
  const byStatus = (['unpaid', 'partial', 'paid', 'exempt', 'none'] as const).map((st) => ({
    st,
    count: rows.filter((r) => (r.status ?? 'none') === st).length,
  }));

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="المستحق (صافي)" value={formatMoney(sum('due'))} />
        <Stat label="المدفوع" value={formatMoney(sum('paid'))} tone="good" />
        <Stat label="المتبقي" value={formatMoney(remaining)} tone={remaining ? 'bad' : 'good'} />
        <Stat label="الإعفاءات" value={formatMoney(sum('exempted'))} />
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {byStatus.map(({ st, count }) => (
          <Chip key={st} tone={DUE_TONE[st as DueStatus | 'none']}>
            {DUE_STATUS_LABEL[st]}: {formatNumber(count)}
          </Chip>
        ))}
      </div>
      <div className="card scroll-x p-0">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-ink-soft">
              <th className="p-3 text-start font-medium">الطالب</th>
              <th className="p-3 font-medium">المستحق</th>
              <th className="p-3 font-medium">المدفوع</th>
              <th className="p-3 font-medium">المتبقي</th>
              <th className="p-3 font-medium">الإعفاء</th>
              <th className="p-3 font-medium">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {[...rows]
              .sort((a, b) => Number(b.remaining) - Number(a.remaining))
              .map((r) => {
                const st = (r.status ?? 'none') as DueStatus | 'none';
                return (
                  <tr key={r.enrollment_id} className="border-b border-line last:border-0">
                    <td className="p-3 font-medium">{r.full_name}</td>
                    <td className="p-3 text-center">{formatMoney(Number(r.due))}</td>
                    <td className="p-3 text-center text-emerald-700">{formatMoney(Number(r.paid))}</td>
                    <td className="p-3 text-center text-rose-700">{formatMoney(Math.max(Number(r.remaining), 0))}</td>
                    <td className="p-3 text-center">{formatMoney(Number(r.exempted ?? 0))}</td>
                    <td className="p-3 text-center">
                      <Chip tone={DUE_TONE[st]}>{DUE_STATUS_LABEL[st]}</Chip>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </>
  );
}
