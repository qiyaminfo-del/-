import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAll, selectIn } from '@/lib/query';
import { useApp } from '@/store/session';
import { useCurrentSession, useTemplates } from '@/hooks/useSessions';
import { Chip, Empty, Loading, PageHead, Sheet, Stat } from '@/components/ui';
import { fillTemplate, isValidPhone, openWhatsApp } from '@/lib/whatsapp';
import {
  PROGRESS_LABEL,
  REASON_LABEL,
  TASK_TYPE_LABEL,
  type ProgressState,
  type Profile,
  type ReasonCode,
  type Task,
  type TaskProgress,
} from '@/lib/types';

const CELL: Record<ProgressState, string> = {
  done: 'bg-emerald-500 text-white',
  partial: 'bg-amber-400 text-white',
  stalled: 'bg-rose-500 text-white',
  not_started: 'bg-stone-200 text-ink-soft',
};

export default function Tasks() {
  const { profile, activeCircleId, circles } = useApp();
  const { session } = useCurrentSession();
  const templates = useTemplates();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [students, setStudents] = useState<Profile[]>([]);
  const [progress, setProgress] = useState<Map<string, TaskProgress>>(new Map());
  const [loading, setLoading] = useState(true);
  const [cell, setCell] = useState<{ task: Task; student: Profile } | null>(null);

  const circle = circles.find((c) => c.id === activeCircleId);
  const key = (t: string, s: string) => `${t}|${s}`;

  const load = useCallback(async () => {
    if (!activeCircleId || !session) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const [{ data: taskRows }, enrolled] = await Promise.all([
      supabase.from('tasks').select('*').eq('session_id', session.id).order('created_at'),
      fetchAll<{ student_id: string }>(() =>
        supabase.from('enrollments').select('id, student_id').eq('circle_id', activeCircleId),
      ),
    ]);

    const ids = enrolled.map((e) => e.student_id);
    const [people, prog] = await Promise.all([
      selectIn<Profile>('profiles', '*', 'id', ids),
      selectIn<TaskProgress>(
        'task_progress',
        '*',
        'task_id',
        (taskRows ?? []).map((t) => t.id as string),
      ),
    ]);

    const map = new Map<string, TaskProgress>();
    for (const p of prog) map.set(key(p.task_id, p.student_id), p);

    setTasks((taskRows ?? []) as Task[]);
    setStudents(people.sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar')));
    setProgress(map);
    setLoading(false);
  }, [activeCircleId, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const cells = tasks.length * students.length;
    let done = 0;
    let stalled = 0;
    let none = 0;
    for (const t of tasks)
      for (const s of students) {
        const p = progress.get(key(t.id, s.id));
        if (!p || p.state === 'not_started') none += 1;
        else if (p.state === 'done') done += 1;
        else if (p.state === 'stalled') stalled += 1;
      }
    return { cells, done, stalled, none };
  }, [tasks, students, progress]);

  async function setState(task: Task, student: Profile, state: ProgressState, reason?: ReasonCode) {
    await supabase.from('task_progress').upsert(
      {
        task_id: task.id,
        student_id: student.id,
        state,
        percent: state === 'done' ? 100 : state === 'partial' ? 50 : 0,
        reason: reason ?? null,
        updated_by: profile?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'task_id,student_id' },
    );
    setCell(null);
    await load();
  }

  if (!session) return <Empty title="لا توجد جلسة" hint="التكاليف تُربط بجلسة. أنشئ جلسة أولًا." />;
  if (loading) return <Loading />;
  if (!tasks.length)
    return (
      <Empty
        title="لا تكاليف لهذه الجلسة بعد"
        hint="يضيفها الشيخ أو مدير المنصة، أو تُستخرج تلقائيًا من ملخص الدرس."
      />
    );

  return (
    <>
      <PageHead title="متابعة التكاليف" sub="اضغط خلية لتسجيل الحالة أو سؤال الطالب" />

      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat label="منجز" value={stats.done} tone="good" />
        <Stat label="متعثر" value={stats.stalled} tone="bad" />
        <Stat label="لم يُسجَّل" value={stats.none} />
      </div>

      <div className="scroll-x card p-0">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="sticky start-0 bg-white p-3 text-start font-semibold">الطالب</th>
              {tasks.map((t) => (
                <th key={t.id} className="min-w-28 p-3 text-center font-semibold">
                  <div className="truncate">{t.title}</div>
                  <div className="mt-0.5 text-[11px] font-normal text-ink-faint">
                    {TASK_TYPE_LABEL[t.type]}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="sticky start-0 bg-white p-3 font-medium">
                  <span className="block max-w-36 truncate">{s.full_name}</span>
                </td>
                {tasks.map((t) => {
                  const p = progress.get(key(t.id, s.id));
                  const state: ProgressState = p?.state ?? 'not_started';
                  return (
                    <td key={t.id} className="p-2 text-center">
                      <button
                        onClick={() => setCell({ task: t, student: s })}
                        className={`h-9 w-full rounded-lg text-xs font-medium transition active:scale-95 ${CELL[state]}`}
                      >
                        {PROGRESS_LABEL[state]}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cell && (
        <CellSheet
          task={cell.task}
          student={cell.student}
          current={progress.get(key(cell.task.id, cell.student.id)) ?? null}
          circleName={circle?.name ?? ''}
          askTemplate={templates.find((t) => t.key === 'task')?.body ?? null}
          onClose={() => setCell(null)}
          onSet={setState}
        />
      )}
    </>
  );
}

function CellSheet({
  task,
  student,
  current,
  circleName,
  askTemplate,
  onClose,
  onSet,
}: {
  task: Task;
  student: Profile;
  current: TaskProgress | null;
  circleName: string;
  askTemplate: string | null;
  onClose: () => void;
  onSet: (t: Task, s: Profile, state: ProgressState, reason?: ReasonCode) => Promise<void>;
}) {
  const [reason, setReason] = useState<ReasonCode | undefined>(current?.reason ?? undefined);

  return (
    <Sheet open onClose={onClose} title={student.full_name}>
      <div className="mb-4">
        <Chip tone="info">{TASK_TYPE_LABEL[task.type]}</Chip>
        <p className="mt-2 font-semibold">{task.title}</p>
        {task.description && <p className="mt-1 text-sm text-ink-soft">{task.description}</p>}
      </div>

      <p className="label">الحالة</p>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn bg-emerald-600 py-3 text-white" onClick={() => void onSet(task, student, 'done')}>
          منجز
        </button>
        <button className="btn bg-amber-500 py-3 text-white" onClick={() => void onSet(task, student, 'partial')}>
          جزئي
        </button>
        <button
          className="btn bg-rose-500 py-3 text-white"
          onClick={() => void onSet(task, student, 'stalled', reason)}
        >
          متعثر
        </button>
        <button className="btn-ghost py-3" onClick={() => void onSet(task, student, 'not_started')}>
          إعادة تصفير
        </button>
      </div>

      <p className="label mt-5">سبب التعثر (يُفيد الشيخ أكثر من الرقم نفسه)</p>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(REASON_LABEL) as ReasonCode[]).map((r) => (
          <button
            key={r}
            onClick={() => setReason(r)}
            className={`chip border ${
              reason === r ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-line bg-white'
            }`}
          >
            {REASON_LABEL[r]}
          </button>
        ))}
      </div>

      {isValidPhone(student.phone) && askTemplate && (
        <button
          className="btn-wa mt-5 w-full"
          onClick={() =>
            openWhatsApp(
              student.phone!,
              fillTemplate(askTemplate, { اسم_الطالب: student.full_name, اسم_المجلس: circleName }),
            )
          }
        >
          سؤاله على واتساب
        </button>
      )}
    </Sheet>
  );
}
