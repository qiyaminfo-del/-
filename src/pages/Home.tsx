import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { fetchAll, selectIn } from '@/lib/query';
import { dbMessage } from '@/lib/errors';
import { useApp, useIsSteward } from '@/store/session';
import { useCurrentSession } from '@/hooks/useSessions';
import { Card, Chip, Loading, PageHead } from '@/components/ui';
import { formatDateTime, relativeDay } from '@/lib/format';
import { ROLE_LABEL, TASK_TYPE_LABEL, type ProgressState, type Task } from '@/lib/types';

interface Duty {
  to: string;
  title: string;
  detail: string;
  tone: 'bad' | 'warn' | 'good' | 'neutral';
}

export default function Home() {
  const { profile, roles, activeCircleId } = useApp();
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

  return (
    <>
      <PageHead
        title={`أهلًا ${profile?.full_name?.split(' ')[0] ?? ''}`}
        sub={myRoleNames || 'طالب'}
      />

      {session && (
        <Card className="mb-4 border-brand-200 bg-brand-50">
          <p className="text-sm text-ink-soft">المجلس القادم</p>
          <p className="mt-0.5 font-semibold">{formatDateTime(session.held_at)}</p>
        </Card>
      )}

      {duties.length > 0 && (
        <>
          <h2 className="mb-2 font-bold">ما عليك الآن</h2>
          <div className="mb-6 space-y-2">
            {duties.map((d) => (
              <Link key={d.to + d.title} to={d.to} className="card flex items-center gap-3 p-4 hover:bg-stone-50">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{d.title}</p>
                  <p className="mt-0.5 text-sm text-ink-soft">{d.detail}</p>
                </div>
                <Chip tone={d.tone}>›</Chip>
              </Link>
            ))}
          </div>
        </>
      )}

      {myTasks.length > 0 && (
        <>
          <h2 className="mb-2 font-bold">تكاليفي</h2>
          <div className="space-y-2">
            {myTasks.map((t) => (
              <Card key={t.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{t.title}</span>
                    <Chip tone="info">{TASK_TYPE_LABEL[t.type]}</Chip>
                  </div>
                  {t.description && <p className="mt-0.5 text-xs text-ink-soft">{t.description}</p>}
                </div>
                <button
                  onClick={() => void markMine(t, t.state === 'done' ? 'not_started' : 'done')}
                  className={`btn px-3 py-2 text-xs ${
                    t.state === 'done' ? 'bg-emerald-600 text-white' : 'border border-line bg-white'
                  }`}
                >
                  {t.state === 'done' ? 'أنجزته' : 'تسجيل إنجاز'}
                </button>
              </Card>
            ))}
          </div>
        </>
      )}

      {duties.length === 0 && myTasks.length === 0 && (
        <Card>
          <p className="font-semibold">لا مهام عليك الآن</p>
          <p className="mt-1 text-sm text-ink-soft">
            ستظهر هنا تكاليفك ومسؤولياتك فور إسنادها إليك من مدير المنصة.
          </p>
        </Card>
      )}
    </>
  );
}
