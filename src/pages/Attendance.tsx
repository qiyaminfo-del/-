import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, PencilLine } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchAll, selectIn } from '@/lib/query';
import { useApp } from '@/store/session';
import { useCurrentSession, useTemplates } from '@/hooks/useSessions';
import { Card, Chip, Empty, Loading, PageHead, Sheet, Stat } from '@/components/ui';
import { writeOrQueue, pendingCount } from '@/lib/offline';
import { fillTemplate, isValidPhone, openWhatsApp } from '@/lib/whatsapp';
import { formatDateTime, formatTime } from '@/lib/format';
import {
  ATTENDANCE_CYCLE,
  ATTENDANCE_LABEL,
  type AttendanceState,
  type Profile,
} from '@/lib/types';

interface Row extends Profile {
  state: AttendanceState | null;
  arrived_at: string | null;
  marked_by: string | null;
  marked_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
  confirmed: boolean;
  history: string;
}

interface Mark {
  student_id: string;
  state: AttendanceState;
  arrived_at: string | null;
  marked_by: string | null;
  marked_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

/** الحاضر والمتأخر لهما وقت وصول؛ الغائب والمعتذر لا */
const HAS_TIME: AttendanceState[] = ['present', 'late'];

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
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [editing, setEditing] = useState<Row | null>(null);

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
      fetchAll<Mark>(() =>
        supabase
          .from('attendance')
          .select('id, student_id, state, arrived_at, marked_by, marked_at, updated_by, updated_at')
          .eq('session_id', session.id),
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

    const markMap = new Map(marks.map((m) => [m.student_id, m]));
    // أسماء من سجّل ومن عدّل (يظهر ما تسمح القاعدة برؤيته)
    const actorIds = [...new Set(marks.flatMap((m) => [m.marked_by, m.updated_by]).filter(Boolean) as string[])];
    const actors = await selectIn<{ id: string; full_name: string }>('profiles', 'id, full_name', 'id', actorIds);
    setNames(new Map(actors.map((a) => [a.id, a.full_name])));
    const confirmSet = new Set(confirms.map((c) => c.student_id));
    const seen = new Map(stats.map((s) => [s.student_id, s]));

    const list: Row[] = people.map((p) => {
      const h = seen.get(p.id);
      return {
        ...p,
        state: markMap.get(p.id)?.state ?? null,
        arrived_at: markMap.get(p.id)?.arrived_at ?? null,
        marked_by: markMap.get(p.id)?.marked_by ?? null,
        marked_at: markMap.get(p.id)?.marked_at ?? null,
        updated_by: markMap.get(p.id)?.updated_by ?? null,
        updated_at: markMap.get(p.id)?.updated_at ?? null,
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

  /** يحفظ الحالة ووقت الوصول (أو يضعهما في الطابور بلا إنترنت) */
  async function save(row: Row, state: AttendanceState, arrivedAt: string | null): Promise<boolean> {
    if (!session) return false;
    const arrived = HAS_TIME.includes(state) ? arrivedAt : null;
    setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, state, arrived_at: arrived } : r)) ?? prev);

    const result = await writeOrQueue(
      'attendance',
      {
        session_id: session.id,
        student_id: row.id,
        state,
        arrived_at: arrived,
        marked_by: profile?.id ?? null,
        marked_at: new Date().toISOString(),
      },
      'session_id,student_id',
    );
    void pendingCount().then(setPendingSync);
    if (result === 'rejected') {
      setRows((prev) => prev?.map((r) => (r.id === row.id ? row : r)) ?? prev);
      alert('رفضت القاعدة التسجيل. تأكد أن هذا الطالب ضمن نطاقك، وأن وقت الوصول قريب من موعد الجلسة.');
      return false;
    }
    return true;
  }

  async function cycle(row: Row) {
    const idx = row.state ? ATTENDANCE_CYCLE.indexOf(row.state) : -1;
    const next = ATTENDANCE_CYCLE[(idx + 1) % ATTENDANCE_CYCLE.length];
    // أول تسجيل حضور يأخذ وقت اللحظة؛ تبديل حاضر↔متأخر يحتفظ بالوقت الأول
    await save(row, next, HAS_TIME.includes(next) ? (row.arrived_at ?? new Date().toISOString()) : null);
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
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-soft">
                  <span>حضر {r.history}</span>
                  {r.arrived_at && (
                    <span className="flex items-center gap-1 text-ink">
                      <Clock3 size={12} />
                      وصل {formatTime(r.arrived_at)}
                    </span>
                  )}
                  {r.updated_at && <span className="text-ink-faint">· عُدّل</span>}
                </p>
              </div>

              {r.state && (
                <button
                  onClick={() => setEditing(r)}
                  aria-label={`تعديل سجل ${r.full_name}`}
                  title="تعديل الحالة أو وقت الوصول"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-faint transition hover:bg-stone-100 hover:text-ink"
                >
                  <PencilLine size={17} />
                </button>
              )}

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
        الضغط على الزر يدوّر الحالة: حاضر ← متأخر ← بعذر ← غائب، ويُسجَّل وقت الوصول تلقائيًا. القلم لتعديل الحالة أو
        الوقت. يعمل بلا إنترنت ويزامن تلقائيًا.
      </p>

      {editing && (
        <EditMark
          row={editing}
          heldAt={session.held_at}
          names={names}
          onClose={() => setEditing(null)}
          onSave={async (state, arrivedAt) => {
            if (await save(editing, state, arrivedAt)) {
              setEditing(null);
              void load();
            }
          }}
        />
      )}
    </>
  );
}

/** HH:MM محلي من ISO */
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function EditMark({
  row,
  heldAt,
  names,
  onClose,
  onSave,
}: {
  row: Row;
  heldAt: string;
  names: Map<string, string>;
  onClose: () => void;
  onSave: (state: AttendanceState, arrivedAt: string | null) => Promise<void>;
}) {
  const [state, setState] = useState<AttendanceState>(row.state ?? 'present');
  const [time, setTime] = useState(hhmm(row.arrived_at ?? heldAt));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    let arrived: string | null = null;
    if (HAS_TIME.includes(state)) {
      if (!/^\d{2}:\d{2}$/.test(time)) return setErr('اكتب وقت الوصول.');
      // الوقت على تاريخ الجلسة نفسها
      const base = new Date(heldAt);
      const [h, m] = time.split(':').map(Number);
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);
      if (Math.abs(d.getTime() - base.getTime()) > 12 * 3600_000) return setErr('وقت الوصول بعيد عن موعد الجلسة.');
      arrived = d.toISOString();
    }
    setBusy(true);
    await onSave(state, arrived);
    setBusy(false);
  }

  const who = (id: string | null) => (id ? (names.get(id) ?? 'عضو في الفريق') : '—');

  return (
    <Sheet open onClose={onClose} title={row.full_name}>
      <p className="label">الحالة</p>
      <div className="mb-4 grid grid-cols-4 gap-2">
        {ATTENDANCE_CYCLE.map((s) => (
          <button
            key={s}
            onClick={() => setState(s)}
            aria-pressed={state === s}
            className={`rounded-xl py-2.5 text-sm font-semibold transition ${
              state === s ? TONE[s] : 'border border-line bg-white text-ink-soft'
            }`}
          >
            {ATTENDANCE_LABEL[s]}
          </button>
        ))}
      </div>

      {HAS_TIME.includes(state) && (
        <div className="mb-4">
          <label className="label" htmlFor="arr-time">وقت الوصول الفعلي</label>
          <input id="arr-time" className="field" type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} />
          <p className="mt-1 text-xs text-ink-faint">موعد الجلسة {formatTime(heldAt)}.</p>
        </div>
      )}

      <div className="mb-4 space-y-1 rounded-xl bg-stone-50 p-3 text-xs text-ink-soft">
        <p>
          سجّله: <span className="text-ink">{who(row.marked_by)}</span>
          {row.marked_at && ` · ${formatDateTime(row.marked_at)}`}
        </p>
        {row.updated_at && (
          <p>
            آخر تعديل: <span className="text-ink">{who(row.updated_by)}</span> · {formatDateTime(row.updated_at)}
          </p>
        )}
      </div>

      {err && <p className="mb-3 text-sm text-rose-700">{err}</p>}
      <button className="btn-primary w-full" disabled={busy} onClick={() => void submit()}>
        {busy ? 'جارٍ الحفظ…' : 'حفظ التعديل'}
      </button>
    </Sheet>
  );
}
