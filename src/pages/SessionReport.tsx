import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAll, selectIn } from '@/lib/query';
import { useApp } from '@/store/session';
import { useCurrentSession } from '@/hooks/useSessions';
import { Bar, Card, Chip, Empty, Loading, PageHead, Sheet, Stat } from '@/components/ui';
import { formatDateTime, formatNumber, percent } from '@/lib/format';
import { REASON_LABEL, type ProgressState, type Profile, type ReasonCode } from '@/lib/types';

interface StudentLine {
  id: string;
  name: string;
  attended: boolean;
  done: number;
  total: number;
  reasons: ReasonCode[];
}

interface TaskLine {
  id: string;
  title: string;
  done: number;
  stalled: number;
  expected: number;
}

export default function SessionReport() {
  const { profile, activeCircleId } = useApp();
  const { session } = useCurrentSession();
  const [lines, setLines] = useState<StudentLine[] | null>(null);
  const [taskLines, setTaskLines] = useState<TaskLine[]>([]);
  const [attendance, setAttendance] = useState({ present: 0, total: 0 });
  const [open, setOpen] = useState<StudentLine | null>(null);

  const load = useCallback(async () => {
    if (!activeCircleId || !session) {
      setLines([]);
      return;
    }
    setLines(null);

    const enrolled = await fetchAll<{ student_id: string }>(() =>
      supabase.from('enrollments').select('id, student_id').eq('circle_id', activeCircleId),
    );
    const ids = enrolled.map((e) => e.student_id);
    if (!ids.length) {
      setLines([]);
      return;
    }

    const [people, att, { data: tasks }] = await Promise.all([
      selectIn<Pick<Profile, 'id' | 'full_name'>>('profiles', 'id, full_name', 'id', ids),
      fetchAll<{ student_id: string; state: string }>(() =>
        supabase.from('attendance').select('id, student_id, state').eq('session_id', session.id),
      ),
      supabase.from('tasks').select('id, title').eq('session_id', session.id),
    ]);

    const taskIds = (tasks ?? []).map((t) => t.id as string);
    const prog = await selectIn<{ task_id: string; student_id: string; state: ProgressState; reason: ReasonCode | null }>(
      'task_progress',
      'id, task_id, student_id, state, reason',
      'task_id',
      taskIds,
    );

    const present = new Set(
      (att ?? []).filter((a) => a.state === 'present' || a.state === 'late').map((a) => a.student_id as string),
    );

    const byStudent = new Map<string, { done: number; reasons: ReasonCode[] }>();
    const byTask = new Map<string, { done: number; stalled: number }>();
    for (const p of (prog ?? []) as {
      task_id: string;
      student_id: string;
      state: ProgressState;
      reason: ReasonCode | null;
    }[]) {
      const s = byStudent.get(p.student_id) ?? { done: 0, reasons: [] };
      if (p.state === 'done') s.done += 1;
      if (p.reason) s.reasons.push(p.reason);
      byStudent.set(p.student_id, s);

      const t = byTask.get(p.task_id) ?? { done: 0, stalled: 0 };
      if (p.state === 'done') t.done += 1;
      if (p.state === 'stalled') t.stalled += 1;
      byTask.set(p.task_id, t);
    }

    const totalTasks = taskIds.length;
    const list: StudentLine[] = ((people ?? []) as Pick<Profile, 'id' | 'full_name'>[]).map((p) => ({
      id: p.id,
      name: p.full_name,
      attended: present.has(p.id),
      done: byStudent.get(p.id)?.done ?? 0,
      total: totalTasks,
      reasons: byStudent.get(p.id)?.reasons ?? [],
    }));

    list.sort((a, b) => b.done - a.done || Number(b.attended) - Number(a.attended));

    setLines(list);
    setAttendance({ present: present.size, total: ids.length });
    setTaskLines(
      (tasks ?? []).map((t) => ({
        id: t.id as string,
        title: t.title as string,
        done: byTask.get(t.id as string)?.done ?? 0,
        stalled: byTask.get(t.id as string)?.stalled ?? 0,
        expected: ids.length,
      })),
    );
  }, [activeCircleId, session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) return <Empty title="لا توجد جلسة" hint="التقرير يُبنى حول جلسة بعينها." />;
  if (lines === null) return <Loading />;

  const completed = lines.filter((l) => l.total > 0 && l.done === l.total).length;
  const stalled = lines.filter((l) => l.reasons.length > 0).length;
  const topReason = mostCommon(lines.flatMap((l) => l.reasons));
  const stars = lines.filter((l) => l.total > 0 && l.done === l.total).slice(0, 5);
  const needCare = lines
    .filter((l) => !l.attended || (l.total > 0 && l.done === 0))
    .slice(0, 5);

  return (
    <>
      <PageHead title="تقرير المجلس" sub={formatDateTime(session.held_at)} />

      <Card className="mb-4 bg-brand-50 border-brand-200">
        <p className="font-semibold leading-7">
          حضر {formatNumber(attendance.present)} من {formatNumber(attendance.total)} ·{' '}
          أنجز التكليف كاملًا {formatNumber(completed)} · تعثّر {formatNumber(stalled)}
          {topReason && ` · أبرز سبب: ${REASON_LABEL[topReason]}`}
        </p>
      </Card>

      <div className="mb-5 grid grid-cols-3 gap-2">
        <Stat label="نسبة الحضور" value={`${percent(attendance.present, attendance.total)}٪`} tone="good" />
        <Stat label="أنجزوا كاملًا" value={completed} />
        <Stat label="متعثرون" value={stalled} tone={stalled ? 'bad' : 'good'} />
      </div>

      <Section title="المتميزون — جاهزون للثناء">
        {stars.length ? (
          stars.map((s) => (
            <Row key={s.id} line={s} onOpen={() => setOpen(s)} tone="good" note={`أنجز ${s.done} من ${s.total}`} />
          ))
        ) : (
          <p className="p-3 text-sm text-ink-soft">لم يكتمل أحد التكاليف بعد.</p>
        )}
      </Section>

      <Section title="يحتاجون التفاتة — لا عقابًا">
        {needCare.length ? (
          needCare.map((s) => (
            <Row
              key={s.id}
              line={s}
              onOpen={() => setOpen(s)}
              tone="warn"
              note={
                !s.attended
                  ? 'غاب عن المجلس'
                  : s.reasons.length
                    ? REASON_LABEL[s.reasons[0]]
                    : 'لم يسجّل أي إنجاز'
              }
            />
          ))
        ) : (
          <p className="p-3 text-sm text-ink-soft">لا أحد متأخر. الحمد لله.</p>
        )}
      </Section>

      {taskLines.length > 0 && (
        <Section title="حال كل تكليف">
          {taskLines.map((t) => (
            <div key={t.id} className="border-b border-line p-3 last:border-0">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="truncate font-medium">{t.title}</span>
                <span className="shrink-0 text-xs text-ink-soft">
                  {t.done} من {t.expected}
                </span>
              </div>
              <Bar value={percent(t.done, t.expected)} tone={t.stalled > t.done ? 'warn' : 'good'} />
            </div>
          ))}
        </Section>
      )}

      <button className="btn-ghost mt-5 w-full" onClick={() => window.print()}>
        طباعة أو حفظ PDF
      </button>

      {open && (
        <StudentSheet line={open} sessionId={session.id} authorId={profile?.id ?? null} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="display mb-2.5 text-[22px]">{title}</h2>
      <div className="card divide-y divide-line p-0">{children}</div>
    </div>
  );
}

function Row({
  line,
  note,
  tone,
  onOpen,
}: {
  line: StudentLine;
  note: string;
  tone: 'good' | 'warn';
  onOpen: () => void;
}) {
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 p-3 text-start hover:bg-stone-50">
      <span className="flex-1 truncate font-medium">{line.name}</span>
      <Chip tone={tone}>{note}</Chip>
    </button>
  );
}

function StudentSheet({
  line,
  sessionId,
  authorId,
  onClose,
}: {
  line: StudentLine;
  sessionId: string;
  authorId: string | null;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState<{ id: string; body: string; created_at: string }[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('sheikh_notes')
        .select('id, body, created_at')
        .eq('student_id', line.id)
        .order('created_at', { ascending: false });
      setNotes((data ?? []) as { id: string; body: string; created_at: string }[]);
    })();
  }, [line.id]);

  async function add() {
    if (!draft.trim()) return;
    await supabase.from('sheikh_notes').insert({
      student_id: line.id,
      session_id: sessionId,
      body: draft.trim(),
      created_by: authorId,
    });
    setDraft('');
    const { data } = await supabase
      .from('sheikh_notes')
      .select('id, body, created_at')
      .eq('student_id', line.id)
      .order('created_at', { ascending: false });
    setNotes((data ?? []) as { id: string; body: string; created_at: string }[]);
  }

  return (
    <Sheet open onClose={onClose} title={line.name}>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Stat label="حضور هذا المجلس" value={line.attended ? 'حاضر' : 'غائب'} tone={line.attended ? 'good' : 'bad'} />
        <Stat label="التكاليف" value={`${line.done} من ${line.total}`} />
      </div>

      {line.reasons.length > 0 && (
        <p className="mb-4 text-sm text-ink-soft">
          أسباب التعثر المسجّلة: {line.reasons.map((r) => REASON_LABEL[r]).join('، ')}
        </p>
      )}

      <label className="label">ملاحظة خاصة (لا يراها إلا الشيخ ومدير المنصة)</label>
      <textarea className="field min-h-24" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button className="btn-primary mt-2 w-full" onClick={() => void add()}>
        حفظ الملاحظة
      </button>

      {notes.length > 0 && (
        <div className="mt-5 space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="rounded-xl bg-stone-50 p-3 text-sm">
              <p>{n.body}</p>
              <p className="mt-1 text-xs text-ink-faint">{formatDateTime(n.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function mostCommon<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  const counts = new Map<T, number>();
  for (const a of arr) counts.set(a, (counts.get(a) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
