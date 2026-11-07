import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { fetchAll, selectIn } from '@/lib/query';
import { dbMessage } from '@/lib/errors';
import { useApp, useIsSteward } from '@/store/session';
import { useCurrentSession } from '@/hooks/useSessions';
import {
  ArrowLeft,
  CalendarDays,
  ChartColumn,
  Check,
  ClipboardCheck,
  ListChecks,
  MapPin,
  NotebookPen,
  PhoneCall,
  Sparkles,
  UsersRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Card, Chip, Empty, Loading, PageHead } from '@/components/ui';
import { formatDateTime, relativeDay } from '@/lib/format';
import { ROLE_LABEL, TASK_TYPE_LABEL, type ProgressState, type Task } from '@/lib/types';

const DUTY_ICON: Record<string, LucideIcon> = {
  '/my-list': PhoneCall,
  '/attendance': ClipboardCheck,
  '/fees': Wallet,
  '/tasks': ListChecks,
  '/summaries': NotebookPen,
  '/report': ChartColumn,
  '/team': UsersRound,
};

const TONE_BOX = {
  bad: 'bg-rose-50 text-rose-700 ring-rose-200',
  warn: 'bg-amber-50 text-amber-700 ring-amber-200',
  good: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  neutral: 'bg-brand-50 text-brand-700 ring-brand-200',
};

interface Duty {
  to: string;
  title: string;
  detail: string;
  tone: 'bad' | 'warn' | 'good' | 'neutral';
}

export default function Home() {
  const { profile, roles, circles, activeCircleId } = useApp();
  const steward = useIsSteward();
  const { session } = useCurrentSession();
  const [duties, setDuties] = useState<Duty[] | null>(null);
  const [myTasks, setMyTasks] = useState<(Task & { state: ProgressState })[]>([]);

  const load = useCallback(async () => {
    if (!activeCircleId || !profile) return;
    setDuties(null);
    const out: Duty[] = [];
    const mine = new Set(roles.filter((r) => r.circle_id === activeCircleId).map((r) => r.role));

    // طلابي في كل مسؤولية
    const roleIds = roles.filter((r) => r.circle_id === activeCircleId).map((r) => r.id);
    const assigned = await selectIn<{ role_id: string; student_id: string }>(
      'assignments',
      'id, role_id, student_id',
      'role_id',
      roleIds,
      (q) => q.is('revoked_at', null),
    );

    const scopeOf = (role: string) => {
      const ids = new Set(roles.filter((r) => r.role === role && r.circle_id === activeCircleId).map((r) => r.id));
      return assigned.filter((a) => ids.has(a.role_id)).map((a) => a.student_id);
    };

    if ((mine.has('contact_officer') || steward) && session) {
      const scope = scopeOf('contact_officer');
      const done = await fetchAll<{ student_id: string }>(() =>
        supabase.from('contacts_log').select('id, student_id').eq('session_id', session.id),
      );
      const doneSet = new Set(done.map((d) => d.student_id));
      const left = scope.filter((id) => !doneSet.has(id)).length;
      out.push({
        to: '/my-list',
        title: 'قائمتي — التواصل والتأكيد',
        detail: left ? `${left} لم يُتواصل معهم بعد` : 'اكتمل التواصل مع كل من في نطاقك',
        tone: left ? 'bad' : 'good',
      });
    }

    if ((mine.has('attendance_officer') || steward) && session) {
      const { count: marked } = await supabase
        .from('attendance')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', session.id);
      out.push({
        to: '/attendance',
        title: 'كشف الحضور',
        detail:
          session.status === 'closed'
            ? 'الكشف مغلق'
            : `سُجّل ${marked ?? 0} · ${formatDateTime(session.held_at)}`,
        tone: session.status === 'closed' ? 'good' : 'warn',
      });
    }

    if (mine.has('finance_officer') || steward) {
      const { count } = await supabase
        .from('v_enrollment_balance')
        .select('enrollment_id', { count: 'exact', head: true })
        .eq('circle_id', activeCircleId)
        .gt('remaining', 0);
      const late = count ?? 0;
      out.push({
        to: '/fees',
        title: 'الرسوم',
        detail: late ? `${late} متأخرون عن السداد` : 'لا متأخرات',
        tone: late ? 'bad' : 'good',
      });
    }

    if ((mine.has('tasks_officer') || steward) && session) {
      const { data: tasks } = await supabase.from('tasks').select('id').eq('session_id', session.id);
      const ids = (tasks ?? []).map((t) => t.id as string);
      const prog = await selectIn<{ state: ProgressState }>('task_progress', 'id, state', 'task_id', ids, (q) =>
        q.eq('state', 'stalled'),
      );
      const stalled = prog.length;
      out.push({
        to: '/tasks',
        title: 'متابعة التكاليف',
        detail: stalled ? `${stalled} حالة متعثرة تحتاج سؤالًا` : `${ids.length} تكليف قائم`,
        tone: stalled ? 'bad' : 'neutral',
      });
    }

    if ((mine.has('transcription_officer') || steward) && session) {
      const { data: sum } = await supabase
        .from('summaries')
        .select('status')
        .eq('session_id', session.id)
        .maybeSingle();
      out.push({
        to: '/summaries',
        title: 'التفريغ والملخص',
        detail: sum?.status === 'published' ? 'منشور' : `بانتظار النشر · ${relativeDay(session.held_at)}`,
        tone: sum?.status === 'published' ? 'good' : 'warn',
      });
    }

    if (steward) {
      out.push({ to: '/report', title: 'تقرير المجلس للشيخ', detail: 'ملخص الحضور والتكاليف', tone: 'neutral' });
      out.push({ to: '/team', title: 'أداء الفريق', detail: 'من أدّى ومن تأخر', tone: 'neutral' });
    }

    // تكاليف الطالب نفسه
    if (session) {
      const { data: tasks } = await supabase.from('tasks').select('*').eq('session_id', session.id);
      const ids = (tasks ?? []).map((t) => t.id as string);
      const { data: mineProg } = ids.length
        ? await supabase
            .from('task_progress')
            .select('task_id, state')
            .eq('student_id', profile.id)
            .in('task_id', ids)
        : { data: [] as { task_id: string; state: ProgressState }[] };
      const map = new Map((mineProg ?? []).map((p) => [p.task_id as string, p.state as ProgressState]));
      setMyTasks(((tasks ?? []) as Task[]).map((t) => ({ ...t, state: map.get(t.id) ?? 'not_started' })));
    }

    setDuties(out);
  }, [activeCircleId, profile, roles, steward, session]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markMine(task: Task, state: ProgressState) {
    if (!profile) return;
    const { error } = await supabase.from('task_progress').upsert(
      {
        task_id: task.id,
        student_id: profile.id,
        state,
        percent: state === 'done' ? 100 : 0,
        updated_by: profile.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'task_id,student_id' },
    );
    if (error) alert(dbMessage(error));
    await load();
  }

  if (duties === null) return <Loading />;

  const myRoleNames = [...new Set(roles.map((r) => ROLE_LABEL[r.role]))].join(' · ');

  const circle = circles.find((c) => c.id === activeCircleId);
  const doneCount = myTasks.filter((t) => t.state === 'done').length;

  return (
    <>
      <PageHead
        title={`أهلًا ${profile?.full_name?.split(' ')[0] ?? ''}`}
        sub={myRoleNames || 'طالب'}
      />

      {session && (
        <section className="relative mb-8 overflow-hidden rounded-3xl bg-brand-900 p-6 text-white shadow-lift animate-rise sm:p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(520px_280px_at_90%_-10%,rgba(201,162,85,0.28),transparent_70%),radial-gradient(420px_300px_at_0%_120%,rgba(75,119,103,0.4),transparent_70%)]" />
          <div className="relative flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="mb-2 flex items-center gap-2 text-sm text-gold-300">
                <CalendarDays size={16} />
                المجلس القادم
              </p>
              <p className="display text-[30px] leading-tight sm:text-[38px]">{formatDateTime(session.held_at)}</p>
              {(circle?.location || circle?.name) && (
                <p className="mt-2 flex items-center gap-2 text-sm text-white/60">
                  <MapPin size={15} />
                  {[circle?.name, circle?.location].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <span className="chip bg-white/10 text-gold-200 ring-1 ring-inset ring-white/15">
              {relativeDay(session.held_at)}
            </span>
          </div>
        </section>
      )}

      {duties.length > 0 && (
        <section className="mb-9">
          <h2 className="display mb-3 text-2xl">ما عليك الآن</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {duties.map((d, i) => {
              const Icon = DUTY_ICON[d.to] ?? ArrowLeft;
              return (
                <Link
                  key={d.to + d.title}
                  to={d.to}
                  style={{ animationDelay: `${i * 45}ms` }}
                  className="card-link group flex items-center gap-4 p-4 animate-rise"
                >
                  <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ring-1 ring-inset ${TONE_BOX[d.tone]}`}>
                    <Icon size={22} strokeWidth={1.7} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{d.title}</p>
                    <p className="mt-0.5 truncate text-sm text-ink-soft">{d.detail}</p>
                  </div>
                  <ArrowLeft
                    size={18}
                    className="shrink-0 text-ink-faint transition group-hover:-translate-x-1 group-hover:text-brand-700"
                  />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {myTasks.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="display text-2xl">تكاليفي</h2>
            <span className="text-sm text-ink-soft">
              {doneCount} من {myTasks.length} منجزة
            </span>
          </div>
          <div className="space-y-2.5">
            {myTasks.map((t) => {
              const done = t.state === 'done';
              return (
                <Card key={t.id} className="flex items-center gap-4">
                  <button
                    onClick={() => void markMine(t, done ? 'not_started' : 'done')}
                    aria-label={done ? 'إلغاء الإنجاز' : 'تسجيل إنجاز'}
                    aria-pressed={done}
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition ${
                      done
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-stone-300 bg-white text-transparent hover:border-emerald-500 hover:text-emerald-500/50'
                    }`}
                  >
                    <Check size={18} strokeWidth={2.4} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-medium ${done ? 'text-ink-faint line-through' : ''}`}>{t.title}</span>
                      <Chip tone="info">{TASK_TYPE_LABEL[t.type]}</Chip>
                    </div>
                    {t.description && <p className="mt-0.5 text-xs text-ink-soft">{t.description}</p>}
                  </div>
                  {done && <span className="text-xs font-medium text-emerald-700">أنجزته</span>}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {duties.length === 0 && myTasks.length === 0 && (
        <Empty
          icon={Sparkles}
          title="لا مهام عليك الآن"
          hint="ستظهر هنا تكاليفك ومسؤولياتك فور إسنادها إليك من مدير المنصة."
        />
      )}
    </>
  );
}
