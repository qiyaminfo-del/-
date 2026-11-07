import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useApp, useIsSteward } from '@/store/session';
import { Card, Chip, Empty, Loading, PageHead, Sheet } from '@/components/ui';
import { formatDateTime, relativeDay } from '@/lib/format';
import { dbMessage } from '@/lib/errors';
import { parseTasks, taskKey, type ParsedTask } from '@/lib/summary';
import type { Session, Summary, SummaryStatus } from '@/lib/types';

const STATUS_LABEL: Record<SummaryStatus, string> = {
  draft: 'مسودة',
  pending_review: 'بانتظار الاعتماد',
  approved: 'معتمد',
  published: 'منشور',
};

const SKELETON = `## المحاور

-

## الفوائد

-

## الأدلة

-

## التكاليف المطلوبة

- [عبادة]
- [نشاط]
`;

interface Row extends Session {
  summary: Summary | null;
}

export default function Summaries() {
  const { profile, activeCircleId } = useApp();
  const steward = useIsSteward();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);

  const load = useCallback(async () => {
    if (!activeCircleId) return;
    setRows(null);
    const { data: sessions } = await supabase
      .from('sessions')
      .select('*')
      .eq('circle_id', activeCircleId)
      .order('held_at', { ascending: false })
      .limit(20);

    const ids = (sessions ?? []).map((s) => s.id as string);
    const { data: sums } = ids.length
      ? await supabase.from('summaries').select('*').in('session_id', ids)
      : { data: [] as Summary[] };

    const map = new Map((sums ?? []).map((s) => [s.session_id as string, s as Summary]));
    setRows(((sessions ?? []) as Session[]).map((s) => ({ ...s, summary: map.get(s.id) ?? null })));
  }, [activeCircleId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(row: Row, md: string, status: SummaryStatus) {
    const { error } = await supabase.from('summaries').upsert(
      {
        session_id: row.id,
        summary_md: md,
        status,
        by_profile_id: profile?.id ?? null,
        published_at: status === 'published' ? new Date().toISOString() : null,
        approved_by: status === 'approved' || status === 'published' ? profile?.id ?? null : null,
      },
      { onConflict: 'session_id' },
    );
    if (error) {
      // القاعدة ترفض تعديل ملخص معتمد أو منشور لغير المدير والشيخ
      alert(
        error.code === '42501' || /row-level security/i.test(error.message)
          ? 'تعذّر الحفظ. الملخص المعتمد أو المنشور لا يعدّله إلا مدير المنصة أو الشيخ.'
          : dbMessage(error),
      );
      return;
    }
    setEditing(null);
    await load();
  }

  /** استخراج التكاليف من سطور الملخص المعلّمة [عبادة] ونحوها. */
  async function extractTasks(row: Row) {
    const found = parseTasks(row.summary?.summary_md ?? '');
    if (!found.length) {
      alert('لم يُعثر على سطور تكاليف. اكتبها بالصيغة: - [عبادة] ورد يومي');
      return;
    }

    // الضغط المتكرر لا يكرر التكليف: نستبعد ما أُضيف من قبل لهذه الجلسة
    const { data: existing, error: e1 } = await supabase
      .from('tasks')
      .select('type, title')
      .eq('session_id', row.id);
    if (e1) {
      alert(dbMessage(e1));
      return;
    }
    const have = new Set(((existing ?? []) as ParsedTask[]).map(taskKey));
    const fresh = found.filter((f) => !have.has(taskKey(f)));
    if (!fresh.length) {
      alert('كل هذه التكاليف مضافة من قبل.');
      return;
    }

    const { error } = await supabase
      .from('tasks')
      .insert(fresh.map((f) => ({ session_id: row.id, ...f, created_by: profile?.id ?? null })));
    if (error) {
      alert(dbMessage(error));
      return;
    }
    const skipped = found.length - fresh.length;
    alert(`أُضيف ${fresh.length} تكليفًا${skipped ? ` (وتُجوهل ${skipped} مكرر)` : ''}.`);
  }

  if (!activeCircleId) return <Empty title="لا يوجد مجلس نشط" hint="اختر مجلسًا من الأعلى." />;
  if (rows === null) return <Loading />;
  if (!rows.length) return <Empty title="لا جلسات بعد" hint="أنشئ جلسة من لوحة الإدارة." />;

  return (
    <>
      <PageHead title="التفريغ والملخص" sub="المستهدف: النشر خلال ٤٨ ساعة من المجلس" />

      <div className="space-y-2">
        {rows.map((r) => {
          const st = r.summary?.status ?? 'draft';
          const late = !r.summary?.published_at && new Date(r.held_at) < new Date(Date.now() - 48 * 3600_000);
          return (
            <Card key={r.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.title || 'مجلس'}</span>
                  <Chip tone={st === 'published' ? 'good' : st === 'draft' ? 'neutral' : 'warn'}>
                    {STATUS_LABEL[st]}
                  </Chip>
                  {late && <Chip tone="bad">تأخر النشر</Chip>}
                </div>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {formatDateTime(r.held_at)} · {relativeDay(r.held_at)}
                </p>
              </div>

              {r.summary?.summary_md && steward && (
                <button className="btn-ghost px-3 py-2 text-xs" onClick={() => void extractTasks(r)}>
                  استخراج التكاليف
                </button>
              )}
              <button className="btn-primary px-3 py-2 text-xs" onClick={() => setEditing(r)}>
                {r.summary ? 'تحرير' : 'كتابة'}
              </button>
            </Card>
          );
        })}
      </div>

      {editing && (
        <Editor row={editing} steward={steward} onClose={() => setEditing(null)} onSave={save} />
      )}
    </>
  );
}

function Editor({
  row,
  steward,
  onClose,
  onSave,
}: {
  row: Row;
  steward: boolean;
  onClose: () => void;
  onSave: (row: Row, md: string, status: SummaryStatus) => Promise<void>;
}) {
  const [md, setMd] = useState(row.summary?.summary_md || SKELETON);

  return (
    <Sheet open onClose={onClose} title={`ملخص ${formatDateTime(row.held_at)}`}>
      <textarea
        className="field min-h-72 font-mono text-sm leading-7"
        value={md}
        onChange={(e) => setMd(e.target.value)}
      />
      <p className="mt-1.5 text-xs text-ink-soft">
        اكتب كل تكليف في سطر بالصيغة: <span dir="ltr">- [عبادة] ورد يومي</span> — تُستخرج بضغطة بعد الحفظ.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="btn-ghost" onClick={() => void onSave(row, md, 'pending_review')}>
          حفظ وإرسال للاعتماد
        </button>
        <button
          className="btn-primary"
          disabled={!steward}
          title={steward ? '' : 'النشر يحتاج اعتماد مدير المنصة'}
          onClick={() => void onSave(row, md, 'published')}
        >
          اعتماد ونشر
        </button>
      </div>
    </Sheet>
  );
}
